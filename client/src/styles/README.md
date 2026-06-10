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
@import '../styles/dashboard-page-visual-language.css';
@import '../styles/page-shell.css';
@import '../styles/aiser-interaction-system.css';
@import '../styles/workspace-chrome.css';  /* LAST — workspace flat chrome, nested card fixes */
```

**Why this order?** Layout first, then color tokens, navigation, component overrides, unified tokens, aesthetic polish, page visual language, page-shell scroll/height, **aiser-interaction-system.css** for one hover/overlay language, then **workspace-chrome.css** for flat layout workspaces.

---

## File Responsibilities

| File | Purpose |
|------|---------|
| `layout-system.css` | Ant layout structure, sidebar/header positioning, page wrapper base |
| `page-shell.css` | **Canonical** scroll model + flex height chain |
| `dashboard-page-visual-language.css` | Page headers, tabs, tables, cards — not shell layout |
| `aiser-color-system.css` | Base color tokens (light/dark), component color mapping |
| `aiser-navigation-unified.css` | Header, sidebar, menu backgrounds |
| `aiser-component-separation.css` | Component-specific overrides |
| `aiser-unified-design-system.css` | Spacing, radius, shadows, card/button/input styles + interaction tokens |
| `aiser-aesthetic-enhancements.css` | Premium polish (tabs, modals, depth) |
| `aiser-interaction-system.css` | **Canonical** hover, focus, overlay single-border |
| `workspace-chrome.css` | Flat layout workspaces; nested card fixes (imported last) |

---

## Page shell model

| Layer | Scrolls? | Height |
|-------|----------|--------|
| `html` / `body` | No (app routes) | `100%` |
| `.ant-layout-content` | No | `100%`, flex child |
| `.page-content` | No | `100%`, flex child |
| `.page-wrapper` | Yes (standard pages) | `100%`, `min-height: 0` |
| `.page-wrapper--full-bleed` | No (studio scrolls internally) | `100%` |
| `.page-wrapper--fill-height` | No (workspace scrolls internally) | `100%` |

Use `DashboardPageShell fullBleed` for dashboard/chart studio routes.
Use `DashboardPageShell fillHeight` for query editor and other full-viewport workspaces.

**App shell classes** (set in `DashboardLayout.tsx` / `Header.tsx`):
- `.layout-app-shell` — root row (sidebar + main column)
- `.layout-main-column` — main area offset by `--sidebar-width`
- `.layout-app-header` — fixed top bar aligned to sidebar edge
- `.app-navigation-sider` — fixed left rail with logo + SidebarNav

**App shell positioning:** Only `page-shell.css` sets geometry on these classes. `--sidebar-width` is set in `DashboardLayout.tsx` (80 collapsed / 256 expanded / 0 mobile). Visual layers must not override position, width, or crush `.app-navigation-sider-inner`.

---

## Token Sources

- **Static:** `aiser-color-system.css` (`:root`, `[data-theme="dark"]`)
- **Runtime:** `ThemeProvider.tsx` (sets vars on `document.documentElement`)
- **Brand:** `BrandThemeProvider.tsx` (custom presets, Theme Customizer)
- **Shell:** `--app-header-height`, `--app-shell-gutter` in `app/globals.css`
- **Aliases:** `app/globals.css` (legacy tokens: `--color-brand-primary`, `--layout-background`)

---

## Adding New Styles

1. **Layout/positioning?** → `layout-system.css` (avoid `calc(100vh)` on nested wrappers)
2. **Shell scroll/height conflict?** → `page-shell.css` only
3. **Base colors?** → `aiser-color-system.css`
4. **Navigation?** → `aiser-navigation-unified.css`
5. **Component visuals?** → `aiser-unified-design-system.css` or `aiser-aesthetic-enhancements.css`
6. **Page headers/tables/tabs?** → `dashboard-page-visual-language.css`
7. **Token alias?** → `app/globals.css` (Legacy Token Aliases section)

---

## Design contract (one brand)

1. **One token map** — components use `var(--ant-*)` / `var(--color-*)` only; avoid new ad-hoc `--layout-*` in feature CSS.
2. **One owner per global control** — base look in `aiser-unified-design-system.css`; hover/overlays in `aiser-interaction-system.css`. Other files may only **scope** (e.g. `.chat-panel .ant-btn`).
3. **Page/feature CSS** — layout hooks only (`qe-*`, `.chat-panel`, `.page-section-card`). No bare global `.ant-btn` / `.ant-card` in component folders.

Run `npm run lint:css` locally (stylelint + brace balance + ownership scan).

---

## Deprecated / removed

- `design-system.css` — **removed** (was 4,762 lines, never imported). Tokens live in `app/globals.css` and `aiser-*` files.
- `styles/globals.css` — **removed** (thin re-export; use `app/globals.css` only).
