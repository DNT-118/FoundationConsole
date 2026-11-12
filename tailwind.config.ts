import type { Config } from 'tailwindcss'

type OpacityColor = (options: { opacityValue?: string }) => string

// Tailwind cannot apply `/60`-style opacity modifiers to a raw `var(...)`
// color. Keep the theme tokens as CSS variables while teaching Tailwind how
// to blend those colors whenever an opacity modifier is present.
const themeColor = (variable: string): OpacityColor => ({ opacityValue }) =>
  opacityValue === undefined
    ? `var(${variable})`
    : `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主题化 token：值由 CSS 变量（:root[data-theme=...]）驱动，随 data-theme 切换
        ink: {
          DEFAULT: themeColor('--ink'),
          deep: themeColor('--ink-deep'),
          mid: themeColor('--ink-mid'),
          border: themeColor('--ink-border'),
          mute: themeColor('--ink-mute'),
        },
        paper: themeColor('--paper'),
        foreground: themeColor('--paper'),
        inverse: themeColor('--inverse'),
        accent: themeColor('--accent'),
        scp: {
          red: themeColor('--scp-red'),
          safe: themeColor('--scp-safe'),
          warn: themeColor('--scp-warn'),
          err: themeColor('--scp-err'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Noto Sans SC', 'ui-monospace', 'monospace'],
        term: ['IBM Plex Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      backdropBlur: { glass: '8px' },
    },
  },
  plugins: [],
}

export default config
