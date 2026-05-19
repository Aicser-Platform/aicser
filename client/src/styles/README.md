# Aiser Platform — CSS Architecture

**See also:** `DESIGN_ARCHITECTURE.md` (project root) for token flow, brand customization, and design principles.

---

## Import Order (app/globals.css)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
@import 'antd/dist/reset.css';
@import '../styles/layout-system.css';
@import '../styles/aiser-color-system.css';
@import '../styles/aiser-navigation-unified.css';
@import '../styles/aiser-component-separation.css';
@import '../styles/aiser-unified-design-system.css';
@import '../styles/aiser-aesthetic-enhancements.css';
```

**Why this order?** Layout first (positioning, scrollbars), then color tokens, navigation, component overrides, unified design tokens, and finally aesthetic polish. Later files override earlier ones.

---

## File Responsibilities

| File | Purpose |
|------|---------|
| `layout-system.css` | Page wrapper, scrollbars, responsive breakpoints, table overflow |
| `aiser-color-system.css` | Base color tokens (light/dark), component color mapping |
| `aiser-navigation-unified.css` | Header, sidebar, menu backgrounds |
| `aiser-component-separation.css` | Component-specific overrides |
| `aiser-unified-design-system.css` | Spacing, radius, shadows, card/button/input styles |
| `aiser-aesthetic-enhancements.css` | Premium polish (tabs, modals, hover effects) |

---

## Token Sources

- **Static:** `aiser-color-system.css` (`:root`, `[data-theme="dark"]`)
- **Runtime:** `ThemeProvider.tsx` (sets vars on `document.documentElement`)
- **Brand:** `BrandThemeProvider.tsx` (custom presets, Theme Customizer)
- **Aliases:** `app/globals.css` (legacy tokens: `--color-brand-primary`, `--layout-background`)

---

## Adding New Styles

1. **Layout/positioning?** → `layout-system.css`
2. **Base colors?** → `aiser-color-system.css`
3. **Navigation?** → `aiser-navigation-unified.css`
4. **Component visuals?** → `aiser-unified-design-system.css` or `aiser-aesthetic-enhancements.css`
5. **Token alias?** → `app/globals.css` (Legacy Token Aliases section)

---

## Deprecated

- `design-system.css` — Not imported. Tokens migrated to `app/globals.css` and `aiser-*` files.
- `styles/globals.css` — Superseded by `app/globals.css`.
