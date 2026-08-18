# 航司票规识别工具（Airline Rule Recognizer）

基于 Miaoda（Vite + React 19）开发，用于把**航司票规图片 / 文本**识别成结构化数据（签转、折扣、退改费等），供前端解析、编辑与计算。

项目已从「依赖飞书平台能力」改造为**前端 + Node 后端代理**架构，脱离平台也能准确、安全地运行。

## 技术栈

- 前端：React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui
- 后端：Express（`server.js`），代理智谱 GLM-4V 视觉识别
- 构建：Vite

## 本地运行

```bash
# 1. 安装依赖（含后端 express / dotenv）
npm install

# 2. 配置密钥：复制模板为 .env 并填入 Key
cp .env.example .env
#   ZHIPU_API_KEY=你的_智谱_API_Key
#   （去 https://open.bigmodel.cn/ 注册；省钱可把 ZHIPU_MODEL 改为 glm-4v-flash 免费版）

# 3. 构建前端（如改过 src）
npm run build          # vite build --outDir dist

# 4. 启动（端口默认 3000）
npm start
#   或： ZHIPU_API_KEY=xxx PORT=3000 node server.js

# 5. 浏览器打开 http://localhost:3000
```

**无需 Key 的演示模式：**

```bash
MOCK_RECOGNIZE=1 npm start
```

跳过真实模型调用，返回示例票规 JSON，用于验证前端解析/展示。生产请勿开启。

## 部署到云端（需支持 Node 的平台）

CloudStudio 仅支持纯静态，跑不了后端。请部署到支持 Node 的平台：

- Railway / Render / Fly.io / 阿里云函数计算 / 腾讯云 CloudBase（Node 环境）等
- 平台后台配置环境变量 `ZHIPU_API_KEY`（**不要**写进代码或提交仓库）
- 启动命令：`npm install && npm run build && npm start`
- 平台监听端口用环境变量 `PORT`（已支持）

> 详细架构与准确性保障说明见同目录 **[`README-部署.md`](./README-部署.md)**。

## 线上访问

- 线上链接：`TODO — 部署到支持 Node 的平台后填写`（CloudStudio 不支持后端，需用上述 Node 平台托管）

## ⚠️ 安全须知（重要）

- 真实密钥在 `.env`（已被 `.gitignore` 忽略，**未提交到仓库**）。仓库内仅保留 `.env.example` 模板。
- 密钥只在服务端 `server.js` 使用，前端打包后只调同源 `/api/*`，Key 永不暴露给浏览器。
- 切勿把真实 `.env` 提交到任何仓库或写进前端代码。

## 仓库说明

- 源码 + 部署说明提交，`dist/`、`node_modules/`、`.env` 已被 `.gitignore` 忽略。
- 如需把本项目嵌入「票务工作台」等合集，可用 iframe 嵌入部署后的线上链接。
