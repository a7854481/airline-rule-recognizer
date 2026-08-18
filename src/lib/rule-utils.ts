import type { ICabinRateRow, IParsedRule, ITimeInterval } from '@/data/parsed-rule';
import type { IFlightInfo } from '@/data/flight-info';
import { normalizeCabinCode } from '@/lib/parse-ai-result';

/** 根据时间区间 + 起飞时间，计算出具体的截止时间点（精确到分钟） */
export function calcIntervalDeadline(
  interval: ITimeInterval,
  departureDate: Date,
): Date {
  const d = new Date(departureDate.getTime())

  if (interval.type === 'after') {
    // 起飞/出港后 → 截止点就是起飞时间本身（最后一档）
    return d
  }

  // type=before: 截止点 = 起飞前 value1 小时/天
  // type=between: 截止点 = 起飞前 value2 小时/天（区间右侧边界，即"前M小时（含）"）
  const value = interval.type === 'between' ? (interval.value2 ?? interval.value1) : interval.value1

  if (interval.unit === 'hour') {
    d.setMinutes(d.getMinutes() - value * 60)
  } else {
    // day — 往前推 N 个自然日的相同时刻
    d.setDate(d.getDate() - value)
  }

  return d
}

/** 格式化日期为 YYYY-MM-DD HH:MM */
export function formatDateTime(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

/**
 * 对一组区间，按截止时间从早到晚排序
 * 返回每个区间对应的 { deadline, interval, isAfter }
 * 最后一项若是 after 类型（起飞后），则 deadline = 起飞时间，标记 isAfter
 */
export function sortIntervalsByDeadline(
  intervals: ITimeInterval[],
  departureDate: Date,
): { interval: ITimeInterval; deadline: Date; isAfter: boolean }[] {
  const list = intervals.map((it) => ({
    interval: it,
    deadline: calcIntervalDeadline(it, departureDate),
    isAfter: it.type === 'after',
  }))

  list.sort((a, b) => {
    // after 类型（起飞后）永远排最后
    if (a.isAfter && !b.isAfter) return 1
    if (!a.isAfter && b.isAfter) return -1
    return a.deadline.getTime() - b.deadline.getTime()
  })

  return list
}

/** 从 IParsedRule 中找到指定舱位的行（规范化匹配） */
export function findCabinRow(parsedRule: IParsedRule, cabinCode: string) {
  const target = normalizeCabinCode(cabinCode);
  if (!target) return undefined;
  return parsedRule.cabinRows.find(
    (r) => normalizeCabinCode(r.cabinCode) === target,
  );
}

/**
 * 对舱位行执行「签转规则向上继承」逻辑：
 * - 如果某行 transferAllowed 为空 / 'unknown' / 'inherit'，从上方最近的有明确值的行继承
 * - 继承方向必须是向上（舱位等级更高的方向），不能向下
 * - 继承后标记 transferInheritedFrom，便于界面展示「继承自X舱」
 * - 如果向上找不到任何有值的签转规则，保持 'unknown'，不要默认 false
 *
 * 同时返回一个新的 cabinRows 数组（不修改原数组）
 */
/**
 * 舱位行定位精度校验（返回带有 rowWarning 的新数组）
 * 校验内容：
 * 1. 若目标舱位的 discount 为空，提示「折扣列未识别，舱位行可能定位错误」
 * 2. 若相邻舱位（当前行 vs 上一行）费率完全相同但折扣不同，提示「与上方舱位费率完全相同，请确认是否正确」
 */
export function validateCabinRows(
  cabinRows: ICabinRateRow[],
  targetCabin?: string,
): ICabinRateRow[] {
  if (cabinRows.length === 0) return cabinRows;

  const target = targetCabin?.toUpperCase();
  const result: ICabinRateRow[] = [];

  for (let i = 0; i < cabinRows.length; i++) {
    const row = cabinRows[i];
    const warnings: string[] = [];
    const isTarget = target && row.cabinCode.toUpperCase() === target;

    // 校验 1：折扣列缺失（仅对目标舱位提示，避免过多噪音）
    if (isTarget && !row.discount) {
      warnings.push('折扣列未识别，舱位行可能定位错误，请核对');
    }

    // 校验 2：与上方相邻舱位费率完全相同
    if (i > 0) {
      const prev = cabinRows[i - 1];
      const refundSame =
        row.refundRates.length === prev.refundRates.length &&
        row.refundRates.every((v, idx) => v === prev.refundRates[idx]);
      const changeSame =
        row.changeRates.length === prev.changeRates.length &&
        row.changeRates.every((v, idx) => v === prev.changeRates[idx]);
      const hasRates = row.refundRates.some(Boolean) || row.changeRates.some(Boolean);
      const discountDifferent =
        row.discount && prev.discount && row.discount !== prev.discount;
      if (refundSame && changeSame && hasRates && discountDifferent) {
        warnings.push(`与上方${prev.cabinCode}舱费率完全相同，请确认是否正确`);
      }
    }

    result.push({
      ...row,
      rowWarning: warnings.length > 0 ? warnings.join('；') : row.rowWarning,
    });
  }

  return result;
}

/**
 * 签转向上继承逻辑（表格中垂直合并单元格，空值向上继承最近的有值行）
 */
export function applyTransferInheritance(
  cabinRows: ICabinRateRow[],
): ICabinRateRow[] {
  if (cabinRows.length === 0) return cabinRows;

  const result: ICabinRateRow[] = [];
  let lastKnownValue: boolean | null = null;
  let lastKnownCabin = '';

  for (const row of cabinRows) {
    const t = row.transferAllowed;
    if (t === true || t === false) {
      // 明确值 —— 记录为最近已知值
      lastKnownValue = t;
      lastKnownCabin = row.cabinCode;
      result.push({ ...row, transferAllowed: t });
    } else if (lastKnownValue !== null) {
      // 空/未知，但上方有明确值 → 继承
      result.push({
        ...row,
        transferAllowed: lastKnownValue,
        transferInheritedFrom: lastKnownCabin,
      });
    } else {
      // 空且上方也没有 → 保持 unknown
      result.push({
        ...row,
        transferAllowed: 'unknown',
      });
    }
  }

  return result;
}

/**
 * 获取目标舱位的签转规则（优先 per-cabin，兜底全局）
 */
export function getTransferForCabin(
  parsedRule: IParsedRule,
  cabinCode: string,
): boolean | 'unknown' {
  const row = findCabinRow(parsedRule, cabinCode);
  if (row && (row.transferAllowed === true || row.transferAllowed === false)) {
    return row.transferAllowed;
  }
  // 兜底：全局值
  return parsedRule.transferAllowed;
}

/**
 * 生成最终格式化输出文本
 * 严格按照：
 * ✈️ XX航国内航班（XX舱）
 * 退票: {时间1}前，退票费XX/人；退票: {时间2}前，退票费XX/人；...
 * 改签: {时间1}前，改签费XX/人；改签: {时间2}前，改签费XX/人；...
 * 签转：允许/不允许
 */
export function buildOutputText(
  parsedRule: IParsedRule,
  flightInfo: IFlightInfo,
): string {
  const lines: string[] = []

  // 第 1 行：标题
  lines.push(`✈️ ${flightInfo.airline}国内航班（${flightInfo.cabinCode.toUpperCase()}舱）`)

  const departureDate = new Date(flightInfo.departureTime)
  const cabinRow = findCabinRow(parsedRule, flightInfo.cabinCode)

  // 退票行
  if (parsedRule.refundIntervals.length > 0 && cabinRow) {
    const sorted = sortIntervalsByDeadline(parsedRule.refundIntervals, departureDate)
    const parts = sorted.map((item, idx) => {
      const rate = cabinRow.refundRates[idx] ?? '信息不清晰'
      const timeStr = formatDateTime(item.deadline)
      const suffix = item.isAfter ? '后' : '前'
      const rateWithSuffix = rate === '免费' ? '免费/人' : `${rate}/人`
      return `退票: ${timeStr}${suffix}，退票费${rateWithSuffix}`
    })
    lines.push(parts.join('；'))
  } else if (parsedRule.refundIntervals.length > 0 && !cabinRow) {
    lines.push('退票: 未找到对应舱位费率信息')
  } else {
    lines.push('退票: 暂无退票规则')
  }

  // 改签行
  if (parsedRule.changeIntervals.length > 0 && cabinRow) {
    const sorted = sortIntervalsByDeadline(parsedRule.changeIntervals, departureDate)
    const parts = sorted.map((item, idx) => {
      const rate = cabinRow.changeRates[idx] ?? '信息不清晰'
      const timeStr = formatDateTime(item.deadline)
      const suffix = item.isAfter ? '后' : '前'
      const rateWithSuffix = rate === '免费' ? '免费/人' : `${rate}/人`
      return `改签: ${timeStr}${suffix}，改签费${rateWithSuffix}`
    })
    lines.push(parts.join('；'))
  } else if (parsedRule.changeIntervals.length > 0 && !cabinRow) {
    lines.push('改签: 未找到对应舱位费率信息')
  } else {
    lines.push('改签: 暂无改签规则')
  }

  // 签转行 —— 优先使用该舱位自身的签转规则，否则用全局规则
  const cabinTransfer = cabinRow?.transferAllowed;
  const isInherited = !!cabinRow?.transferInheritedFrom;
  let transferDisplay = '';
  if (cabinTransfer === true) {
    transferDisplay = '允许';
  } else if (cabinTransfer === false) {
    transferDisplay = '不允许';
  } else if (parsedRule.transferAllowed === true) {
    transferDisplay = '允许';
  } else if (parsedRule.transferAllowed === false) {
    transferDisplay = '不允许';
  }

  if (!transferDisplay) {
    lines.push('签转：未识别（该票规表未包含签转规则，请手动确认）');
  } else if (isInherited && cabinRow?.transferInheritedFrom) {
    lines.push(
      `签转：${transferDisplay}（继承自${cabinRow.transferInheritedFrom}舱）`,
    );
  } else {
    lines.push(`签转：${transferDisplay}`);
  }

  return lines.join('\n')
}

/** 校验输出是否有实质内容（至少有标题+退票+改签+签转4行且退票改签非"暂无"） */
export function hasValidOutput(parsedRule: IParsedRule, flightInfo: IFlightInfo): boolean {
  if (!flightInfo.airline || !flightInfo.cabinCode || !flightInfo.departureTime) return false
  if (parsedRule.refundIntervals.length === 0 && parsedRule.changeIntervals.length === 0) return false
  return true
}
