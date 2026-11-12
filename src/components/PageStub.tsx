/* Foundation Console — Copyright 2026 DNT_OF / DNTOF · SPDX-License-Identifier: Apache-2.0 */
import type { ReactNode } from 'react'

/** 统一页面占位壳：工业风标题 + 子内容区。action 渲染在标题行右侧（如"添加"按钮）。 */
export default function PageStub({
  code, title, action, children,
}: { code: string; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-ink-border pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-mute">
          {code}
        </span>
        <h1 className="font-sans text-[15px] font-medium tracking-wide text-foreground">
          {title}
        </h1>
        {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </header>
      <div className="flex-1 py-6">
        {children ?? (
          <p className="font-mono text-[12px] text-ink-mute">
            // {title}
          </p>
        )}
      </div>
    </div>
  )
}
