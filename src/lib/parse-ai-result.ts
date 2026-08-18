import type { IParsedRule, ITimeInterval, ICabinRateRow } from '@/data/parsed-rule'

/**
 * 从 AI 返回的文本中，尝试提取/解析出结构化的 IParsedRule
 *
 * 支持两种格式：
 * 1. 单舱位聚焦模式 —— AI 输出嵌套 JSON (cabin_code, change{intervals[],fees[]}, refund{intervals[],fees[]}, endorsement, open_rule)
 * 2. 全量识别模式 —— AI 输出自然语言 + markdown 表格，启发式解析
 */
export function parseAiResultToRule(rawText: string): Partial<IParsedRule> {
  const text = rawText.trim()
  if (!text) return {}

  // ===== 策略 0：尝试直接解析 JSON（单舱位聚焦模式优先）=====
  const jsonResult = tryParseJsonPayload(text)
  if (jsonResult) {
    return jsonResult
  }

  // ===== 策略 1：自然语言 + markdown 表格（全量识别/老格式） =====
  const result: Partial<IParsedRule> = {}

  // 签转规则
  // 只有当 AI 明确提到"签转"二字且有明确肯定/否定表述时，才设置为 true/false
  // 否则保持 undefined，合并后为 'unknown'（表示票规表未包含签转规则）
  if (/签转[：:]\s*(允许|可以|是|\bYES\b|\bTRUE\b)/i.test(text)) {
    result.transferAllowed = true
  } else if (/签转[：:]\s*(不允许|不得|不能|否|\bNO\b|\bFALSE\b)/i.test(text)) {
    result.transferAllowed = false
  } else if (/(允许签转|可以签转|签转.*允许)/.test(text) && !/(不允许签转|不得签转|不能签转|签转.*不允许)/.test(text)) {
    result.transferAllowed = true
  } else if (/(不允许签转|不得签转|不能签转|签转.*不允许)/.test(text)) {
    result.transferAllowed = false
  }

  // 航空公司名：先从标题提取（如"桂林航空国内航班多等级舱位设置表"）
  const airlineTitleMatch =
    text.match(/([\u4e00-\u9fa5]{2,6}(?:航空|航空公司|航空股份))/) ??
    text.match(/(中国国际航空|中国东方航空|中国南方航空|东方航空|南方航空|国际航空|海南航空|厦门航空|深圳航空|四川航空|春秋航空|吉祥航空|华夏航空|长龙航空|九元航空|桂林航空|青岛航空|天津航空|首都航空|西部航空|祥鹏航空|昆明航空|河北航空|江西航空|福州航空|乌鲁木齐航空|北部湾航空)/)
  if (airlineTitleMatch) {
    result.airline = airlineTitleMatch[1].replace('航空公司', '航空').replace('航空股份', '航空')
  }

  // 时间区间（先尝试提取）
  const changeIntervals = extractIntervalsFromText(text, 'change')
  const refundIntervals = extractIntervalsFromText(text, 'refund')

  if (changeIntervals.length === 0 && refundIntervals.length === 0) {
    const defaultIntervals = getDefault5Intervals()
    result.changeIntervals = defaultIntervals
    result.refundIntervals = defaultIntervals.map((it) => ({ ...it, id: `r-${it.id}` }))
  } else {
    result.changeIntervals = changeIntervals.length > 0
      ? changeIntervals
      : refundIntervals.map((it) => ({ ...it, id: `c-${it.id}` }))
    result.refundIntervals = refundIntervals.length > 0
      ? refundIntervals
      : changeIntervals.map((it) => ({ ...it, id: `r-${it.id}` }))
  }

  // 舱位行
  const refundCount = result.refundIntervals?.length ?? 0
  const changeCount = result.changeIntervals?.length ?? 0
  const expectedCols = Math.max(changeCount, refundCount)
  const cabinRows = extractCabinRowsFromText(text, expectedCols, refundCount, changeCount)
  if (cabinRows.length > 0) {
    result.cabinRows = cabinRows.map((row) => ({
      ...row,
      changeRates: padArray(row.changeRates, result.changeIntervals?.length ?? 0, ''),
      refundRates: padArray(row.refundRates, result.refundIntervals?.length ?? 0, ''),
    }))
  }

  // 费率完整性校验：如果某行退票费率和变更费率数量明显不匹配，给出警告标志
  // （不直接改数据，只在返回对象里加 warning 信息）
  if (result.cabinRows && result.cabinRows.length > 0 && result.changeIntervals && result.refundIntervals) {
    const changeLen = result.changeIntervals.length
    const refundLen = result.refundIntervals.length
    for (const row of result.cabinRows) {
      const changeFilled = row.changeRates.filter(Boolean).length
      const refundFilled = row.refundRates.filter(Boolean).length
      // 如果两边都有数据但数量差 >= 2，很可能是识别串列了
      if (changeFilled > 0 && refundFilled > 0 && Math.abs(changeFilled - refundFilled) >= 2) {
        ;(result as any)._parseWarning = '部分舱位退票/变更费率数量不匹配，可能存在识别误差，请手动核对'
        break
      }
    }
  }

  return result
}

// ==================== JSON 解析（新格式：change/refund 嵌套） ====================

function tryParseJsonPayload(text: string): Partial<IParsedRule> | null {
  // 找第一个 { 到最后一个 }
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null

  let jsonStr = text.slice(firstBrace, lastBrace + 1)
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim()

  let obj: any
  try {
    obj = JSON.parse(jsonStr)
  } catch {
    return null
  }

  if (!obj || typeof obj !== 'object') return null

  // 解析 change / refund 嵌套结构
  const changeData = obj.change
  const refundData = obj.refund

  // 至少要有 change 或 refund 之一
  if (!changeData && !refundData) {
    // 尝试老格式（扁平 refund_fees / change_fees）
    const oldResult = tryParseLegacyJson(obj)
    if (oldResult) return oldResult
    return null
  }

  const changeIntervals: ITimeInterval[] = []
  const refundIntervals: ITimeInterval[] = []
  let changeFees: string[] = []
  let refundFees: string[] = []

  if (changeData && Array.isArray(changeData.intervals)) {
    for (const desc of changeData.intervals) {
      const iv = parseIntervalDescription(String(desc ?? ''), idxToLabel(changeIntervals.length, 'change'))
      changeIntervals.push(iv)
    }
    changeFees = Array.isArray(changeData.fees)
      ? changeData.fees.map((v: any) => String(v ?? ''))
      : new Array(changeIntervals.length).fill('')
    // 补齐
    while (changeFees.length < changeIntervals.length) changeFees.push('')
  }

  if (refundData && Array.isArray(refundData.intervals)) {
    for (const desc of refundData.intervals) {
      const iv = parseIntervalDescription(String(desc ?? ''), idxToLabel(refundIntervals.length, 'refund'))
      refundIntervals.push(iv)
    }
    refundFees = Array.isArray(refundData.fees)
      ? refundData.fees.map((v: any) => String(v ?? ''))
      : new Array(refundIntervals.length).fill('')
    while (refundFees.length < refundIntervals.length) refundFees.push('')
  }

  // 舱位代码
  const cabinCode = normalizeCabinCode(obj.cabin_code)

  const result: Partial<IParsedRule> = {
    changeIntervals: changeIntervals.length > 0 ? changeIntervals : undefined,
    refundIntervals: refundIntervals.length > 0 ? refundIntervals : undefined,
  }

  if (cabinCode) {
    result.cabinRows = [
      {
        cabinCode,
        changeRates: changeFees,
        refundRates: refundFees,
        discount: typeof obj.discount === 'string' && obj.discount ? obj.discount.trim() : undefined,
      },
    ]
  }

  // 签转
  if (typeof obj.endorsement === 'string' && obj.endorsement) {
    const e = obj.endorsement.trim()
    let transferVal: boolean | undefined
    if (/不允许|不得|不能|否|false|不可以/i.test(e)) {
      transferVal = false
    } else if (/允许|可以|是|yes|true/i.test(e)) {
      transferVal = true
    }
    if (transferVal !== undefined) {
      result.transferAllowed = transferVal
      // 同时写到 per-cabin 行（聚焦模式只有一行）
      if (result.cabinRows && result.cabinRows.length > 0) {
        result.cabinRows = result.cabinRows.map((r) => ({
          ...r,
          transferAllowed: transferVal,
        }))
      }
    }
  }

  if (typeof obj.open_rule === 'string' && obj.open_rule) {
    result.openTicketRule = obj.open_rule
  }

  return result
}

/** 兼容老格式（扁平 refund_fees / change_fees） */
function tryParseLegacyJson(obj: any): Partial<IParsedRule> | null {
  const cabinCode = normalizeCabinCode(obj.cabin_code)
  if (!cabinCode) return null

  const refundFees: string[] = Array.isArray(obj.refund_fees)
    ? obj.refund_fees.map((v: any) => String(v ?? ''))
    : []
  const changeFees: string[] = Array.isArray(obj.change_fees)
    ? obj.change_fees.map((v: any) => String(v ?? ''))
    : []

  const len = Math.max(refundFees.length, changeFees.length, 5)
  const defaults = len <= 4 ? getDefault4Intervals() : getDefault5Intervals()

  const result: Partial<IParsedRule> = {
    cabinRows: [
      {
        cabinCode,
        changeRates: padArray(changeFees, defaults.length, ''),
        refundRates: padArray(refundFees, defaults.length, ''),
        discount: typeof obj.discount === 'string' && obj.discount ? obj.discount.trim() : undefined,
      },
    ],
    changeIntervals: defaults,
    refundIntervals: defaults.map((it) => ({ ...it, id: `r-${it.id}` })),
  }

  if (typeof obj.endorsement === 'string') {
    const e = obj.endorsement.trim()
    let transferVal: boolean | undefined
    if (/允许|可以|是|yes|true/i.test(e) && !/不允许|不得|不能|否|false/i.test(e)) {
      transferVal = true
    } else if (/不允许|不得|不能|否|false|不可以/i.test(e)) {
      transferVal = false
    }
    if (transferVal !== undefined) {
      result.transferAllowed = transferVal
      result.cabinRows = result.cabinRows.map((r) => ({
        ...r,
        transferAllowed: transferVal,
      }))
    }
  }
  if (typeof obj.open_rule === 'string' && obj.open_rule) {
    result.openTicketRule = obj.open_rule
  }

  return result
}

// ==================== 时间区间解析 ====================

/**
 * 从区间描述字符串中解析出 ITimeInterval
 * 支持的描述示例：
 * - "航班计划出港时间前168小时（含）之前"
 * - "前168小时(不含)至前48小时(含)"
 * - "航班计划出港时间前48小时（不含）至航班计划出港时间前4小时（含）"
 * - "起飞后" / "航班起飞后"
 * - "前30天之前"
 */
export function parseIntervalDescription(desc: string, fallbackLabel?: string): ITimeInterval {
  let d = desc.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')')
  // 去除"取消座位"等无关后缀文字
  d = d.replace(/取消座位.*$/, '')
  // 去除"前取消座位"等变体
  d = d.replace(/前取消座位/, '前')
  d = d.replace(/后取消座位/, '后')


  // after 类型：起飞后
  if (/起飞后|出港后|航班起飞后|至航班起飞后/.test(d)) {
    return {
      id: genId(),
      type: 'after',
      value1: 0,
      unit: 'hour',
      rawText: desc || '起飞后',
    }
  }

  // 抽取所有小时/天/分钟数值
  const hourMatches: number[] = []
  const dayMatches: number[] = []
  const minuteMatches: number[] = []
  // 支持"336小时" "14天"等任意数值（不限制在常见范围内）
  const hourRe = /(\d+)\s*小时/g
  const dayRe = /(\d+)\s*天/g
  const minRe = /(\d+)\s*(?:分钟|min|分)/gi
  let m: RegExpExecArray | null
  while ((m = hourRe.exec(d)) !== null) hourMatches.push(Number(m[1]))
  while ((m = dayRe.exec(d)) !== null) dayMatches.push(Number(m[1]))
  while ((m = minRe.exec(d)) !== null) minuteMatches.push(Number(m[1]))

  // 天转小时（但如果描述本身是天单位，保留 day）
  // 优先按描述中的第一个数字的单位决定 unit
  // 如果混合单位，统一转 hour

  const hasHours = hourMatches.length > 0
  const hasDays = dayMatches.length > 0
  const hasMinutes = minuteMatches.length > 0

  if (!hasHours && !hasDays && !hasMinutes) {
    return {
      id: genId(),
      type: 'before',
      value1: 24,
      unit: 'hour',
      rawText: desc || fallbackLabel || '未识别',
    }
  }

  // between 类型：有 2 个以上时间点
  // 注意：即使同一单位也需要 >=2 个数值才判定为 between
  if (
    (hasHours && hourMatches.length >= 2) ||
    (hasDays && dayMatches.length >= 2) ||
    (hasMinutes && minuteMatches.length >= 2) ||
    hasHours && hasDays ||
    hasHours && hasMinutes ||
    hasDays && hasMinutes
  ) {
    // 收集所有数值（统一转分钟用于排序）
    const values: Array<{ value: number; unit: 'hour' | 'day' | 'minute' }> = []
    for (const h of hourMatches) values.push({ value: h, unit: 'hour' })
    for (const d2 of dayMatches) values.push({ value: d2, unit: 'day' })
    for (const m2 of minuteMatches) values.push({ value: m2, unit: 'minute' })

    // 按分钟值从大到小排序
    values.sort((a, b) => {
      const am = toMinutes(a.value, a.unit)
      const bm = toMinutes(b.value, b.unit)
      return bm - am
    })

    // 取最大的作为 value1，最小的作为 value2（区间两端）
    const v1 = values[0]
    const v2 = values[values.length - 1]

    // 如果单位不同，统一用 hour
    let unit: 'hour' | 'day' = v1.unit === 'day' ? 'day' : 'hour'
    let value1 = v1.value
    let value2 = v2.value
    if (v1.unit !== v2.unit || v1.unit === 'minute' || v2.unit === 'minute') {
      unit = 'hour'
      value1 = toMinutes(v1.value, v1.unit) / 60
      value2 = toMinutes(v2.value, v2.unit) / 60
      // 若不是整数，保留 1 位小数
      value1 = Math.round(value1 * 10) / 10
      value2 = Math.round(value2 * 10) / 10
    }

    return {
      id: genId(),
      type: 'between',
      value1,
      value2,
      unit,
      rawText: desc || fallbackLabel,
    }
  }

  // before 类型：单个时间点
  if (hasHours) {
    return {
      id: genId(),
      type: 'before',
      value1: hourMatches[0],
      unit: 'hour',
      rawText: desc || fallbackLabel,
    }
  }
  if (hasMinutes) {
    // 分钟转小时
    const hours = Math.round((minuteMatches[0] / 60) * 10) / 10
    return {
      id: genId(),
      type: 'before',
      value1: hours,
      unit: 'hour',
      rawText: desc || fallbackLabel,
    }
  }

  return {
    id: genId(),
    type: 'before',
    value1: dayMatches[0],
    unit: 'day',
    rawText: desc || fallbackLabel,
  }
}

// ==================== 工具函数 ====================

/** 舱位代码规范化：去空格、转大写、去"舱"字，允许字母+数字组合 */
export function normalizeCabinCode(code: unknown): string {
  if (typeof code !== 'string') return ''
  return code
    .trim()
    .toUpperCase()
    .replace(/舱/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * 拆分多舱位同行的舱位代码字符串
 * 支持的分隔符：/、、、,、空格、\\
 * 单字母舱位直接返回单个元素数组；字母+数字也视为单个舱位
 * 示例：
 *   "D/Z" → ["D", "Z"]
 *   "D/Z/R/I" → ["D", "Z", "R", "I"]
 *   "M、E" → ["M", "E"]
 *   "Y1" → ["Y1"]
 *   "B" → ["B"]
 */
export function splitCabinCodes(raw: string): string[] {
  const s = raw.trim().toUpperCase().replace(/舱/g, '')
  // 先用常见分隔符切分
  const parts = s.split(/[\/、，,\s\\]+/).filter(Boolean)
  // 每个部分再规范化
  const codes: string[] = []
  for (const part of parts) {
    const cleaned = part.replace(/[^A-Z0-9]/g, '')
    if (!cleaned) continue
    // 如果是纯单字符（单字母），继续检查是否需要进一步拆分
    // 但字母+数字（如 Y1）整体保留
    codes.push(cleaned)
  }
  // 去重、保持顺序
  return [...new Set(codes)]
}

function padArray<T>(arr: T[], len: number, fill: T): T[] {
  if (arr.length >= len) return arr.slice(0, len)
  return [...arr, ...new Array(len - arr.length).fill(fill)]
}

/** 默认 4 区间模板（常见 4 档结构：168h / 168-48h / 48-4h / 4h后） */
export function getDefault4Intervals(): ITimeInterval[] {
  return [
    { id: 'd1', type: 'before', value1: 168, unit: 'hour', rawText: '前168小时(含)之前' },
    { id: 'd2', type: 'between', value1: 168, value2: 48, unit: 'hour', rawText: '前168小时至前48小时' },
    { id: 'd3', type: 'between', value1: 48, value2: 4, unit: 'hour', rawText: '前48小时至前4小时' },
    { id: 'd4', type: 'after', value1: 0, unit: 'hour', rawText: '前4小时至起飞后' },
  ]
}

/** 默认 5 区间模板（常见 5 档结构） */
export function getDefault5Intervals(): ITimeInterval[] {
  return [
    { id: 'd1', type: 'before', value1: 30, unit: 'day', rawText: '30天之前' },
    { id: 'd2', type: 'between', value1: 30, value2: 7, unit: 'day', rawText: '30天至7天前' },
    { id: 'd3', type: 'between', value1: 7, value2: 48, unit: 'hour', rawText: '7天至48小时前' },
    { id: 'd4', type: 'between', value1: 48, value2: 4, unit: 'hour', rawText: '48小时至4小时前' },
    { id: 'd5', type: 'after', value1: 0, unit: 'hour', rawText: '4小时至起飞后' },
  ]
}

// 兼容旧调用
export function getDefault5IntervalsBackCompat(): ITimeInterval[] {
  return getDefault5Intervals()
}

// 保持原函数名兼容
export const getDefaultIntervals = getDefault5Intervals

function idxToLabel(idx: number, kind: string): string {
  return `${kind === 'change' ? '改签' : '退票'}区间${idx + 1}`
}

// ==================== 文本启发式解析（全量/老格式） ====================

function extractIntervalsFromText(text: string, kind: 'change' | 'refund'): ITimeInterval[] {
  const intervals: ITimeInterval[] = []
  const sectionText = getSectionText(text, kind)
  if (!sectionText) return intervals

  const dayBeforeRegex = /(?:起飞|航班|离站)(?:规定)?(?:离站时间)?(?:前|\s*前\s*)?\s*(\d+)\s*天(?:\s*之?前|\s*以前)?/g
  let m: RegExpExecArray | null
  const daySet = new Set<number>()
  while ((m = dayBeforeRegex.exec(sectionText)) !== null) {
    daySet.add(Number(m[1]))
  }

  const betweenDayRegex = /(\d+)\s*天[（(]含[)）]\s*至.*?(\d+)\s*天(?:之?前|以前)/g
  const betweenPairs: Array<[number, number, 'day' | 'hour']> = []
  while ((m = betweenDayRegex.exec(sectionText)) !== null) {
    betweenPairs.push([Number(m[1]), Number(m[2]), 'day'])
  }

  const hourBeforeRegex = /(?:起飞|航班|离站)(?:规定)?(?:离站时间)?(?:前|\s*前\s*)?\s*(\d+)\s*小时(?:\s*之?前|\s*以前)?/g
  const hourSet = new Set<number>()
  while ((m = hourBeforeRegex.exec(sectionText)) !== null) {
    hourSet.add(Number(m[1]))
  }

  const betweenHourRegex = /(\d+)\s*小时[（(]含[)）]\s*至.*?(\d+)\s*小时(?:之?前|以前)/g
  while ((m = betweenHourRegex.exec(sectionText)) !== null) {
    betweenPairs.push([Number(m[1]), Number(m[2]), 'hour'])
  }

  if (/起飞后|出港后|航班起飞后/.test(sectionText)) {
    intervals.push({ id: genId(), type: 'after', value1: 0, unit: 'hour', rawText: '起飞后' })
  }

  for (const [v1, v2, unit] of betweenPairs) {
    intervals.push({
      id: genId(),
      type: 'between',
      value1: v1,
      value2: v2,
      unit,
      rawText: `${v1}${unit === 'day' ? '天' : '小时'}至${v2}${unit === 'day' ? '天' : '小时'}前`,
    })
  }

  const usedValues = new Set<number>()
  for (const [v1] of betweenPairs) usedValues.add(v1)

  for (const v of daySet) {
    if (!usedValues.has(v)) {
      intervals.push({ id: genId(), type: 'before', value1: v, unit: 'day', rawText: `前${v}天` })
    }
  }
  for (const v of hourSet) {
    if (!usedValues.has(v)) {
      intervals.push({ id: genId(), type: 'before', value1: v, unit: 'hour', rawText: `前${v}小时` })
    }
  }

  intervals.sort((a, b) => {
    const aHours = a.unit === 'day' ? a.value1 * 24 : a.value1
    const bHours = b.unit === 'day' ? b.value1 * 24 : b.value1
    return bHours - aHours
  })

  return intervals
}

function getSectionText(text: string, kind: 'change' | 'refund'): string {
  const key = kind === 'refund' ? '自愿退票' : '自愿变更'
  const altKey = kind === 'refund' ? '退票' : '变更'
  const idx = text.indexOf(key)
  if (idx === -1) {
    return text.includes(altKey) ? text : ''
  }
  return text.slice(idx, idx + 1500)
}

function extractCabinRowsFromText(text: string, expectedCols: number, refundColCount?: number, changeColCount?: number): ICabinRateRow[] {
  const rows: ICabinRateRow[] = []

  const tableLineRegex = /^\|\s*([^|\n]{1,40})\s*\|(.+)$/gm
  let m: RegExpExecArray | null
  const rawRows: Array<{ cabinCell: string; rates: string[]; discount?: string }> = []
  while ((m = tableLineRegex.exec(text)) !== null) {
    const cabinCell = m[1].trim()
    const rest = m[2]
    if (/舱位(等级|代码|名称)?|票价|等级|类别|fare|cabin/i.test(cabinCell)) continue
    if (/^[\u4e00-\u9fa5]{2,}$/.test(cabinCell) && !/^[A-Z]+$/.test(cabinCell)) {
      continue
    }
    const rates = rest.match(/(\d+%|免费|不退|不得退(票)?|不予退(票)?|不允许|不能退|允许)/g) ?? []
    // 折扣值提取：该行第二列（舱位代码列后紧邻列）如果是 x% 格式且不是费率数字则为折扣
    // 策略：取 rest 中第一个 | 单元格的值，如果匹配 100% 或 92% 等且值 > 50% 视为折扣列
    let discount: string | undefined
    const cells = rest.split('|').map((s) => s.trim()).filter((s) => s.length > 0)
    if (cells.length > 0) {
      const firstCell = cells[0]
      // 第一格如果是 x% 且数值偏大（折扣列一般是 60%-100%），判定为折扣
      const dm = firstCell.match(/^(\d{1,3})%$/)
      if (dm) {
        const num = parseInt(dm[1], 10)
        if (num >= 30 && num <= 100) {
          discount = `${num}%`
        }
      }
    }
    rawRows.push({ cabinCell, rates, discount })
  }

  for (const row of rawRows) {
    const chars = row.cabinCell.match(/[A-Z]/g) ?? []
    if (chars.length === 0) continue

    const rates = row.rates
    for (const c of chars) {
      if (rows.find((r) => r.cabinCode === c)) continue

      const changeRates: string[] = []
      const refundRates: string[] = []

      if (rates.length >= 2) {
        // 如果已知退票列数和变更列数，严格按数量切分
        if (refundColCount != null && changeColCount != null && rates.length >= refundColCount + changeColCount) {
          // 前 refundColCount 个归退票，后 changeColCount 个归变更
          refundRates.push(...rates.slice(0, refundColCount))
          changeRates.push(...rates.slice(refundColCount, refundColCount + changeColCount))
        } else {
          // 退化：对半切（兼容老格式）
          const half = Math.floor(rates.length / 2)
          refundRates.push(...rates.slice(0, half))
          changeRates.push(...rates.slice(half, half * 2))
        }
      }

      rows.push({
        cabinCode: c,
        changeRates: changeRates.length > 0 ? changeRates : new Array(expectedCols || 1).fill(''),
        refundRates: refundRates.length > 0 ? refundRates : new Array(expectedCols || 1).fill(''),
        discount: row.discount,
      })
    }
  }

  if (rows.length === 0) {
    const cabinListMatch = text.match(/舱位等级[：:][\s]*([A-Z\/、,，\s]+)/)
    if (cabinListMatch) {
      const cabinChars = cabinListMatch[1].match(/[A-Z]/g) ?? []
      for (const c of cabinChars) {
        if (!rows.find((r) => r.cabinCode === c)) {
          rows.push({
            cabinCode: c,
            changeRates: new Array(expectedCols || 1).fill(''),
            refundRates: new Array(expectedCols || 1).fill(''),
          })
        }
      }
    }
  }

  if (rows.length === 0 || rows.every((r) => r.changeRates.every((v) => !v))) {
    const altRegex =
      /([A-Z])\s*舱[^\n]{0,10}?(?:改签|变更|改期)[^\n]*?(\d+%|免费|不退|不得退|不予退)[^\n]*?(?:退票|退)[^\n]*?(\d+%|免费|不退|不得退|不予退)/g
    while ((m = altRegex.exec(text)) !== null) {
      const cabin = m[1].toUpperCase()
      const changeRate = m[2]
      const refundRate = m[3]
      const existing = rows.find((r) => r.cabinCode === cabin)
      if (existing) {
        if (!existing.changeRates.some((v) => v)) {
          existing.changeRates = new Array(expectedCols || 1).fill(changeRate)
        }
        if (!existing.refundRates.some((v) => v)) {
          existing.refundRates = new Array(expectedCols || 1).fill(refundRate)
        }
      } else {
        rows.push({
          cabinCode: cabin,
          changeRates: new Array(expectedCols || 1).fill(changeRate),
          refundRates: new Array(expectedCols || 1).fill(refundRate),
        })
      }
    }
  }

  if (rows.length === 0) {
    const cabinCandidates = text.match(/[A-Z](?=\s*舱)/g) ?? []
    const unique = [...new Set(cabinCandidates)]
    for (const c of unique) {
      rows.push({
        cabinCode: c,
        changeRates: new Array(expectedCols || 1).fill(''),
        refundRates: new Array(expectedCols || 1).fill(''),
      })
    }
  }

  return rows
}

function genId() {
  return Math.random().toString(36).slice(2, 9)
}

/** 把时间值统一换算为分钟（用于排序/比较） */
function toMinutes(value: number, unit: 'hour' | 'day' | 'minute'): number {
  switch (unit) {
    case 'day':
      return value * 24 * 60
    case 'hour':
      return value * 60
    case 'minute':
      return value
    default:
      return value * 60
  }
}

/** 查找匹配的舱位费率行（规范化匹配） */
export function findCabinRow(
  cabinRows: ICabinRateRow[],
  targetCabin: string,
): ICabinRateRow | undefined {
  const target = normalizeCabinCode(targetCabin)
  if (!target) return undefined
  return cabinRows.find((r) => normalizeCabinCode(r.cabinCode) === target)
}
