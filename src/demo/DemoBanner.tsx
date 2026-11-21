import { DEMO_BANNER_TEXT } from './mode'

/**
 * 演示版顶部警示栏：常驻、不可关闭、持续红色闪烁。
 * 处于文档流内（不是覆盖层），会把下方布局整体下推，不遮挡页面内容。
 * 样式全部内联，避免影响普通构建的 CSS 产物。
 * prefers-reduced-motion 时改为更柔和的慢速红色呼吸，始终可见。
 */
const css = `
@keyframes fdc-demo-blink {
  0%, 50% { background-color: #FF3B30; }
  50%, 100% { background-color: #7F1010; }
}
@keyframes fdc-demo-pulse {
  0%, 100% { background-color: #B71C1C; }
  50% { background-color: #D32F2F; }
}
#fdc-demo-banner {
  animation: fdc-demo-blink 2s step-end infinite;
}
@media (prefers-reduced-motion: reduce) {
  #fdc-demo-banner { animation: fdc-demo-pulse 3s ease-in-out infinite; }
}
`

export default function DemoBanner() {
  return (
    <div
      id="fdc-demo-banner"
      role="alert"
      aria-live="polite"
      style={{
        position: 'relative',
        zIndex: 9999,
        flex: '0 0 auto',
        width: '100%',
        backgroundColor: '#B71C1C',
        color: '#ffffff',
        padding: '6px 12px',
        textAlign: 'center',
        fontSize: '13px',
        lineHeight: '18px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        borderBottom: '1px solid #FF3B30',
        userSelect: 'none',
      }}
    >
      <style>{css}</style>
      {DEMO_BANNER_TEXT}
    </div>
  )
}
