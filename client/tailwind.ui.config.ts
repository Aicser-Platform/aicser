import type { Config } from 'tailwindcss';

/**
 * Aicser UI: the desktop app's design system (shadcn/ui on Radix, Aicser tokens) on the web, piloted on
 * Docs and Slides. Built separately from the main Tailwind config (src/styles/aicser-ui.css `@config`) and
 * scoped to `.aicser-ui` (`important`), so its colour names (primary, secondary, muted…) never touch the
 * AntD pages, where classes such as `text-secondary` already mean something else. Tokens live in
 * aicser-ui.css as RGB channels, so opacity modifiers (`bg-muted/60`) work in Tailwind 3.
 */
const token = (name: string) => `rgb(var(--ui-${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    './src/components/aicser-ui/**/*.{ts,tsx}',
    './src/components/office/**/*.{ts,tsx}',
    './src/components/docs/**/*.{ts,tsx}',
    './src/components/slides/**/*.{ts,tsx}',
    './src/app/(dashboard)/docs/**/*.{ts,tsx}',
    './src/app/(dashboard)/slides/**/*.{ts,tsx}',
    './src/app/o/**/*.{ts,tsx}',
    './src/app/remote/**/*.{ts,tsx}',
    './src/lib/office/**/*.{ts,tsx}',
  ],
  important: '.aicser-ui',
  darkMode: ['class', '[data-theme="dark"]'],
  // The main build already ships preflight for the whole app.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-foreground'),
          hover: token('primary-hover'),
          active: token('primary-active'),
        },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        destructive: token('destructive'),
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        'file-doc': token('file-doc'),
        'file-sheet': token('file-sheet'),
        'file-slides': token('file-slides'),
      },
      borderRadius: {
        sm: 'calc(var(--ui-radius) * 0.6)',
        md: 'calc(var(--ui-radius) * 0.8)',
        lg: 'var(--ui-radius)',
        xl: 'calc(var(--ui-radius) * 1.4)',
      },
      ringWidth: { 3: '3px' },
    },
  },
  plugins: [],
};

export default config;
