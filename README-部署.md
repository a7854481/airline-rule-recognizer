# 票规识别工具 · 云端部署说明

本项目已改造为「前端 + Node 后端代理」架构，让图片/文本识别在脱离飞书平台后也能**准确、安全地**运行。

## 架构
- **前端**：React 单页应用（已构建到 `dist/`），负责展示、编辑、计算。
- **后端**：`server.js`（Express），做三件事：
  1. 隐藏 API Key（密钥只在服务端，前端永远拿不到，杜绝泄露）；
  2. 调用**智谱 GLM-4V** 视觉模型做图片/文本识别（OpenAI 兼容协议）；
  3. 托管前端静态产物（单进程即可对外服务）。

## 准确性保障
后端内置专业提示词，强制模型按你的规则输出结构化 JSON：
- 签转列垂直合并单元格 → **向上继承**最近有值行，禁止向下/默认不允许；
- 舱位行定位 → 用**折扣列**校验，费率数字与行严格对齐，禁止跨行取数；
- 强制输出 `discount` 字段，供前端二次校验；
- focus（聚焦）模式 → 只输出目标舱位一行。
前端原有的 `parseAiResultToRule` 解析器直接消费该 JSON，识别与解析解耦。

## 本地运行
```bash
# 1. 安装依赖（含后端 express / dotenv）
npm install

# 2. 配置密钥：复制 .env.example 为 .env 并填入 Key
cp .env.example .env
#   ZHIPU_API_KEY=你的_智谱_API_Key
#   （去 https://open.bigmodel.cn/ 注册；想省费用可把 ZHIPU_MODEL 改为 glm-4v-flash 免费版）

# 3. 构建前端（如已改过 src）
npm run build          # 用 vite build --outDir dist

# 4. 启动（端口默认 3000）
npm start
#   或： ZHIPU_API_KEY=xxx PORT=3000 node server.js

# 5. 浏览器打开 http://localhost:3000
```

## 调试/演示开关（无需 Key）
```bash
MOCK_RECOGNIZE=1 npm start
```
此时跳过真实模型调用，直接返回示例票规 JSON，用于验证前端解析/展示是否正确。**生产请勿开启。**

## 部署到云端（需支持 Node 的平台）
CloudStudio 当前仅支持纯静态，无法跑后端。请把整个项目部署到支持 Node 的平台，例如：
- **Railway / Render / Fly.io / 阿里云函数计算 / 腾讯云 CloudBase（Node 环境）** 等。
- 部署时设置环境变量 `ZHIPU_API_KEY`（平台后台配置，**不要**写进代码或提交到仓库）。
- 启动命令：`npm install && npm run build && npm start`。
- 平台监听端口用环境变量 `PORT`（已支持）。

> 安全提醒：`.env` / `.env.local` 已在 `.gitignore` 中，**切勿提交真实密钥**。前端打包后只调同源 `/api/*`，Key 永不暴露给浏览器。
