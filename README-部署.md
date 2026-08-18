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

## 部署到腾讯云 CloudBase（云托管，推荐）

CloudBase **云托管** 是容器化的，**能跑 Node 后端**，正好满足本项目需要（纯 CloudBase 静态托管不行）。
本项目已准备好 `Dockerfile` + `container.config.json` + `.dockerignore`，按下面步骤即可：

### 前置
1. 开通 腾讯云 CloudBase（https://console.cloud.tencent.com/tcb），新建一个环境。
2. 进入「云托管」→「服务」→「新建服务」，服务类型选 **Web 服务**。

### 方式一：代码仓库一键部署（推荐）
1. 把项目推到 GitHub/GitLab（注意 `.env` 已被 .gitignore 忽略，不会上传）。
2. CloudBase 云托管「新建服务」时选择「代码仓库」，授权并选中本仓库。
3. 构建配置：
   - **Dockerfile 路径**：`Dockerfile`（已提供）
   - **监听端口**：`3000`
   - **环境变量**：新增 `ZHIPU_API_KEY`，值填你的智谱 Key（**这里填，别写进代码**）；
     还可选 `ZHIPU_MODEL`（默认 `glm-4v-plus`，省钱可改 `glm-4v-flash`）、`MOCK_RECOGNIZE=0`。
4. 提交后 CloudBase 会自动 `docker build` 并部署，完成后给一个公网域名即可访问。

### 方式二：本地登录 CLI 部署
```bash
npm i -g @cloudbase/cli
tcb login                 # 浏览器扫码授权
tcb env:list              # 记下环境 ID
tcb run:deploy --envId <你的环境ID>   # 按提示选「云托管」并绑定本目录
```

### 验证
- 打开分配的域名，粘贴一张票规截图 → 应返回结构化 JSON 并被前端解析展示。
- 若识别报错，先看浏览器控制台 / CloudBase 云托管日志里的错误信息：
  - `图片过大…` → 截图超 3.5MB，按提示压缩（前端已自动压缩，正常不会出现）。
  - `API Key 无效` → 检查环境变量 `ZHIPU_API_KEY` 是否填对。
  - `额度/限流` → 智谱免费额度用尽或太快，稍后重试或换模型。

### 费用
云托管按实际容器运行时长/资源计费，低流量几乎免费；也可设最小实例数为 0（无访问时不计费）。
