import { Component, type ErrorInfo, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Page render failed', error, info.componentStack) }
  render() {
    if (!this.state.failed) return this.props.children
    return <div role="alert" className="m-4 space-y-3 border border-ink-border bg-ink-deep p-6 text-foreground">
      <h1 className="text-lg">页面加载失败 / Unable to load this page</h1>
      <p className="text-sm text-ink-mute">请刷新页面重试；如刚更新过平台，刷新后会加载最新版本。</p>
      <button onClick={() => location.reload()} className="border border-ink-border px-4 py-2 text-sm">刷新 / Reload</button>
    </div>
  }
}
