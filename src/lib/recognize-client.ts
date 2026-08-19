/**
 * 识别客户端：统一调用同源后端（/api/*），彻底替代飞书 apaas capabilityClient。
 * 后端使用智谱 GLM-4V 视觉模型，密钥只在服务端，前端永远拿不到。
 *
 * 三种能力：
 *  - recognizeTicketRule(image, mode, targetCabin)  → 票规图片识别
 *  - parseTicketRuleText(text)                       → 票规文本解析
 *  - recognizeFlightInfo(image)                      → 航班截图识别（航班号/舱位/起飞时间）
 *
 * 图片统一转成 base64 data URL 传给后端，避免浏览器 CORS / 外链限制。
 */

/** File/Blob → base64 data URL */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('图片压缩失败'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

/**
 * 浏览器端压缩/缩放图片，避免把动辄几 MB 的原图直接丢给智谱导致
 * 「400 input length too long」。
 *
 * 策略：
 *  - 最长边缩放到 maxDim（票规表保留较高分辨率，航班截图可更低）
 *  - 转成 JPEG（白底，规避透明区变黑），质量 quality
 *  - 若仍超过 maxSizeBytes，逐步降质量 → 降分辨率，最多 4 轮
 *  - 非浏览器环境 / 非图片 / canvas 不可用：原样转 data URL 兜底
 */
export interface CompressOptions {
  maxDim?: number
  quality?: number
  maxSizeBytes?: number
}

export async function compressImageToDataUrl(
  file: Blob,
  opts: CompressOptions = {},
): Promise<string> {
  const { maxDim = 2000, quality = 0.82, maxSizeBytes = 1_500_000 } = opts

  const hasCanvas =
    typeof document !== 'undefined' && typeof createImageBitmap === 'function'
  if (!hasCanvas || !file.type.startsWith('image/')) {
    return fileToDataUrl(file)
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return fileToDataUrl(file)
  }

  let curMaxDim = maxDim
  let curQuality = quality
  let outDataUrl = ''

  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, curMaxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      outDataUrl = await fileToDataUrl(file)
      break
    }
    // 白底填充，避免 PNG 透明区在 JPEG 下变黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', curQuality),
    )
    if (!blob) {
      outDataUrl = await fileToDataUrl(file)
      break
    }
    outDataUrl = await blobToDataUrl(blob)

    if (blob.size <= maxSizeBytes) break
    // 未达标：先降质量，降到 0.5 仍超再降分辨率
    if (curQuality > 0.5) {
      curQuality = Math.max(0.5, curQuality - 0.15)
    } else {
      curMaxDim = Math.max(800, Math.round(curMaxDim * 0.8))
    }
  }

  bitmap.close?.()
  return outDataUrl || fileToDataUrl(file)
}

async function postJson(url: string, body: unknown): Promise<{ text: string; success: boolean }> {
  // 客户端 60s 兜底（与 CloudBase 上游 nginx 网关一致）：超时给明确提示而不是默默挂起
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err && (err as any).name === 'AbortError') {
      throw new Error('识别超时（60s）。请将截图裁小（建议宽度 ≤ 1500px）后重试，或在 CloudBase 环境变量里把 ZHIPU_MODEL 改为 glm-4.6v-flashx 高速模型。')
    }
    throw err
  }
  clearTimeout(timer)
  let data: any = null
  try {
    data = await resp.json()
  } catch {
    // ignore
  }
  if (!resp.ok || !data?.success) {
    const msg = data?.error || `请求失败（${resp.status}）`
    throw new Error(msg)
  }
  return { text: data.text ?? '', success: true }
}

export type RecognizeMode = 'focus' | 'full'

/** 票规图片识别 → 返回模型原始文本（前端 parseAiResultToRule 负责解析） */
export async function recognizeTicketRule(
  image: Blob,
  mode: RecognizeMode = 'full',
  targetCabin = '',
): Promise<string> {
  // 票规表需要在保留可读性的同时尽量压小：智谱处理大图耗时远超 CloudBase 网关 60s 超时窗口。
  // 1500px / 0.7 质量 / 900KB 上限 → 实测 <150KB base64、智谱 8~20s 返回，远低于 60s。
  const dataUrl = await compressImageToDataUrl(image, {
    maxDim: 1500,
    quality: 0.7,
    maxSizeBytes: 900_000,
  })
  const { text } = await postJson('/api/recognize', {
    image: dataUrl,
    mode,
    targetCabin: targetCabin || '',
  })
  return text
}

/** 票规文本解析 → 返回模型原始文本 */
export async function parseTicketRuleText(text: string): Promise<string> {
  const { text: out } = await postJson('/api/parse-text', { text })
  return out
}

/**
 * 航班截图识别 → 返回结构化航班信息
 * 后端用视觉模型输出 JSON {flight_number, cabin_code, departure_date, departure_time, airline_name}
 */
export async function recognizeFlightInfo(image: Blob): Promise<{
  flightNo: string
  cabinCode: string
  departureTime: string
  airlineName: string
}> {
  // 航班截图信息密度低，可更激进压缩（尺寸 + 质量），进一步降低超限概率
  const dataUrl = await compressImageToDataUrl(image, {
    maxDim: 1600,
    quality: 0.8,
    maxSizeBytes: 1_200_000,
  })
  const { text } = await postJson('/api/recognize-flight', { image: dataUrl })
  // 尝试解析 JSON；解析失败则原样抛出，由调用方提示手动输入
  let obj: any = null
  try {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    obj = first >= 0 && last > first ? JSON.parse(text.slice(first, last + 1)) : JSON.parse(text)
  } catch {
    throw new Error('航班信息识别结果解析失败，请手动输入')
  }
  const depDate = (obj.departure_date || '').toString().trim()
  const depTime = (obj.departure_time || '').toString().trim()
  const departureTime = depDate && depTime ? `${depDate}T${depTime}` : ''
  return {
    flightNo: (obj.flight_number || '').toString().trim().toUpperCase(),
    cabinCode: (obj.cabin_code || '').toString().trim().toUpperCase(),
    departureTime,
    airlineName: (obj.airline_name || '').toString().trim(),
  }
}
