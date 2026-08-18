# 航空票务规则解析工具 - 需求拆解文档

## 产品概述

- **产品类型**: 票规解析工具（Web 工具）
- **场景类型**: <scene_type>prototype-app</scene_type>
- **目标用户**: 航旅票务从业人员、机票代理、客服人员
- **核心价值**: 通过 AI 识别票规表格图片 + 航班信息输入，自动计算并格式化输出退票/改签/签转规则，免去人工查表和时间换算的繁琐工作
- **界面语言**: 中文（zh-CN）
- **主题偏好**: 浅色（专业简洁风格）
- **导航模式**: 无导航（单页工具）
- **导航布局**: 无

---

## 页面结构总览

> **说明**：单页工具应用，所有功能在同一页面完成，采用左右分栏布局。

**页面文件**: `RuleParserPage.tsx`

| 区域 | 位置 | 说明 |
|-----|------|------|
| 顶部标题栏 | 顶部通栏 | 产品名称 + 简短说明 |
| 左侧输入区 | 左栏（约 55% 宽度） | 图片上传 + 航班信息表单 + 识别结果可编辑表格 |
| 右侧输出区 | 右栏（约 45% 宽度） | 格式化结果展示 + 一键复制按钮 |

---

## 页面布局建议

- **布局模式**: **左右分栏（主从布局）** —— 左栏为输入/配置区（图片上传 + 表单 + 可编辑表格），右栏为结果展示区。理由：用户需要持续对照识别出的表格数据和输出结果，左右并列便于校验和调整，避免上下滚动反复对照。
- **视觉重心**: **识别结果可编辑表格 + 输出结果** —— 这是工具的核心价值区，AI 识别后的费率数据和最终格式化输出是用户最关注的内容。
- **结果承载区**: 右侧「格式化输出面板」；初始态为 **空状态占位**（提示"请上传票规图片并填写航班信息后，点击识别按钮生成结果"），识别完成后展示格式化文本 + 复制按钮。
- **源材料承载区**: 左侧图片上传区需包含**图片预览**（上传后显示缩略图，支持点击放大查看），便于用户对照识别结果进行校正。

---

## 插件规划

| 插件实例名称 | 基于官方插件 | 业务用途 | 输出模式 | 所属页面 |
|------------|-----------|---------|---------|---------|
| 票规表格识别 | `ai-image-understanding` | 识别用户上传的航空公司舱位费率表图片，提取表格结构（自愿变更/自愿退票大列及子时间区间）、各舱位费率、签转规则、OPEN票规则 | stream | 票规解析页 |

---

## 数据来源声明

| 数据/操作 | 来源类型 | 实现要求 | mock 兜底 |
|---|---|---|---|
| 票规图片上传与预览 | real-file | 浏览器 File API + `<input type="file">` 本地读取并预览图片 | 初始提供东航样例图占位（图片 URL 来自用户提供的参考素材） |
| 票规表格 AI 识别 | real-plugin | 调用 `ai-image-understanding` 插件实例，传入用户选中的票规图片，流式输出识别到的表格结构、时间区间、舱位费率、签转/OPEN 规则 | 失败提示（toast "图片识别失败，请重试或手动输入"）**严禁提供 mock 识别结果** |
| 航班信息输入 | demo-mock | 表单 state 管理 + 本地计算 | 初始可填东航样例航班（MU5108 / B舱 / 2026-07-18 11:00）作为示例 |
| 时间节点与费率计算 | demo-mock | 前端纯函数根据起飞时间 + 区间规则 + 舱位匹配计算结果 | 无（纯逻辑计算，无外部依赖） |
| 识别结果手动编辑 | demo-mock | 可编辑表格 state，变更后实时重算输出 | 无 |
| 结果一键复制 | import-export | `navigator.clipboard.writeText` 复制格式化结果到剪贴板 | 无 |

> 插件类（票规表格 AI 识别）严禁提供具体 mock 识别值，避免旁路插件铁律。

---

## 功能列表

- **页面/区块**: 票规解析页（主页面）
  - **页面目标**: 用户上传票规图片 + 输入航班信息 → AI 识别表格 → 手动校正 → 输出格式化退票/改签/签转结果 → 一键复制
  - **功能点**:
    1. **图片上传与预览**：支持点击/拖拽上传票规图片，上传后显示缩略图预览，支持点击放大对照；文件格式支持 jpg/png/webp
    2. **航班信息输入表单**：包含航空公司名称、航班号、舱位代码、航班计划起飞时间（日期选择器 + 时间选择器，精确到分钟）
    3. **AI 识别票规表格**：点击"开始识别"按钮调用 AI 图片理解插件，流式输出识别结果；识别内容包含：自愿变更各时间区间列、自愿退票各时间区间列、各舱位行对应费率、签转规则、OPEN票规则；识别过程显示进度状态
    4. **识别结果可编辑表格**：AI 识别结果以表格形式展示，用户可手动编辑校正时间区间值、单位（天/小时）、各舱位改签/退票费率、签转状态；编辑后实时触发重新计算
    5. **时间节点计算与舱位匹配**：根据航班起飞时间 + 区间类型（前N小时/前N天/起飞后）精确倒推各时间节点，按时间从早到晚排序；根据舱位代码匹配对应行的改签/退票费率
    6. **格式化输出与一键复制**：按严格固定格式输出退票行、改签行、签转行，时间格式为 YYYY-MM-DD HH:MM 前/后；提供"一键复制"按钮，点击后复制全部结果文本并 toast 反馈

---

## 数据共享配置

> 单页应用，无跨页面数据共享需求，所有状态在页面内管理。

```ts
// 核心数据类型定义（供 Code Agent 参考）

/** 时间区间定义 */
interface TimeInterval {
  id: string;
  /** 区间类型：before=前N小时/天之前，between=前N至前M之间，after=起飞后 */
  type: 'before' | 'between' | 'after';
  /** 数值1（前N小时/天，type=before时用；between时为N） */
  value1: number;
  /** 数值2（between时为M） */
  value2?: number;
  /** 单位：hour=小时，day=天 */
  unit: 'hour' | 'day';
  /** 原始文本描述（来自AI识别） */
  rawText?: string;
}

/** 舱位费率行 */
interface CabinRateRow {
  cabinCode: string; // 舱位代码，如 Y/B/M
  changeRates: string[]; // 改签费率，与变更区间一一对应，如 "10%", "免费"
  refundRates: string[]; // 退票费率，与退票区间一一对应
}

/** 识别结果数据结构 */
interface ParsedRuleData {
  airline: string; // 航空公司
  changeIntervals: TimeInterval[]; // 自愿变更时间区间列
  refundIntervals: TimeInterval[]; // 自愿退票时间区间列
  cabinRows: CabinRateRow[]; // 各舱位费率行
  transferAllowed: boolean; // 签转：true=允许，false=不允许
  openTicketRule?: string; // OPEN票规则
}

/** 航班信息 */
interface FlightInfo {
  airline: string;
  flightNo: string;
  cabinCode: string;
  departureTime: string; // ISO 字符串，精确到分钟
}

-------

<scene_type>prototype-app</scene_type>

# UI 设计指南

## 1. 设计推导依据

- **参考意图**: Free Direction —— 参考图片无法访问，仅依据产品功能需求与航旅票务行业语义自主设计
- **核心情绪 / 应用类型**: 专业精准、克制可靠的票规解析工具，服务航旅票务从业人员日常核价与答复场景
- **独特记忆点**: 以「登机牌条纹 + 时间轴刻度」为视觉母题，左侧输入区模拟票根质感，右侧结果区用等宽字体呈现可复制的格式化文本，强化「精准、可信赖」的工具属性

## 2. Art Direction

- **方向名**: 航务精准风
- **Design Style**: Swiss Minimalist 瑞士极简 + Grid 网格秩序 —— 高密度表格与时间节点需要清晰网格秩序，瑞士极简的理性与克制契合票务专业场景
- **DNA 参数**: 圆角 subtle（`rounded-md`） / 阴影 subtle（`shadow-sm`） / 间距 compact-standard（`gap-3~4`, `p-5~6`） / 字体方向：正文无衬线清晰、结果区等宽 / 装饰手法：细横线分隔、登机牌式穿孔虚线、时间轴刻度线
- **应用类型**: Tool —— 左右双栏工作区布局，左输入右输出

## 3. Color System

**色彩关系**: 深航空蓝主色 + 同色系极浅蓝反馈底 + 冷灰中性底，辅以少量橙色作为时间节点高亮
**配色设计理由**: 深航空蓝传递航旅专业感与信任感，作为主交互与品牌锚点；冷灰中性底保证长表格阅读舒适度；accent 浅蓝底承接 hover、选中、表格斑马纹；橙色仅用于关键时间节点和费率高亮，提醒票务人员注意
**主色推导**: 从航空业经典的「机尾深蓝 + 天空浅灰」语义提取，primary 选用饱和度适中的深海蓝，避免过亮刺眼；bg 选用偏冷的灰白，模拟机票纸张的冷静质感
**使用比例**: 65% 中性 / 28% 辅助 / 7% primary；primary 仅用于主按钮、关键状态标、图标高亮；accent 承担表格交互、hover、选中态

| 角色 | CSS 变量 | Tailwind Class | HSL 值 | 设计说明 |
|---|---|---|---|---|
| bg | `--background` | `bg-background` | hsl(210 40% 98%) | 页面背景，偏冷的天空灰白 |
| card | `--card` | `bg-card` | hsl(0 0% 100%) | 卡片、表单、结果面板承载面 |
| text | `--foreground` | `text-foreground` | hsl(215 28% 17%) | 标题和正文，深墨蓝 |
| textMuted | `--muted-foreground` | `text-muted-foreground` | hsl(215 16% 47%) | 辅助说明、占位符、表格次要信息 |
| primary | `--primary` | `bg-primary` / `text-primary` | hsl(213 82% 38%) | 主交互、CTA、品牌识别，航空深蓝 |
| primaryForeground | `--primary-foreground` | `text-primary-foreground` | hsl(0 0% 100%) | primary 上的文字图标 |
| accent | `--accent` | `bg-accent` | hsl(214 32% 94%) | hover/focus 浅底、表格斑马纹、选中浅底 |
| accentForeground | `--accent-foreground` | `text-accent-foreground` | hsl(213 82% 28%) | accent 上的文字图标，深蓝 |
| border | `--border` | `border-border` | hsl(214 20% 88%) | 输入框、卡片、表格边界 |

**语义色提示**: 成功 hsl(142 65% 35%) / 警告 hsl(32 90% 50%) / 错误 hsl(0 75% 55%)；三态均提供 bg（同色相 +75%~80% 明度、-40% 饱和度）、border（同色相 +65% 明度、-30% 饱和度）、text（主值）；语义色饱和度与 primary 对齐 ±10%，保持整体克制不刺眼

## 4. 字体与节奏

- **font-display**: Noto Sans SC —— 中文清晰易读，字重梯度完整，适合专业工具标题与表头
- **font-body**: Noto Sans SC + IBM Plex Mono（等宽用于结果输出与费率数字） —— 正文清晰，结果区等宽字体强化格式化文本的精确感和对齐美感
- **字号**: H1 text-2xl；H2 text-lg；body text-sm ~ text-base；muted text-xs ~ text-sm；结果输出区使用 text-sm 等宽
- **圆角**: 小 —— `rounded-md` 为主，输入框与卡片统一 6px 圆角，传达专业理性

## 5. 全局布局契约

- **Reference Layout Use**: 按需求结构推导，采用左右双栏工具布局
- **Page / Section Order**: 单页应用，顶部导航栏 + 主内容双栏（左：上传 → 航班信息 → 识别结果可编辑表格；右：格式化输出 + 复制按钮）
- **Standard Content Zone**: Tool 型，`max-w-[1360px]` + `mx-auto`，适配高密度表格与双栏工作流
- **Shell / Frame Alignment**: 内容容器与框架同宽，顶部导航全宽，内容区受 max-w 约束
- **Padding & Rhythm**: `px-4 md:px-6 lg:px-8 py-6 md:py-8`，垂直间距遵循 8px 倍数
- **Full-bleed Zones**: 顶部导航栏全宽，其余内容均受 Standard Content Zone 约束
- **Local Narrowing**: 航班信息表单可在左栏内局部收窄，识别结果表格可横向滚动
- **Overflow Strategy**: 可编辑费率表格使用 `overflow-x-auto`，确保多时间区间列不撑破布局
- **Flexibility Boundary**: 允许移动端改为上下单栏布局、调整卡片内边距；不允许切换主色、圆角、阴影语言或字体系统

## 6. 视觉与动效

- **装饰**: 登机牌穿孔虚线分隔、时间轴刻度细线、表格斑马纹
- **阴影/边界**: 轻 —— `shadow-sm` 用于卡片悬浮感，边界以细实线为主
- **动效**: 克制 —— hover 背景色 150ms 过渡、识别中状态使用淡入淡出、表格编辑实时刷新结果无跳变

## 7. 组件原则

- 上传区支持拖拽态、上传中、识别中、识别完成四种状态，状态变化有明确视觉反馈
- 航班信息表单字段紧凑排列，标签左对齐，输入框统一高度
- 可编辑表格使用细边框 + 斑马纹，激活单元格有明显 focus 环
- 结果输出区使用等宽字体 + 浅灰底 + 左内边距竖线（登机牌质感），复制按钮固定在右上角
- 所有按钮、输入、表格单元格必须有 Default / Hover / Active / Focus-visible / Disabled 状态

## 8. Image Direction

- **Image Role**: 无强制图片需求，优先通过排版、表格线条和登机牌装饰元素建立视觉记忆点
- **Image Art Direction**: 无强制图片需求
- **Image Prompt Keywords**: 无
- **Image Avoidance**: 避免通用飞机剪影、蓝天白云素材图、航空商务人物图库照

## 9. Anti-patterns

- **Split personality**: 左右两栏使用不同圆角或阴影语言；全站统一 subtle 圆角与轻阴影
- **Phantom tokens**: 编造不存在的 CSS 变量；只使用已定义的 9 个基础 token + 语义色
- **Default SaaS drift**: 回到默认亮蓝按钮 + 紫色渐变 + 冗余卡片堆叠；用航空深蓝主色 + 细线条表格 + 等宽结果区塑造工具感
- **Invisible interaction**: 表格单元格和上传区缺少 focus-visible 状态；所有可交互元素必须有键盘可见环
- **Mono-hue tyranny**: 主色铺满按钮、tab、icon、边框、链接；primary 仅用于 CTA 和关键状态，其余交予 accent 与中性色
- **Status color drift**: 错误/警告色饱和度过高盖过主色；语义色饱和度与 primary 对齐 ±10%