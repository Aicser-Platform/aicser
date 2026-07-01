import type { Config } from 'tailwindcss';

const config: Config = {
    content: [
        './src/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    darkMode: ['class', '[data-theme="dark"]'],
    theme: {
        extend: {
            colors: {
                // ✅ Keep your custom colors
                brand: {
                    DEFAULT: 'var(--color-brand-primary)',
                    hover: 'var(--color-brand-primary-hover)',
                    active: 'var(--color-brand-primary-active)',
                    foreground: 'var(--color-brand-primary-foreground)',
                    subtle: 'var(--color-brand-primary-light)',
                },
                bg: {
                    DEFAULT: 'var(--layout-background)',
                    elevated: 'var(--ant-color-bg-elevated)',
                    muted: 'var(--ant-color-bg-container)',
                    subtle: 'var(--ant-color-bg-container)',
                    container: 'var(--ant-color-bg-container)',
                },
                border: {
                    DEFAULT: 'var(--color-border-primary)',
                    light: 'var(--ant-color-border-secondary)',
                    strong: 'var(--color-border-primary-strong)',
                },
                text: {
                    DEFAULT: 'var(--ant-color-text)',
                    secondary: 'var(--ant-color-text-secondary)',
                    tertiary: 'var(--ant-color-text-tertiary)',
                    disabled: 'var(--ant-color-text-quaternary)',
                    inverse: 'var(--color-brand-primary-foreground)',
                },
            },
            fontFamily: {
                sans: 'var(--font-sans)',
                mono: 'var(--font-mono)',
            },
            // ✅ CRITICAL FIX: Don't override default Tailwind values
            // Remove fontSize, spacing overrides that use CSS variables
            // This allows text-xs, text-lg, p-6, etc. to work with default Tailwind values
            brightness: {
                25: '.25',
            },
        },
    },
    plugins: [],
};

export default config;
