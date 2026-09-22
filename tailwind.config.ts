import type { Config } from 'tailwindcss'

// Maps Tailwind utility classes (bg-primary, rounded-lg, etc.) to CSS custom
// properties. The properties themselves are NOT defined here — Tailwind's
// config is compile-time and global, it can't hold 4 different portal
// palettes. The values live in globals.css, scoped per portal under
// [data-portal="..."] selectors. Ported from the k2-ui-foundation-test
// package; only the four `*-text` and four `*-foreground` semantic
// utilities below are new (see globals.css for what problem each solves).

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // semantic tokens — identical in every portal, doc 20 §1.1.
        // Use these for fills, icons, borders — NOT literal text color
        // (see success-text etc. below for that).
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        error: 'hsl(var(--error))',
        info: 'hsl(var(--info))',
        // NEW — readable foreground for a SOLID semantic fill (a day-cell
        // block, a solid badge). Global, not portal-scoped: the base
        // semantic color doesn't change per portal, so neither does its
        // solid-fill foreground.
        'success-foreground': 'hsl(var(--success-foreground))',
        'warning-foreground': 'hsl(var(--warning-foreground))',
        'error-foreground': 'hsl(var(--error-foreground))',
        'info-foreground': 'hsl(var(--info-foreground))',
        // NEW — portal-scoped shade of each semantic hue, safe to use AS
        // literal text on that portal's own neutral surfaces. This is the
        // fix for the WCAG bug flagged in the UI foundation README.
        'success-text': 'hsl(var(--success-text))',
        'warning-text': 'hsl(var(--warning-text))',
        'error-text': 'hsl(var(--error-text))',
        'info-text': 'hsl(var(--info-text))',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      transitionDuration: {
        DEFAULT: 'var(--motion-duration)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--motion-ease)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
