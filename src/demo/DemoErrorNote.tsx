import { IS_DEMO } from './mode'

/** 仅演示版显示的错误原因（普通构建不渲染，保持原有界面）。 */
export default function DemoErrorNote({ error }: { error: unknown }) {
  if (!IS_DEMO || !error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <p className="mt-2 border border-scp-err px-2 py-1 font-mono text-[11px] text-scp-err">
      {msg}
    </p>
  )
}
