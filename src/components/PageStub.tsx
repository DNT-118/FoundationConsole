import type { ReactNode } from 'react'

/** 统一页面占位壳：工业风标题 + 子内容区 */
export default function PageStub({
  code, title, children,
}: { code: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 border-b border-ink-border pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-mute">
          {code}
        </span>
        <h1 className="font-mono text-[15px] uppercase tracking-[0.15em] text-white">
          {title}
        </h1>
      </header>
      <div className="flex-1 py-6">
        {children ?? (
          <p className="font-mono text-[12px] text-ink-mute">
            // module reserved
          </p>
        )}
      </div>
    </div>
  )
}
