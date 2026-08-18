# 票规识别工具 · CloudBase 云托管镜像
# 单进程：Express 后端（/api/* + 静态托管 dist/）
FROM node:20-alpine

WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json ./
# 安装全部依赖（含 devDependencies 里的 vite 用于构建）
# --ignore-scripts 跳过 prepare 里的 git hooks 初始化，避免容器里无 git 报错
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# 拷源码并构建前端（镜像内构建，保证 dist/ 与代码一致）
COPY . .
RUN npx vite build --outDir dist

# 运行时只保留必要文件即可，但精简非必须；直接 npm start
# CloudBase 注入 PORT 环境变量（server.js 已兼容）；默认容器监听 3000
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
