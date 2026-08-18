# 票规识别工具 · CloudBase 云托管镜像
# 单进程：Express 后端（/api/* + 静态托管 dist/）
# 用 Debian(slim) 而非 alpine：避免 lightningcss / rolldown / oxide 的 musl 原生绑定缺失问题
FROM node:20-slim

WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json ./
# 安装全部依赖（含 devDependencies 里的 vite 用于构建）
# --ignore-scripts 跳过 prepare 里的 git hooks 初始化，避免容器里无 git 报错
# 不用 npm ci：lockfile 是 Windows 上生成的，ci 会因平台不符报错；install 会按 linux 平台重新解析
RUN npm install --ignore-scripts

# 显式补齐 Linux x64 原生绑定（vite build 会用到 lightningcss / @tailwindcss/oxide / rolldown）
# 即使上面的 install 已自动装，这里再保险一次；失败也不阻断（|| true）
RUN npm install --no-save --ignore-scripts \
      @rolldown/binding-linux-x64-gnu \
      @tailwindcss/oxide-linux-x64-gnu \
      lightningcss-linux-x64-gnu 2>/dev/null || true

# 拷源码并在镜像内构建前端（保证 dist/ 与代码一致）
COPY . .
RUN npx vite build --outDir dist

# CloudBase 注入 PORT 环境变量（server.js 已兼容）；默认容器监听 3000
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
