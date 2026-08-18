// ---- plugin:airline_ticket_rule_image_recognition_1 ----
// ============================================================
// 插件 airline_ticket_rule_image_recognition_1 (航空公司票规表格识别) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface AirlineTicketRuleImageRecognitionOneInput {
  /** 可选参数：需要聚焦提取的目标舱位代码，传入后仅识别该舱位对应行的费率和规则，未传入则提取全量舱位信息 */
  target_cabin_code?: string;
  /** 待识别的航空公司舱位费率表图片列表 */
  ticket_rule_images: string[];
}

/**
 * capabilityClient.load('airline_ticket_rule_image_recognition_1').callStream<AirlineTicketRuleImageRecognitionOneOutput>('imageUnderstanding', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 AirlineTicketRuleImageRecognitionOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","reasoningContent":"","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface AirlineTicketRuleImageRecognitionOneOutput {
  /** [object Object] */
  content: string;
  /** [object Object] */
  reasoningContent?: string;
  /** [object Object] */
  response?: string;
}
// ---- end:airline_ticket_rule_image_recognition_1 ----

// ---- plugin:ticket_rule_text_parsing_1 ----
// ============================================================
// 插件 ticket_rule_text_parsing_1 (票规文本解析) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface TicketRuleTextParsingOneInput {
  /** 待解析的票规文本（支持ETERM、PDF、邮件、网页复制的舱位费率表文本） */
  ticket_rule_text: string;
}

/**
 * capabilityClient.load('ticket_rule_text_parsing_1').callStream<TicketRuleTextParsingOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 TicketRuleTextParsingOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export interface TicketRuleTextParsingOneOutput {
  /** [object Object] */
  content: string;
  /** [object Object] */
  response?: string;
}
// ---- end:ticket_rule_text_parsing_1 ----

// ---- plugin:flight_info_image_recognition_1 ----
// ============================================================
// 插件 flight_info_image_recognition_1 (航班信息图片识别) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export interface FlightInfoImageRecognitionOneInput {
  /** 待识别的航班信息截图（航班条、行程单图片） */
  flight_image: string[];
}

/**
 * capabilityClient.load('flight_info_image_recognition_1').call<FlightInfoImageRecognitionOneOutput>('imageToJson', input)
 * 直接返回此类型，无 .data 包装，直接解构使用：
 * const { flight_number, cabin_code, departure_date, ... } = result;
 * 返回值形如：
 *   {"flight_number":"示例文本","cabin_code":"示例文本","departure_date":"示例文本","departure_time":"示例文本","airline_name":"示例文本"}
 */
export interface FlightInfoImageRecognitionOneOutput {
  /** 航班号，由航空公司二字码加数字组成，如CA1234、MU5678 */
  flight_number: string;
  /** 舱位代码，通常为单个大写英文字母，如Y、C、F等 */
  cabin_code: string;
  /** 起飞日期，格式为YYYY-MM-DD，如2024-05-20 */
  departure_date: string;
  /** 起飞时间，格式为HH:mm，如14:30 */
  departure_time: string;
  /** 航空公司名称，如中国国际航空、东方航空等 */
  airline_name: string;
}
// ---- end:flight_info_image_recognition_1 ----