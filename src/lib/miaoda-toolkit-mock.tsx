// 自托管部署用的平台 SDK 空壳：
// 把 Miaoda / lark-apaas 的 client-toolkit-lite 整个替换成无副作用的本地实现，
// 既保证遗留引用（logger、capabilityClient、AppContainer、ErrorRender）可解析，
// 又不会去拉远程指标 / 平台 API。
// 必须挂在 vite alias 上才能真正把 700KB 的 toolkit 体积从产物里剔除。

import type { ReactNode } from 'react'

// 与平台 logger 接口保持一致（debug/info/warn/error 都存在）
export const logger = {
  debug: (...args: unknown[]) => console.debug('[toolkit]', ...args),
  info: (...args: unknown[]) => console.info('[toolkit]', ...args),
  warn: (...args: unknown[]) => console.warn('[toolkit]', ...args),
  error: (...args: unknown[]) => console.error('[toolkit]', ...args),
}

// 与平台 capabilityClient 接口保持一致（load 返回一个可 await 的执行器）
// 此处直接返回空结果，不再调用平台的 AI 插件（自托管环境用 /api/* 后端调用智谱）。
export const capabilityClient = {
  load: <T = unknown>(_pluginId: string): Promise<T | null> => Promise.resolve(null),
  invoke: <T = unknown>(_pluginId: string, _input?: unknown): Promise<T | null> => Promise.resolve(null),
}

// 完全透传，避免对子树造成任何副作用
export function AppContainer({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

// 与平台 ErrorRender 同名同形态的本地实现，使用 shadcn/ui 已有 Button 即可
import { Button } from '@/components/ui/button'
export function ErrorRender({
  error,
  resetErrorBoundary,
}: {
  error: unknown
  resetErrorBoundary?: () => void
}) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-3 text-center">
        <h2 className="text-xl font-semibold text-destructive">页面出错了</h2>
        <pre className="text-xs text-muted-foreground bg-muted/40 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
          {msg}
        </pre>
        {resetErrorBoundary && (
          <Button onClick={resetErrorBoundary} variant="outline">
            重试
          </Button>
        )}
      </div>
    </div>
  )
}

// 占位：有些版本还会导出一个 default 空对象，确保不会因为 default import 报错
export default { logger, capabilityClient, AppContainer, ErrorRender }