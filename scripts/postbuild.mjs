// 自托管后处理：把 vite 产物里的平台占位符替换成安全默认值。
// 原 vite 预设会把 {{appId}} / {{basename}} / {{csrfToken}} 等塞进 dist/index.html，
// 自托管运行时平台不会替换这些字面量，导致：
//   - window.__BASENAME__ = "/{{basename}}" → Router basename 坏掉
//   - window.appId = "{{appId}}" → 任何依赖 appId 的代码行为异常
//   - Slardar/Tea 监控脚本远程拉失败 → 控制台噪声 + 网络错误
// 这里把它们都替换掉，并删掉不需要的远程监控脚本。

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const distIndex = resolve(process.cwd(), 'dist/index.html')
let html = readFileSync(distIndex, 'utf8')

const before = html.length

// 1) 平台 window.* 占位符：替换成安全默认值
const replacements = {
  'window.appId = "{{appId}}"': "window.appId = ''",
  'window.userId = "{{userId}}"': "window.userId = ''",
  'window.tenantId = "{{tenantId}}"': "window.tenantId = ''",
  'window.userName = "{{userName}}"': "window.userName = ''",
  'window.csrfToken = "{{csrfToken}}"': "window.csrfToken = ''",
  'window.ENVIRONMENT = "{{environment}}"': "window.ENVIRONMENT = ''",
  // basename 必须是路由可用的根路径
  'window.__BASENAME__ = "{{basename}}"': 'window.__BASENAME__ = "/"',
}

for (const [from, to] of Object.entries(replacements)) {
  if (html.includes(from)) html = html.replace(from, to)
}

// 2) const appInfo 块里的占位符清空（不影响功能，title/og 会变成空字符串，可以接受）
html = html
  .replace(/name:\s*"\{\{appName\}\}"/g, "name: ''")
  .replace(/avatar:\s*"\{\{\{appAvatar\}\}\}"/g, "avatar: ''")
  .replace(/description:\s*"\{\{appDescription\}\}"/g, "description: ''")

// 3) meta/link 标签里的占位符同样清空（避免 favicon 404）
html = html
  .replace(/<link rel="icon"[^>]*href="\{\{appAvatar\}\}"[^>]*>/g, '')
  .replace(/<title>\{\{appName\}\}<\/title>/g, '<title>通用航司票规识别工具</title>')
  .replace(/<meta property="og:title" content="\{\{appName\}\}">/g, '')
  .replace(/<meta property="og:description" content="\{\{appDescription\}\}">/g, '')
  .replace(/<meta property="og:image" content="\{\{appAvatar\}\}">/g, '')
  .replace(/<meta name="description" content="\{\{appDescription\}\}">/g, '')

// 4) 删掉整段 Slardar 监控：含 'KSlardarWeb' 或 '__slardarErrBuf' 的 <script>...</script> 块
html = html.replace(
  /<script>[\s\S]*?(?:KSlardarWeb|__slardarErrBuf)[\s\S]*?<\/script>/g,
  '',
)

// 5) 删掉整段 Tea 监控：含 'collectEvent' 或 'bytescm.com' 的 <script>...</script> 块
html = html.replace(
  /<script>[\s\S]*?(?:collectEvent|bytescm\.com)[\s\S]*?<\/script>/g,
  '',
)

// 6) 删掉 performance.iife.js（飞书 perf 包，自托管用不上）
html = html.replace(
  /<script\s+src="https:\/\/sf3-scmcdn-cn\.feishucdn\.com\/obj\/unpkg\/byted\/performance\/0\.1\.2\/dist\/performance\.iife\.js"[^>]*>\s*<\/script>/g,
  '',
)

// 7) feisuda favicon（飞书 favicon CDN）
html = html.replace(
  /<link[^>]*href="https:\/\/lf3-static\.bytednsdoc\.com\/[^"]*feisuda\.svg"[^>]*>/g,
  '',
)

writeFileSync(distIndex, html)

const after = html.length
console.log(
  `[postbuild] dist/index.html 处理完成 (${before} → ${after} 字节, 删 ${before - after} 字节)`,
)