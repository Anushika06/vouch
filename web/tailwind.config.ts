import type { Config } from 'tailwindcss'

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        raised: v('raised'),
        sunken: v('sunken'),
        line: v('line'),
        'line-strong': v('line-strong'),
        fg: v('fg'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        'accent-fg': v('accent-fg'),
        green: v('trust-green'),
        yellow: v('trust-yellow'),
        red: v('trust-red'),
        'green-ink': v('green-ink'),
        'yellow-ink': v('yellow-ink'),
        'red-ink': v('red-ink'),
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        pop: '0 12px 32px -12px rgb(var(--shadow) / 0.45), 0 2px 6px -2px rgb(var(--shadow) / 0.25)',
        card: '0 1px 0 rgb(var(--shadow) / 0.04)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'rise': { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'verdict': { '0%': { transform: 'scale(.96)', opacity: '0' }, '60%': { transform: 'scale(1.01)', opacity: '1' }, '100%': { transform: 'none' } },
        'pulse-dot': { '0%, 80%, 100%': { opacity: '.25' }, '40%': { opacity: '1' } },
        shimmer: { from: { backgroundPosition: '-400px 0' }, to: { backgroundPosition: '400px 0' } },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'slide-in-right': 'slide-in-right .22s cubic-bezier(.2,.8,.2,1)',
        rise: 'rise .22s ease-out',
        verdict: 'verdict .5s cubic-bezier(.2,.8,.2,1)',
        'pulse-dot': 'pulse-dot 1.2s infinite ease-in-out',
        shimmer: 'shimmer 1.4s infinite linear',
      },
    },
  },
  plugins: [],
} satisfies Config
