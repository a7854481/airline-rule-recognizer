/**
 * 票规识别后端代理
 * - 隐藏 API Key（仅服务端可见，前端永远拿不到）
 * - 图片/文本识别统一走智谱 GLM-4V 视觉模型（OpenAI 兼容协议）
 * - 严格按"签转向上继承 / 折扣列校验 / 强制 discount 字段 / focus 模式只输出目标舱位"规则输出 JSON
 * - 同时托管前端静态产物（dist/），方便单进程部署
 *
 * 启动：
 *   ZHIPU_API_KEY=xxx node server.js
 *   （可选）PORT=3000 ZHIPU_MODEL=glm-4v-plus 覆盖默认值
 */

import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 加载环境变量：优先 .env.local，其次 .env（密钥只放本地，勿提交到仓库）
dotenv.config({ path: path.join(__dirname, '.env.local') })
dotenv.config({ path: path.join(__dirname, '.env') })

const PORT = process.env.PORT || 3000
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || ''
// 调试/演示开关：设置 MOCK_RECOGNIZE=1 时跳过真实模型调用，直接返回示例 JSON，
// 用于在无 API Key 或断网时验证「识别→解析→展示」整条链路是否准确。生产请勿开启。
const MOCK_RECOGNIZE = process.env.MOCK_RECOGNIZE === '1'
const ZHIPU_API_BASE = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
// 模型名白名单：自动 trim + 转小写，避免 CloudBase 环境变量误填（大写/空格/拼写错）
// 导致智谱返回 400 "modelCode：不存在"。不在白名单时兜底到免费的 glm-4.6v-flash（所有账号必可用）。
// 智谱 2026 年已把视觉模型统一升级到 GLM-4.6V 系列，旧的 glm-4v-plus/4v/4v-flash 大概率已下线。
//  - glm-4.6v          高性能版（106B），消耗资源包
//  - glm-4.6v-flashx   轻量高速版（9B），计费
//  - glm-4.6v-flash    完全免费（推荐默认）
//  - glm-5v-turbo      旗舰多模态，计费
const VALID_ZHIPU_MODELS = [
  'glm-4.6v',
  'glm-4.6v-flashx',
  'glm-4.6v-flash',
  'glm-5v-turbo',
  // 旧模型保留兜底（如账号仍能调）
  'glm-4v-plus',
  'glm-4v',
  'glm-4v-flash',
]
const ZHIPU_MODEL_RAW = (process.env.ZHIPU_MODEL || '').trim().toLowerCase()
const ZHIPU_MODEL = VALID_ZHIPU_MODELS.includes(ZHIPU_MODEL_RAW) ? ZHIPU_MODEL_RAW : 'glm-4.6v-flash'

// ===== 飞书 OCR（免费版）通道 =====
// 飞书免费版 optical_char_recognition 仅返回纯文字数组（text_list），无表格行列结构，
// 且对免费租户有较严的 QPS/配额限制（实测频繁返回 99991400 限流）。
// 因此本通道定位为：飞书负责"识文字"，再由智谱把文字秒级整理成结构化 JSON（文本输入小、不撞 504）。
// 飞书一旦限流/失败，自动回退智谱直接识图。
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || ''
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || ''

if (!ZHIPU_API_KEY && !(FEISHU_APP_ID && FEISHU_APP_SECRET)) {
  console.warn('[警告] 未配置 ZHIPU_API_KEY 也未配置 FEISHU_APP_ID/SECRET，识别接口将返回错误。')
}

const app = express()
app.use(express.json({ limit: '25mb' }))

// ===== 公共提示词：结构化输出规则 =====
// 说明（与前端 parse-ai-result.ts 的 tryParseJsonPayload 对齐）：
// 全量模式用嵌套 {change:{intervals[],fees[]}, refund:{...}} 结构；
// 聚焦模式（只认一个舱位）只输出该舱位一行，同样用嵌套结构。
function buildSystemPrompt() {
  return `你是一名严谨的民航机票退改签规则 OCR 与结构化专家。
用户会给你一张「航司舱位退改签费率表」的图片（或一段票规文本）。
请仔细识别表格中每一行、每一列，做到"数字与舱位行严格对齐，禁止跨行取数"。

【输出要求】
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块标记。
- 必须包含字段：
  - "airline": 航司名称（如"桂林航空""东方航空"），识别不到留空字符串
  - "change": 自愿变更（改签）规则对象
  - "refund": 自愿退票规则对象
  - "endorsement": 签转规则文字（如"允许签转""不允许签转""不得签转"），识别不到留空
  - "open_rule": OPEN 票规则文字，识别不到留空

【change / refund 结构】
{
  "intervals": [ "区间1文字描述", "区间2文字描述", ... ],  // 从早到晚：先"起飞前很久"，最后"起飞后"
  "fees":     [ "费率1", "费率2", ... ]                    // 与 intervals 一一对应；免费写"免费"，不得退/不退写"不得退"
}

【舱位费率行】
- "cabinRows": 数组，每个元素对应一个舱位行：
  {
    "cabin_code": "Y",          // 单字母或字母+数字，大写
    "discount": "100%",         // 折扣列原始值（如 92%、100%、80%），用于校验行定位，务必识别
    "change_rates": ["免费","5%","10%","20%","不得退"],  // 与该舱位行的变更费率区间一一对应（从左到右=从早到晚）
    "refund_rates": ["免费","10%","20%","50%","不得退"]  // 与该舱位行的退票费率区间一一对应
  }
- 费率区间数量必须与 intervals 数量一致；免费写"免费"，不可退写"不得退"。
- 多个舱位用逗号分隔在同一行时（如 "D/Z"），拆成两个 cabinRows 元素，各自费率相同。

【签转列垂直合并单元格（极重要）】
- 若某舱位行的签转列为空（与上一行合并），必须从"上方最近的有值行"继承签转值，
  绝对不能向下查找，也绝对不能默认"不允许"。

【舱位行定位校验（极重要）】
- 先在舱位代码列定位目标字母所在行，再读取该行折扣列核对定位是否正确，
  费率数字必须与行严格对齐，禁止把上一行的数据当成当前行。

【区间文字示例】
- "起飞前30天（含）之前" → 放在 intervals，前端会解析为 before 30 day
- "起飞前30天至起飞前7天" → between 30 day 7 day
- "起飞前48小时至起飞前4小时" → between 48 hour 4 hour
- "起飞后" / "航班起飞后" → after（放在最后一个）

请务必准确，宁可标"不得退/免费"也不要编造数字。`
}

function buildFocusPrompt(targetCabin) {
  return `目标：只识别 ${targetCabin} 舱这一行的退改签费率，忽略其它舱位。
仍然输出同样的 JSON 结构，但 cabinRows 只保留 ${targetCabin} 舱一行。
airline / change.intervals / refund.intervals 仍需给出完整区间定义（从整张表识别），
只是 cabinRows 限定为 ${targetCabin} 舱。`
}

function buildTextPrompt() {
  return `用户给你一段票规文本（可能是复制自 PDF/网页的舱位费率表）。
请按系统规则解析为结构化 JSON，与上面对图片的要求完全一致：
- 输出单个 JSON 对象，无解释、无代码块标记
- 字段：airline, change{intervals[],fees[]}, refund{intervals[],fees[]}, endorsement, open_rule, cabinRows[]
- cabinRows 每个元素：cabin_code, discount, change_rates[], refund_rates[]`
}

function stripCodeFence(text) {
  return text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
}

async function callZhipu(messages) {
  // 智谱视觉模型处理大图/复杂表可能耗时较长，CloudBase nginx 网关上游默认 60s。
  // 这里 55s 早断，避免前端收到模糊的 504 Gateway Timeout，改成明确的"识别超时"。
  const TIMEOUT_MS = 55_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let resp
  try {
    resp = await fetch(ZHIPU_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
      },
      body: JSON.stringify({
        model: ZHIPU_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 1500,
        // 让模型尽量输出 JSON
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      const e = new Error(`识别耗时超过 ${TIMEOUT_MS / 1000} 秒（图片过大或模型繁忙）。请将截图裁小（建议宽度 ≤ 1500px）后重试，或改用 glm-4.6v-flashx 高速模型。`)
      e.code = 504
      throw e
    }
    throw err
  }
  clearTimeout(timer)

  if (!resp.ok) {
    let detail = ''
    try {
      const j = await resp.json()
      detail = j?.error?.message || JSON.stringify(j).slice(0, 400)
    } catch {
      detail = (await resp.text().catch(() => '')) || `HTTP ${resp.status}`
    }
    // 把智谱常见错误翻译成对用户友好的中文提示
    let friendly = `智谱接口返回 ${resp.status}`
    const lower = detail.toLowerCase()
    if (resp.status === 400 && lower.includes('input length too long')) {
      friendly = '图片过大，已超出模型识别长度限制。请使用体积更小的截图（建议宽度 ≤ 2000px、单张 ≤ 1.5MB），或裁剪后重试。'
    } else if (resp.status === 400 && (lower.includes('1210') || lower.includes('max_tokens'))) {
      friendly = '模型参数非法（max_tokens 超出范围），请联系管理员。'
    } else if (resp.status === 401 || resp.status === 403) {
      friendly = 'API Key 无效或未授权，请检查 ZHIPU_API_KEY 配置。'
    } else if (resp.status === 429) {
      friendly = '请求过于频繁或额度耗尽，请稍后重试。'
    } else {
      friendly = `识别服务异常（${resp.status}）：${detail.slice(0, 300)}`
    }
    const e = new Error(friendly)
    e.code = resp.status
    throw e
  }
  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  return stripCodeFence(content)
}

// ===== 飞书 OCR 通道 =====
let _feishuToken = null
let _feishuTokenExpire = 0
async function getFeishuToken() {
  const now = Date.now()
  if (_feishuToken && now < _feishuTokenExpire - 60_000) return _feishuToken
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  })
  const j = await resp.json().catch(() => ({}))
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error('飞书获取 tenant_access_token 失败：' + (j.msg || JSON.stringify(j)))
  }
  _feishuToken = j.tenant_access_token
  _feishuTokenExpire = now + (j.expire || 7200) * 1000
  return _feishuToken
}

// 返回 OCR 拼接后的纯文字；失败抛错（由调用方决定回退）
async function feishuOcr(dataUrl) {
  const token = await getFeishuToken()
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const resp = await fetch('https://open.feishu.cn/open-apis/optical_char_recognition/v1/image/basic_recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ image: b64, data_type: 'base64' }),
  })
  const j = await resp.json().catch(() => ({}))
  if (j.code !== 0) {
    const err = new Error('飞书OCR失败（' + j.code + '）：' + (j.msg || JSON.stringify(j)))
    err.code = j.code
    throw err
  }
  const textList = j.data?.text_list || []
  return textList.join('\n')
}

// base64 data URL → 估算字节数（用于拦截过大图片，避免打到智谱才报 400）
function estimateBase64Bytes(dataUrl) {
  try {
    const comma = dataUrl.indexOf(',')
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
    return Math.floor((b64.length * 3) / 4)
  } catch {
    return 0
  }
}

// ===== 路由：图片识别 =====
app.post('/api/recognize', async (req, res) => {
  try {
    if (!ZHIPU_API_KEY && !MOCK_RECOGNIZE) {
      return res.status(500).json({ error: '服务端未配置 ZHIPU_API_KEY，无法识别。' })
    }
    const { image, targetCabin, mode } = req.body || {}
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: '缺少图片数据（image 字段，base64 或 data URL）。' })
    }
    // 提前拦截过大图片：智谱对输入长度有限制，过大直接 400 input length too long；
    // 另外大图处理慢，容易撞 CloudBase 网关 60s 上游超时，所以提前卡到 2MB。
    const imgBytes = estimateBase64Bytes(image)
    if (imgBytes > 2_000_000) {
      return res.status(400).json({
        error:
          '图片过大（约 ' +
          (imgBytes / 1024 / 1024).toFixed(1) +
          'MB），请压缩或裁剪到 2MB 以内后重试。建议截图宽度 ≤ 1500px、保留关键信息区。',
      })
    }

    const systemPrompt = buildSystemPrompt()
    const userText =
      mode === 'focus' && targetCabin
        ? buildFocusPrompt(String(targetCabin).toUpperCase())
        : '请识别这张完整的航司舱位退改签费率表，输出结构化 JSON。'

    // ===== 调试/演示：直接返回示例结果，跳过真实模型调用 =====
    if (MOCK_RECOGNIZE) {
      const mock = mode === 'focus' && targetCabin
        ? JSON.stringify({
            airline: '桂林航空',
            change: {
              intervals: ['起飞前30天（含）之前', '起飞前30天至起飞前7天', '起飞前7天至起飞前48小时', '起飞前48小时至起飞前4小时', '起飞前4小时至起飞后'],
              fees: ['免费', '5%', '10%', '30%', '50%'],
            },
            refund: {
              intervals: ['起飞前30天（含）之前', '起飞前30天至起飞前7天', '起飞前7天至起飞前48小时', '起飞前48小时至起飞前4小时', '起飞前4小时至起飞后'],
              fees: ['免费', '10%', '20%', '50%', '不得退'],
            },
            endorsement: '不允许签转',
            open_rule: 'OPEN票有效期1年',
            cabinRows: [{ cabin_code: String(targetCabin).toUpperCase(), discount: '100%', change_rates: ['免费', '5%', '10%', '30%', '50%'], refund_rates: ['免费', '10%', '20%', '50%', '不得退'] }],
          })
        : JSON.stringify({
            airline: '桂林航空',
            change: {
              intervals: ['起飞前30天（含）之前', '起飞前30天至起飞前7天', '起飞前7天至起飞前48小时', '起飞前48小时至起飞前4小时', '起飞前4小时至起飞后'],
              fees: ['免费', '5%', '10%', '30%', '50%'],
            },
            refund: {
              intervals: ['起飞前30天（含）之前', '起飞前30天至起飞前7天', '起飞前7天至起飞前48小时', '起飞前48小时至起飞前4小时', '起飞前4小时至起飞后'],
              fees: ['免费', '10%', '20%', '50%', '不得退'],
            },
            endorsement: '不允许签转',
            open_rule: 'OPEN票有效期1年',
            cabinRows: [
              { cabin_code: 'Y', discount: '100%', change_rates: ['免费', '5%', '10%', '30%', '50%'], refund_rates: ['免费', '10%', '20%', '50%', '不得退'] },
              { cabin_code: 'B', discount: '90%', change_rates: ['免费', '5%', '10%', '30%', '50%'], refund_rates: ['免费', '10%', '20%', '50%', '不得退'] },
            ],
          })
      return res.json({ text: mock, success: true })
    }

    // ===== 混合识别：飞书 OCR 优先，智谱视觉兜底 =====
    // 飞书免费版 OCR 只返回纯文字（无表格结构）、且可能限流；
    // 因此飞书负责"识文字"，智谱负责"把文字整理成结构化 JSON"（文本输入小、秒回、不触发 504）。
    // 若飞书失败/限流/返回空，则直接用智谱视觉识别原图。
    let rawText = null
    let source = 'zhipu'
    if (FEISHU_APP_ID && FEISHU_APP_SECRET && !MOCK_RECOGNIZE) {
      try {
        const ocrText = await feishuOcr(image)
        if (ocrText && ocrText.trim().length >= 8) {
          const textMessages = [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    (mode === 'focus' && targetCabin
                      ? buildFocusPrompt(String(targetCabin).toUpperCase())
                      : buildTextPrompt()) +
                    '\n\n【飞书OCR识别出的原始文字】\n' +
                    ocrText,
                },
              ],
            },
          ]
          rawText = await callZhipu(textMessages)
          source = 'feishu'
          console.log('[识别] 飞书OCR成功，交由智谱结构化')
        }
      } catch (fe) {
        console.warn('[识别] 飞书OCR失败，回退智谱直识：', fe?.message || fe)
      }
    }

    if (!rawText) {
      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: image } },
            { type: 'text', text: userText },
          ],
        },
      ]
      rawText = await callZhipu(messages)
      source = 'zhipu'
    }

    // 返回原始文本，前端已有的 parseAiResultToRule 负责解析，保证"识别+解析"解耦
    res.json({ text: rawText, success: true, source })
  } catch (err) {
    console.error('[识别失败]', err?.message || err)
    res.status(500).json({ error: err?.message || '识别失败', success: false })
  }
})

// ===== 路由：航班截图识别 =====
app.post('/api/recognize-flight', async (req, res) => {
  try {
    if (!ZHIPU_API_KEY && !MOCK_RECOGNIZE) {
      return res.status(500).json({ error: '服务端未配置 ZHIPU_API_KEY，无法识别。' })
    }
    const { image } = req.body || {}
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: '缺少图片数据（image 字段，base64 或 data URL）。' })
    }
    const imgBytes = estimateBase64Bytes(image)
    if (imgBytes > 3_500_000) {
      return res.status(400).json({
        error:
          '图片过大（约 ' +
          (imgBytes / 1024 / 1024).toFixed(1) +
          'MB），请压缩或裁剪到 3.5MB 以内后重试。',
      })
    }

    const systemPrompt = `你是一名严谨的机票航班信息 OCR 专家。用户给你一张航班行程单 / 客票截图。
请仔细识别并只输出一个 JSON 对象（无解释、无代码块标记），字段如下：
- "flight_number": 航班号（如 "MU5108"，大写，含航司二字码）
- "cabin_code": 舱位代码（如 "Y"、"B"，大写单字母）
- "departure_date": 起飞日期（格式 YYYY-MM-DD）
- "departure_time": 起飞时间（格式 HH:MM，24 小时制）
- "airline_name": 航司全称（如"东方航空""中国国航"），识别不到留空
请务必准确，数字/字母与票面严格一致。`

    if (MOCK_RECOGNIZE) {
      const mock = JSON.stringify({
        flight_number: 'GT1012',
        cabin_code: 'Y',
        departure_date: '2026-09-01',
        departure_time: '14:30',
        airline_name: '桂林航空',
      })
      return res.json({ text: mock, success: true })
    }

    let rawText = null
    let source = 'zhipu'
    if (FEISHU_APP_ID && FEISHU_APP_SECRET) {
      try {
        const ocrText = await feishuOcr(image)
        if (ocrText && ocrText.trim().length >= 8) {
          const textMessages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [{ type: 'text', text: '请识别这段航班信息文字：\n' + ocrText }] },
          ]
          rawText = await callZhipu(textMessages)
          source = 'feishu'
          console.log('[航班识别] 飞书OCR成功，交由智谱结构化')
        }
      } catch (fe) {
        console.warn('[航班识别] 飞书OCR失败，回退智谱直识：', fe?.message || fe)
      }
    }
    if (!rawText) {
      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: '请识别这张航班截图。' }],
        },
      ]
      rawText = await callZhipu(messages)
      source = 'zhipu'
    }
    res.json({ text: rawText, success: true, source })
  } catch (err) {
    console.error('[航班识别失败]', err?.message || err)
    res.status(500).json({ error: err?.message || '航班识别失败', success: false })
  }
})

// ===== 路由：文本解析 =====
app.post('/api/parse-text', async (req, res) => {
  try {
    if (!ZHIPU_API_KEY && !MOCK_RECOGNIZE) {
      return res.status(500).json({ error: '服务端未配置 ZHIPU_API_KEY，无法解析。' })
    }
    const { text } = req.body || {}
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return res.status(400).json({ error: '票规文本过短或缺失。' })
    }

    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${buildTextPrompt()}\n\n【票规文本】\n${text}` },
        ],
      },
    ]

    const rawText = await callZhipu(messages)
    res.json({ text: rawText, success: true })
  } catch (err) {
    console.error('[解析失败]', err?.message || err)
    res.status(500).json({ error: err?.message || '解析失败', success: false })
  }
})

// ===== 托管前端静态产物 =====
const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    // 兼容前端 history 路由
    res.sendFile(path.join(distDir, 'index.html'))
  })
  console.log(`[静态托管] 已启用 dist/ 目录`)
}

app.listen(PORT, () => {
  console.log(`票规识别服务已启动: http://localhost:${PORT}`)
  console.log(`  模型: ${ZHIPU_MODEL} | 智谱密钥: ${ZHIPU_API_KEY ? '已配置' : '❌ 未配置'} | 飞书OCR: ${FEISHU_APP_ID ? '已配置' : '未配置'}`)
})
