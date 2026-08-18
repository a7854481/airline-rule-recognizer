// EXPORTS: AIRLINE_CODE_MAP, getAirlineNameByCode, getAirlineCodeByName, extractAirlineCodeFromFlightNo

/**
 * 国内航司二字码（IATA 代码）映射表
 * key: 二字码（大写，如 CA、MU、3U）
 * value: 航司中文全称
 */
export const AIRLINE_CODE_MAP: Record<string, string> = {
  // 三大航 + 海航
  CA: '中国国际航空',
  MU: '中国东方航空',
  CZ: '中国南方航空',
  HU: '海南航空',

  // 地方主要航司
  '3U': '四川航空',
  ZH: '深圳航空',
  MF: '厦门航空',
  SC: '山东航空',
  FM: '上海航空',

  // 民营 / 低成本
  '9C': '春秋航空',
  HO: '吉祥航空',
  '9U': '九元航空',
  BK: '奥凯航空',
  EU: '成都航空',
  KN: '中国联合航空',
  PN: '西部航空',
  '8L': '祥鹏航空',
  GJ: '长龙航空',
  GT: '桂林航空',
  KY: '昆明航空',
  QW: '青岛航空',
  OQ: '重庆航空',
  GS: '天津航空',
  JD: '首都航空',
  FU: '福州航空',
  NS: '河北航空',
  A6: '红土航空',
  DZ: '东海航空',
  JR: '幸福航空',
  Y8: '扬子江航空',
  Z2: '中原龙浩航空',
  UQ: '乌鲁木齐航空',
  BQ: '河北航空',
  VD: '多彩贵州航空',
  G5: '华夏航空',
  VJ: '天骄航空',
  LJ: '龙江航空',
  R5: '巴戎航空',
  '8Y': '中国邮政航空',
  IK: '乌鲁木齐航空',
  CF: '中国货运航空',
  CK: '中货航',
  '7L': '江西航空',
  DR: '瑞丽航空',
};

/**
 * 从航班号中提取二字码并返回航司名称
 * - 前两位是纯字母（如 CA、MU）→ 取前两位
 * - 第一位数字 + 第二位字母（如 3U、9C）→ 取前两位
 * - 第一位字母 + 第二位数字（如 B7、J5）→ 取前两位（覆盖更多情况）
 * - 其余情况尝试从映射表中匹配最长前缀
 *
 * 返回 { code, name }，找不到时 name 为空字符串
 */
export function extractAirlineCodeFromFlightNo(
  flightNo: string,
): { code: string; name: string } {
  const no = flightNo.trim().toUpperCase();
  if (no.length < 2) return { code: '', name: '' };

  // 策略1：前两位直接匹配（覆盖 AA / A9 / 9A 三种形态）
  const firstTwo = no.slice(0, 2);
  if (AIRLINE_CODE_MAP[firstTwo]) {
    return { code: firstTwo, name: AIRLINE_CODE_MAP[firstTwo] };
  }

  // 策略2：第一位是数字、第二位是字母的情况（已被策略1覆盖，保留为冗余）
  if (/^[0-9][A-Z]$/.test(firstTwo) && AIRLINE_CODE_MAP[firstTwo]) {
    return { code: firstTwo, name: AIRLINE_CODE_MAP[firstTwo] };
  }

  // 策略3：逐位尝试匹配更长的已知代码（防御有三字码等特殊情况）
  for (let len = Math.min(no.length, 3); len >= 2; len--) {
    const prefix = no.slice(0, len);
    if (AIRLINE_CODE_MAP[prefix]) {
      return { code: prefix, name: AIRLINE_CODE_MAP[prefix] };
    }
  }

  return { code: firstTwo, name: '' };
}

/** 根据二字码获取航司名称 */
export function getAirlineNameByCode(code: string): string {
  return AIRLINE_CODE_MAP[code.trim().toUpperCase()] || '';
}

/**
 * 根据航司名称反查二字码（模糊匹配，取第一个命中的）
 * 用于：用户在航司输入框输入名称后做提示
 */
export function getAirlineCodeByName(name: string): string {
  const n = name.trim();
  if (!n) return '';

  // 精确匹配
  for (const [code, airlineName] of Object.entries(AIRLINE_CODE_MAP)) {
    if (airlineName === n) return code;
  }
  // 包含匹配
  for (const [code, airlineName] of Object.entries(AIRLINE_CODE_MAP)) {
    if (airlineName.includes(n) || n.includes(airlineName)) return code;
  }
  return '';
}
