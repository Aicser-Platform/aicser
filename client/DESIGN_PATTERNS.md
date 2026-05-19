# Client Design Patterns

> Architecture and design patterns for the Aicser frontend client.

---

## Table of Contents

1. [Overview](#overview)
2. [Directory Structure](#directory-structure)
3. [Technology Stack](#technology-stack)
4. [Routing & Page Structure](#routing--page-structure)
5. [Component Architecture](#component-architecture)
6. [State Management](#state-management)
7. [Data Fetching Strategy](#data-fetching-strategy)
8. [Authentication Architecture](#authentication-architecture)
9. [API Layer](#api-layer)
10. [Styling & Theming](#styling--theming)
11. [Internationalization](#internationalization)
12. [Enterprise Edition (EE) Support](#enterprise-edition-ee-support)
13. [Build & Configuration](#build--configuration)
14. [Code Style](#code-style)

---

## Overview

The client is a **Next.js 14 (App Router)** application built for a multi-edition (Community Edition / Enterprise Edition) deployment model. It uses a layered architecture separating concerns across:

- **Routing** — Next.js App Router with route groups for auth and protected areas
- **State** — Zustand stores for global client state
- **Data** — React Query (TanStack Query v5) for server state and caching
- **UI** — Ant Design 5 + Tailwind CSS with a synchronized CSS variable theme system

---

## Directory Structure

```
client/
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── (auth)/              # Public auth routes (login, logout, invite)
│   │   ├── (dashboard)/         # Protected dashboard routes
│   │   └── api/                 # Next.js API route handlers
│   ├── components/              # React components
│   │   ├── Providers/           # App-wide context providers
│   │   ├── ai/                  # AI-related UI (agents, model selector)
│   │   ├── data/                # Data management UI (SQL editor, connectors)
│   │   ├── data-platform/       # BI platform UI (catalog, lakehouse, streams)
│   │   ├── layout/              # Header, Navigation
│   │   └── ui/                  # Generic/shared UI components
│   ├── stores/                  # Zustand state stores
│   ├── hooks/                   # Custom React hooks
│   ├── api/                     # API client functions (per domain)
│   ├── auth/                    # Auth logic and edition adapters
│   ├── config/                  # Environment config, provider registries
│   ├── services/                # Higher-level business logic services
│   ├── types/                   # Shared TypeScript interfaces
│   ├── utils/                   # Utility functions (fetch wrapper, URL helpers)
│   └── styles/                  # Global CSS and design tokens
├── ee/                          # Enterprise Edition overrides (conditionally symlinked)
├── public/                      # Static assets
├── scripts/                     # Build and setup scripts
├── middleware.ts                # Auth guard + CORS middleware
├── next.config.mjs              # Next.js configuration
├── tailwind.config.ts           # Tailwind CSS configuration
└── tsconfig.json                # TypeScript configuration
```

---

## Technology Stack

| Layer | Library | Version |
|---|---|---|
| Framework | Next.js (App Router) | 14.2.35 |
| Language | TypeScript | 5.9.3 |
| UI Components | Ant Design | 5.29.3 |
| Styling | Tailwind CSS | 3.4.18 |
| State Management | Zustand | 4.5.7 |
| Data Fetching | TanStack React Query | 5.90.2 |
| Immutable State | Immer (Zustand middleware) | bundled |
| Undo/Redo | Zundo (Zustand temporal middleware) | 2.3.0 |
| Charts | ECharts, Recharts | 6.0.0 / 2.15.4 |
| Code Editor | Monaco Editor, ACE Editor | — |
| i18n | next-intl | 4.9.0 |
| Auth backend (EE) | Supabase | 2.89.0 |
| In-browser DB | DuckDB WASM | — |
| HTTP client | Axios, native fetch | — |
| Real-time | Socket.io-client | — |
| Utilities | Lodash, Day.js | — |

---

## Routing & Page Structure

Next.js App Router with **route groups** to separate public and protected areas.

```
/                          → root layout.tsx
├── (auth)/
│   ├── login/             → Login page
│   ├── logout/            → Logout handler
│   └── invite/            → Invite acceptance
└── (dashboard)/           → Protected layout (auth guard)
    ├── dashboards/        → Dashboard list and editor
    ├── projects/          → Project management
    ├── data/              → Data source management
    ├── data-platform/     → BI platform (catalog, lakehouse, semantic layer)
    ├── settings/          → User and org settings
    └── chat/              → AI chat interface
```

**Route groups** (`(auth)`, `(dashboard)`) share a layout without affecting the URL path. The `(dashboard)` layout wraps all protected pages in a `ProtectedRoute` component that checks `useAuthStore.isAuthenticated`.

### Middleware

`middleware.ts` runs on every request and handles:

1. **Auth guard** — checks `auth_token` cookie; redirects unauthenticated requests to `/login?next=<path>`
2. **Public path bypass** — `/login`, `/logout`, `/api/auth/`, `/_next/`, static assets
3. **CORS headers** — applied to all API responses with dynamic `Access-Control-Allow-Origin`

---

## Component Architecture

### Provider Stack

All providers are composed in `src/components/Providers/Providers.tsx`:

```
<AntdRegistry>                     ← Ant Design SSR style extraction
  <QueryClientProvider>            ← React Query client
    <ThemeProvider>                ← CSS variables + Ant Design token sync
      <BrandThemeProvider>         ← Brand-level color overrides
        <LocaleProvider>           ← next-intl locale context
          <AuthInitializer />      ← Hydrates useAuthStore on mount
          {children}
          <ClientDebugOverlay />   ← Dev-only debug panel
          <ReactQueryDevtools />   ← Dev-only query inspector
        </LocaleProvider>
      </BrandThemeProvider>
    </ThemeProvider>
  </QueryClientProvider>
</AntdRegistry>
```

### Component Conventions

- All components are **React functional components** with TypeScript props interfaces.
- Feature components live in `src/components/<feature>/` and are co-located with their types and helpers.
- Generic/reusable components live in `src/components/ui/`.
- Components do not call `fetchApi()` directly — they use hooks from `src/hooks/`.

### Permission Guard

`src/components/PermissionGuard.tsx` wraps UI sections that require a specific role or plan tier. It reads from `useRoleStore` and `usePlanRestrictions` and renders `null` (or an upgrade prompt) when the current user lacks access.

---

## State Management

All global state uses **Zustand**. No Redux, no Context API for data state.

### Store Catalog

| Store | Persistence | Key State |
|---|---|---|
| `useAuthStore` | sessionStorage | `user`, `isAuthenticated`, `authLoading` |
| `useOrganizationStore` | localStorage | `currentOrg`, `organizations` |
| `useProjectStore` | in-memory | `currentProject`, `projects` |
| `useDashboardStore` | in-memory + Zundo | `widgets`, `selectedWidgetIds`, `isDragging` |
| `useDataSourceStore` | in-memory | `dataSources`, `activeConnection` |
| `useSettingsStore` | in-memory | `userSettings` |
| `useHeaderStore` | in-memory | `title`, `breadcrumbs`, `actions` |
| `useLoadingStore` | in-memory | `isLoading`, `loadingKey` |
| `useRoleStore` | in-memory | `roles`, `permissions` |

### Middleware Usage

```typescript
// Immer — mutable-style immutable updates
create(immer<State>((set) => ({
  addWidget: (widget) => set((state) => {
    state.widgets.push(widget);
  }),
})))

// Zundo — temporal history for undo/redo (50-action limit)
const useDashboardStore = temporal(create(...), {
  limit: 50,
  partialize: (state) => ({ widgets: state.widgets }),
})

// persist — localStorage sync
create(persist<State>(fn, { name: 'org-store' }))

// devtools — Redux DevTools integration
create(devtools(fn, { name: 'AuthStore' }))
```

### Dashboard Store (most complex)

`useDashboardStore` manages the live widget canvas with full undo/redo support:

**State**: `widgets`, `selectedWidgetIds`, `isDragging`, `clipboard`, `layout`

**Actions**: `addWidget`, `updateWidget`, `removeWidget`, `selectWidget`, `copyWidget`, `pasteWidget`, `duplicateWidget`, `updateLayout`, `applyRemoteUpdate`

**Undo/Redo**: exposed via `useTemporalStore(useDashboardStore)` — `undo()`, `redo()`, `canUndo`, `canRedo`

---

## Data Fetching Strategy

Server state (API data) is managed entirely by **React Query**. Zustand stores hold client-only UI state, not API response data.

### Layered Flow

```
Component
  └── useCustomHook (src/hooks/)
        └── useQuery / useMutation (React Query)
              └── API function (src/api/<domain>.ts)
                    └── fetchApi() (src/utils/api.ts)
                          └── Backend REST API
```

### Custom Hook Pattern

```typescript
// src/hooks/useDashboards.ts
const dashboardKeys = {
  all: ['dashboards'] as const,
  list: (projectId: string) => [...dashboardKeys.all, 'list', projectId] as const,
  detail: (id: string) => [...dashboardKeys.all, 'detail', id] as const,
};

export const useDashboards = (projectId: string) =>
  useQuery({
    queryKey: dashboardKeys.list(projectId),
    queryFn: () => api.listDashboards(projectId),
    select: (res) => res.dashboards,
    staleTime: 5 * 60 * 1000,   // 5 minutes
    gcTime: 10 * 60 * 1000,     // 10 minutes
  });

export const useCreateDashboard = () =>
  useMutation({
    mutationFn: api.createDashboard,
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.list(projectId) });
    },
  });
```

### Authenticated Hooks

Base hooks in `src/hooks/useAuthenticatedQuery.ts` wrap `useQuery` / `useMutation` to automatically include the Bearer token header and redirect to login on 401.

### Cache Strategy

- `staleTime: 5min` — data treated as fresh for 5 minutes
- `gcTime: 10min` — unused cache entries removed after 10 minutes
- Explicit `invalidateQueries()` after mutations
- Optimistic updates used selectively for instant UI feedback

---

## Authentication Architecture

### Multi-Edition Model

The auth layer is abstracted behind an interface so CE and EE ship different implementations:

```typescript
// src/auth/types.ts
interface AuthActions {
  login(credentials: LoginPayload): Promise<AuthResult>;
  signup(payload: SignupPayload): Promise<SignupResult>;
  logout(): Promise<void>;
  getToken(): string | null;
}
```

`src/auth/authProvider.ts` detects the runtime edition via `NEXT_PUBLIC_EDITION` and dynamically imports either the CE or EE implementation.

### CE Auth Flow

1. User submits credentials
2. `ceAuthActions.login()` → `POST /api/auth/login` (Next.js API route → FastAPI)
3. FastAPI returns `access_token` and sets `auth_token` httpOnly cookie
4. `access_token` stored in `sessionStorage` via `setCeBearerToken()`
5. `useAuthStore.init()` calls `GET /api/auth/me` to hydrate the user object

### EE Auth Flow

- Supports Keycloak OIDC (`src/auth/keycloak.ts`) or Supabase (`src/auth/authClient.ts`)
- Controlled by `NEXT_PUBLIC_AUTH_PROVIDER` env var
- Same `AuthActions` interface — swap implementation, not callers

### Token Usage

`fetchApi()` (`src/utils/api.ts`) resolves the token in this priority order:

1. CE Bearer token from `sessionStorage`
2. Supabase session token (EE only)
3. Omits header if neither exists (public endpoints)

The httpOnly `auth_token` cookie provides a secondary auth path for SSR and middleware checks.

### Route Protection

- **Middleware** (`middleware.ts`): cookie-level check before any page renders
- **`ProtectedRoute` component**: client-side `useAuthStore.isAuthenticated` check with loading state
- **`PermissionGuard` component**: role/plan tier check for feature-level access control

---

## API Layer

### Structure

```
src/api/
├── dashboards.ts       # Dashboard and chart CRUD
├── dataSources.ts      # Data source CRUD
├── organizations.ts    # Organization management
└── projects.ts         # Project management
```

Each file exports plain async functions — no classes, no singletons.

### Naming Convention

```typescript
// dashboards.ts
export const listDashboards = (projectId: string) =>
  fetchApi<DashboardListResponse>(`/dashboards?project_id=${projectId}`);

export const getDashboard = (id: string) =>
  fetchApi<Dashboard>(`/dashboards/${id}`);

export const createDashboard = (payload: CreateDashboardPayload, projectId: string) =>
  fetchApi<Dashboard>(`/dashboards`, { method: 'POST', body: JSON.stringify({ ...payload, project_id: projectId }) });

export const updateDashboard = (id: string, payload: Partial<Dashboard>) =>
  fetchApi<Dashboard>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteDashboard = (id: string) =>
  fetchApi<void>(`/dashboards/${id}`, { method: 'DELETE' });
```

### Core Fetch Wrapper (`src/utils/api.ts`)

- Prepends the backend base URL from `src/config/environment.ts`
- Injects `Authorization: Bearer <token>` header
- Parses JSON response and throws typed errors
- Redirects to `/login` on 401
- Maps error responses to user-facing messages via `userFacingApiError.ts`

---

## Styling & Theming

### Three-Layer System

1. **CSS Variables** — design tokens at the `:root` level, updated dynamically by `ThemeProvider`
2. **Ant Design tokens** — synchronized with CSS variables via `theme.useToken()`
3. **Tailwind utilities** — utility classes referencing the CSS variables

### CSS Variable Color System

`ThemeProvider.tsx` manages a **5-level background hierarchy**:

| Level | CSS Variable | Usage |
|---|---|---|
| Base | `--color-bg-base` | Page/layout background |
| Container | `--color-bg-container` | Cards, panels, tables, forms |
| Elevated | `--color-bg-elevated` | Modals, dropdowns, hover states |
| Navigation | `--color-bg-navigation` | Header, sidebar |
| Border | `--color-border-primary` | All borders |

Primary brand color: `#00c2cb` (cyan).

Text hierarchy: `--color-text-primary` → `secondary` → `tertiary` → `quaternary`

### Dark Mode

- Toggle stored in `localStorage` as `darkMode` (boolean)
- Applied to `<html>` as `class="dark"` and `data-theme="dark"`
- Cross-tab sync via `storage` event listener
- Fallback to `prefers-color-scheme` system preference
- Ant Design algorithm switches between `theme.defaultAlgorithm` and `theme.darkAlgorithm`

### Tailwind Configuration

```typescript
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      brand: { primary: 'var(--color-brand-primary)' },
      bg: {
        base: 'var(--color-bg-base)',
        container: 'var(--color-bg-container)',
        elevated: 'var(--color-bg-elevated)',
      },
      border: { primary: 'var(--color-border-primary)' },
    }
  }
}
```

### Global Stylesheets

- `src/styles/globals.css` — root reset and system font stack
- `src/styles/design-system.css` — design tokens
- `src/styles/aiser-unified-design-system.css` — brand-specific overrides

---

## Internationalization

`next-intl` v4 with 10+ locales. Locale is set per-user and stored in settings.

**Locale Provider** (`src/components/Providers/LocaleProvider.tsx`):
- Wraps app with `NextIntlClientProvider`
- Message files loaded from `src/config/locales.ts`
- Falls back to English via `src/utils/mergeMessagesWithEnglish.ts` for missing keys

**Usage in components**:
```typescript
const t = useTranslations('Dashboard');
return <h1>{t('title')}</h1>;
```

---

## Enterprise Edition (EE) Support

### Path Alias

```json
// tsconfig.json
"paths": {
  "@/ee/*": ["./ee/src/*"]
}
```

CE builds have `ee/` as an empty stub directory. EE builds symlink the real EE package via `scripts/setup-ee.js` (postinstall hook).

### Runtime Detection

```typescript
const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
```

Components that have EE-only variants use dynamic imports with a CE fallback:

```typescript
const PricingModal = isEnterprise
  ? dynamic(() => import('@/ee/components/PricingModal'))
  : dynamic(() => import('@/components/PricingModal'));
```

### EE-Only Modules

```
ee/src/
├── api/
│   ├── billing.ts
│   └── conversations.ts
├── auth/
│   ├── authActions.ts     # Keycloak / Supabase auth
│   └── keycloak.ts
├── components/
│   ├── Billing/
│   ├── UpgradeModal.tsx
│   ├── PricingModal.tsx
│   └── TrialExpiryBanner.tsx
├── hooks/
│   ├── useBilling.ts
│   ├── usePlanFeatures.ts
│   └── useFeatureGate.tsx
└── stores/
    ├── useSubscriptionStore.ts
    └── useBillingStore.ts
```

---

## Build & Configuration

### Next.js Config (`next.config.mjs`)

```javascript
{
  output: 'standalone',                   // Docker-ready build
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  experimental: {
    optimizePackageImports: ['antd', '@ant-design/icons', 'echarts'],
    turbo: {
      resolveAlias: {
        // Ant Design ellipsis patch — prevents crashes on truncated text
        'antd/es/typography/Base/Ellipsis': './src/patches/antd-safe-ellipsis.tsx'
      }
    }
  },

  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = { '.js': ['.js', '.ts', '.tsx'] };
    if (!isServer) {
      config.resolve.fallback = { fs: false, net: false, tls: false };
    }
    return config;
  }
}
```

### Scripts

```bash
npm run dev          # Dev server (2GB heap)
npm run dev:light    # Dev server with Turbopack (2GB heap)
npm run build        # Production build (2GB heap)
npm run build:light  # Production build (1GB heap)
npm start            # Start production server
npm run lint         # ESLint with cache
npm run format       # Prettier write
npm run clean        # Remove .next cache
```

### TypeScript Config Highlights

```json
{
  "compilerOptions": {
    "target": "es2015",
    "strict": true,
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./src/*"],
      "@/ee/*": ["./ee/src/*"]
    }
  }
}
```

---

## Code Style

### ESLint (`.eslintrc.json`)

Extends `next/core-web-vitals`, `next/typescript`, `prettier`.

Key rules (all `warn`, not `error`):
- `no-console`
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unused-vars`
- `react-hooks/exhaustive-deps`
- `react/jsx-key`

### Prettier (`.prettierrc`)

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 120
}
```

### Conventions Summary

- **Imports** — path alias `@/` for `src/`, `@/ee/` for enterprise code
- **Hooks** — prefix `use`, live in `src/hooks/`; one hook per domain concept
- **Stores** — prefix `use`, suffix `Store` (e.g., `useAuthStore`)
- **API functions** — plain async functions exported from `src/api/<domain>.ts`
- **Types** — co-located with domain or in `src/types/` for shared types
- **Components** — PascalCase files and exports; props interface inline or in same file
