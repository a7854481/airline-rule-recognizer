// EXPORTS: IParsedRule, ITimeInterval, ICabinRateRow, MOCK_PARSED_RULE_EMPTY
export interface ITimeInterval {
  id: string
  type: 'before' | 'between' | 'after'
  value1: number
  value2?: number
  unit: 'hour' | 'day'
  rawText?: string
}

export interface ICabinRateRow {
  cabinCode: string
  changeRates: string[]
  refundRates: string[]
  /** 折扣值（如 "100%"、"92%"），来自票规表折扣列，用于校验舱位行是否定位正确 */
  discount?: string
  /** 该舱位的签转规则：true=允许 false=不允许 'unknown'=未识别 'inherit'=继承自上方 */
  transferAllowed?: boolean | 'unknown' | 'inherit'
  /** 若为继承，记录继承自哪个舱位代码 */
  transferInheritedFrom?: string
  /** 行定位风险标记：如 "可能定位错误" "与上方舱位费率完全相同"，用于前端提示核对 */
  rowWarning?: string
}

export interface IParsedRule {
  id: string
  airline: string
  changeIntervals: ITimeInterval[]
  refundIntervals: ITimeInterval[]
  cabinRows: ICabinRateRow[]
  transferAllowed: boolean | 'unknown'
  openTicketRule?: string
}

export const MOCK_PARSED_RULE_EMPTY: IParsedRule = {
  id: 'empty',
  airline: '',
  changeIntervals: [],
  refundIntervals: [],
  cabinRows: [],
  transferAllowed: 'unknown',
  openTicketRule: '',
}