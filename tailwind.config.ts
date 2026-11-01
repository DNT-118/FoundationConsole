import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#050505',
          deep: '#111111',
          mid: '#1f1f1f',
          border: '#2b2b2b',
          mute: '#888888',
        },
        paper: '#ffffff',
        scp: { red: '#B71C1C', safe: '#4CAF50', warn: '#FFC107', err: '#FF3B30' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        term: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      backdropBlur: { glass: '8px' },
    },
  },
  plugins: [],
}

export default config
