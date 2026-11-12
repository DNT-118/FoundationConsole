/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import type { ReactNode } from 'react'
import { DEMO_UNSUPPORTED } from './mockBackend'

export type DemoFeature = keyof typeof DEMO_UNSUPPORTED

/** 演示版不可用功能的整页提示（替代需要真实后端的页面，如语音监听、实时事件流）。 */
export default function DemoUnavailable({ feature }: { feature: DemoFeature }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg border border-scp-err/60 bg-ink-deep p-6 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-scp-err">演示版不可用 · Unavailable in demo</p>
        <p className="mt-3 text-sm text-foreground">{DEMO_UNSUPPORTED[feature]}</p>
        <p className="mt-3 text-xs text-ink-mute">
          完整功能请按 main 分支 README 自行部署 FDC（含 Node 后端）。
        </p>
      </div>
    </div>
  )
}

/**
 * 区块级禁用：演示版中把需要真实后端的设置区块（SMTP / Microsoft OAuth、Steam、2FA、账户管理）
 * 整体置灰禁用并标注原因。非演示构建原样渲染子元素。
 */
export function DemoLock({ enabled, feature, children }: { enabled: boolean; feature: DemoFeature; children: ReactNode }) {
  if (!enabled) return <>{children}</>
  return (
    <div className="mt-2">
      <p role="note" className="border border-scp-err/60 px-2 py-1 font-mono text-[10px] text-scp-err">
        演示版不可用：{DEMO_UNSUPPORTED[feature]}
      </p>
      <fieldset disabled aria-disabled="true" className="pointer-events-none select-none opacity-40">
        {children}
      </fieldset>
    </div>
  )
}
