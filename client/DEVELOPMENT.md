# Client Development Guide

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Logical Architecture](#logical-architecture)
3. [CE vs EE Edition Split](#ce-vs-ee-edition-split)
4. [Routing & Layouts](#routing--layouts)
5. [State Management](#state-management)
6. [Data Fetching](#data-fetching)
7. [Authentication & Authorization](#authentication--authorization)
8. [Component Patterns](#component-patterns)
9. [TypeScript Conventions](#typescript-conventions)
10. [Adding New Features](#adding-new-features)

---

## Directory Structure

```
client/
├── src/                        # Community Edition source
│   ├── app/                    # Next.js App Router pages & layouts
│   │   ├── (auth)/             # Auth route group — login, register, etc.
│   │   ├── (dashboard)/        # Protected route group — all main app pages
│   │   ├── api/                # Next.js API routes (server-side proxies)
│   │   └── layout.tsx          # Root layout — wraps everything in <Providers>
│   ├── api/                    # API client functions (raw fetch wrappers)
│   ├── auth/                   # Auth provider abstraction (CE/EE switchable)
│   ├── components/             # Shared UI components
│   ├── hooks/                  # Custom React hooks
│   ├── queries/                # Re-export barrel for React Query hooks (deprecated, use hooks/)
│   ├── services/               # Heavy service classes (AI, chart data, etc.)
│   ├── stores/                 # Zustand global state stores
│   ├── types/                  # TypeScript type definitions
│   ├── utils/                  # Pure utility functions
│   ├── styles/                 # Global CSS
│   ├── layouts/                # Page layout components (DashboardLayout, etc.)
│   └── ee -> ee/src            # Symlink: resolved at runtime to EE implementation
├── ee/                         # Enterprise Edition source (separate git repo)
│   └── src/                    # Mirrors the structure of src/ee/
│       ├── api/
│       ├── app/
│       ├── auth/
│       ├── components/         # EE-only components (TrialExpiryBanner, BillingSuccessHandler, etc.)
│       ├── hooks/
│       ├── services/
│       └── stores/             # EE stores (useConversationStore, useOnboardingStore, etc.)
├── Dockerfile.dev              # Dev image — mounts source, creates EE symlink at startup
├── Dockerfile.prod             # Prod image — full Next.js build
└── next.config.mjs
```

**Path alias:** `@/*` → `./src/*` (configured in `tsconfig.json`)

### CSS design contract

- **Tokens:** consume `var(--ant-*)` / `var(--color-*)` from `app/globals.css` and `src/styles/aiser-*.css` — do not introduce parallel scales in feature CSS.
- **One owner per global Ant control:** base in `aiser-unified-design-system.css`, hover/overlays in `aiser-interaction-system.css`. Feature sheets scope under a root class (`.chat-panel`, `.query-editor-workspace`).
- **Checks:** `npm run lint:css` (stylelint + brace balance + ownership scan). See `src/styles/README.md`.

---

## Logical Architecture

```
Browser Request
      │
      ▼
┌─────────────────────────────────┐
│  Next.js App Router             │
│  app/layout.tsx                 │  ← Root: wraps in <Providers>
│    └── (dashboard)/layout.tsx   │  ← Auth guard + DashboardLayout
│          └── page.tsx           │  ← Feature page
└─────────────────────────────────┘
           │
           ▼
┌──────────────────────┐    ┌──────────────────────┐
│  Zustand Stores      │    │  React Query Cache    │
│  (client state)      │    │  (server state)       │
│                      │    │                       │
│  useAuthStore        │    │  hooks/useDashboards  │
│  useOrganizationStore│    │  hooks/useProjects    │
│  useProjectStore     │    │  hooks/useDataSources │
│  useDashboardStore   │    │  ...                  │
└──────────────────────┘    └──────────────────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
           ┌──────────────────┐
           │  api/ layer      │  ← fetchApi() wrappers — typed, no side effects
           └──────────────────┘
                      │
                      ▼
           ┌──────────────────┐
           │  FastAPI server  │  ← http://server:8000
           └──────────────────┘
```

---

## CE vs EE Edition Split

The codebase supports two editions: **Community (CE)** and **Enterprise (EE)**.

### How it works

| Layer                       | CE                                                                   | EE                                                         |
| --------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/ee/`                   | Lightweight stubs                                                    | Full implementations (via symlink → `ee/src`)              |
| `src/auth/authProvider.ts`  | Uses `ceAuthActions`                                                 | Uses `eeAuthActions` when `NEXT_PUBLIC_EDITION=enterprise` |
| EE components in CE layouts | Loaded with `dynamic(..., { ssr: false })` — renders nothing if stub | Full component                                             |

### The symlink

`src/ee` is a symlink. On the host it points to the absolute host path of `ee/src`. Inside the Docker container, the `Dockerfile.dev` entrypoint recreates it as a container-internal path:

```sh
ln -sf /app/ee/src /app/src/ee
```

This runs **after** the volume mount so the broken host-absolute path is replaced.

### Writing CE/EE-split features

1. Put the CE stub in `src/ee/<category>/YourFeature.ts` — export the same interface with no-op defaults.
2. Put the real EE implementation in `ee/src/<category>/YourFeature.ts`.
3. Import via `@/ee/<category>/YourFeature` — resolves to the stub in CE, real code in EE.

For stores that need EE backing, use the re-export pattern in `src/stores/`:

```ts
// src/stores/useMyStore.ts
export { useMyStore } from '@/ee/stores/useMyStore';
```

For components in CE layouts, always use `next/dynamic` with `ssr: false`:

```tsx
const EEComponent = dynamic(() => import('@/ee/components/EEComponent'), {
  ssr: false,
  loading: () => null,
});
```

---

## Routing & Layouts

The app uses **Next.js App Router** with route groups:

```
app/
├── layout.tsx                  # Root — applies <Providers>, fonts, dark mode init
├── (auth)/                     # Public pages — no auth required
│   ├── login/page.tsx
│   └── register/page.tsx
└── (dashboard)/                # Protected pages
    ├── layout.tsx              # ProtectedRoute guard + DashboardLayout
    ├── chat/page.tsx
    ├── dashboards/page.tsx
    ├── projects/page.tsx
    ├── data/page.tsx
    └── settings/page.tsx
```

### Auth Guard

`(dashboard)/layout.tsx` wraps all protected pages in `<ProtectedRoute>` which reads `useAuthStore`:

```tsx
function ProtectedRoute({ children }) {
  const { isAuthenticated, authLoading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading) return null;
  if (!isAuthenticated) return null;
  return <>{children}</>;
}
```

Do **not** add per-page auth checks — the layout handles it.

### EE `/chat` and artifact deep links (EE only)

Canonical query parameter for opening a conversation is **`conversation`** (not `conversationId`). Legacy `?conversationId=` URLs are rewritten to `?conversation=` on load.

| URL | Purpose |
| --- | --- |
| `/chat?conversation={uuid}&message={id}` | Open conversation and scroll to message |
| `/chat?mode=executive_report` | Pre-select executive report mode |
| `/chat?mode=dashboard` | Pre-select dashboard build mode |
| `/chat?tier=brief\|standard\|long` | Report depth (with `mode=executive_report`) |
| `/chat?tier=monitoring\|operational\|executive` | Dashboard tier (with `mode=dashboard`) |
| `/chat?prompt=…` | Seed the composer |
| `/chat?data_source_id=…` | Select data source on load |
| `/chat?regenerate=1` | Re-run last user message in executive report mode (requires `conversation`) |
| `/report/{conversationId}/{messageId}` | Full-page executive report viewer (export/print) |
| `/dashboards?id={uuid}&page={pageId}` | Open AI-built dashboard in studio (`from_chat` optional breadcrumb) |

Helpers live in [`ee/src/ee/app/(dashboard)/chat/utils/chatDeepLinks.ts`](ee/src/ee/app/(dashboard)/chat/utils/chatDeepLinks.ts).

---

## State Management

### Two-tier state

| Tier             | Tool                                  | Purpose                                     |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| **Server state** | React Query (`@tanstack/react-query`) | API data, caching, background refetch       |
| **Client state** | Zustand                               | Auth session, UI state, current org/project |

### Zustand store conventions

Stores live in `src/stores/`. Each file exports one `use*Store` hook.

```ts
// Pattern: devtools + persist for stores that survive page refresh
export const useOrganizationStore = create<State>()(
  devtools(
    persist(
      (set) => ({ ... }),
      { name: 'organization-storage', storage: createJSONStorage(() => localStorage) }
    ),
    { name: 'OrganizationStore' }
  )
);
```

- Use `devtools` middleware on all stores for Redux DevTools support.
- Use `persist` only when the value should survive a page refresh (e.g. `currentOrganization`).
- Auth state lives in `useAuthStore` — do **not** duplicate it in other stores.

### React Query configuration

Global defaults in `src/components/Providers/Providers.tsx`:

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — consider data fresh
      gcTime: 10 * 60 * 1000, // 10 min — keep in cache
      retry: 1,
    },
  },
});
```

---

## Data Fetching

### Layered approach

```
Component / Page
    └── hooks/use*.ts          ← useQuery / useMutation wrappers
         └── api/*.ts          ← fetchApi() typed functions
              └── utils/api.ts ← base fetchApi with auth headers
```

### `fetchApi` — base fetch utility

All API calls go through `fetchApi` in `src/utils/api.ts`. It automatically:

- Prepends `NEXT_PUBLIC_API_URL`
- Attaches the `Authorization: Bearer <token>` header from the current session
- Throws on non-2xx responses

### `api/` — typed resource functions

Pure functions, no hooks, no side effects:

```ts
// src/api/projects.ts
export const listProjects = (organizationId: string): Promise<{ projects: Project[] }> =>
  fetchApi(`/projects/organization/${organizationId}`);

export const createProject = (data: Partial<Project>): Promise<Project> =>
  fetchApi('/projects', { method: 'POST', body: JSON.stringify(data) });
```

### `hooks/` — React Query wrappers

```ts
// src/hooks/useProjects.ts
export function useProjects(organizationId: string) {
  return useQuery({
    queryKey: ['projects', organizationId],
    queryFn: () => listProjects(organizationId),
    enabled: !!organizationId,
  });
}
```

Use `useAuthenticatedQuery` when you need explicit token access:

```ts
export function useAuthenticatedQuery<TData>(
  queryKey: unknown[],
  queryFn: (token: string) => Promise<TData>,
  options?: ...
)
```

---

## Authentication & Authorization

### Auth provider abstraction

`src/auth/authProvider.ts` exports `getAuthActions()` which returns either CE or EE auth actions based on `NEXT_PUBLIC_EDITION`. Components never call auth providers directly — they use `useAuthStore`.

### RBAC — Permissions

Permissions are defined as an enum in `src/hooks/usePermissions.tsx`:

```ts
export enum Permission {
  PROJECT_EDIT = 'project:edit',
  DASHBOARD_PUBLISH = 'dashboard:publish',
  AI_USE = 'ai:use',
  // ...
}
```

**Check permissions in components:**

```tsx
// Hook
const { hasPermission } = usePermissions();
if (!hasPermission(Permission.PROJECT_EDIT, { projectId })) return null;

// Guard component
<PermissionGuard permission={Permission.PROJECT_EDIT} projectId={id}>
  <EditButton />
</PermissionGuard>

// Multiple permissions (ANY)
<PermissionGuard
  permission={[Permission.PROJECT_EDIT, Permission.PROJECT_DELETE]}
  requireAll={false}
>
  <ActionBar />
</PermissionGuard>
```

Never hard-code role names in components. Always use `Permission` enum + `PermissionGuard`.

---

## Component Patterns

### Component locations

| What                        | Where                            |
| --------------------------- | -------------------------------- |
| Shared UI primitives        | `src/components/ui/`             |
| Feature-specific components | `src/app/(dashboard)/<feature>/` |
| Layout shells               | `src/layouts/`                   |
| EE-only components          | `ee/src/components/`             |

### `'use client'` directive

- Pages and layouts in `(dashboard)/` are **client components** (they use hooks).
- Data-fetching-only leaf components can be server components.
- When unsure, default to `'use client'`.

### Heavy components — dynamic imports

Load heavy or EE components lazily:

```tsx
const HeavyChart = dynamic(() => import('@/components/ai/ChartRenderer'), {
  ssr: false,
  loading: () => <Skeleton />,
});
```

### React.memo

Memoize layout-level components that receive stable props:

```tsx
const DashboardLayout = React.memo(({ children }) => { ... });
DashboardLayout.displayName = 'DashboardLayout';
```

---

## TypeScript Conventions

- All types for a resource go in `src/types/<resource>.ts`.
- API response types are exported from `src/api/<resource>.ts` alongside the functions.
- Use `unknown` instead of `any` for external data; narrow before use.
- Prefer `interface` for objects, `type` for unions and primitives.
- `strict: true` is enabled — no implicit `any`.

---

## Adding New Features

### CE-only feature

1. Add API functions to `src/api/<resource>.ts`
2. Add React Query hooks to `src/hooks/use<Resource>.ts`
3. Add Zustand store to `src/stores/use<Resource>Store.ts` (if UI state needed)
4. Add page to `src/app/(dashboard)/<feature>/page.tsx`
5. Add types to `src/types/<resource>.ts`

### EE-only feature

Follow the same structure but place files under `ee/src/` instead of `src/ee/`. Add CE stubs under `src/ee/` that export the same interface with safe defaults (empty arrays, no-op functions, null).

### Double borders / nested boxes

Global card and panel rules live in `aiser-unified-design-system.css` and `aiser-aesthetic-enhancements.css`. Layout routes (chat, query editor, settings) are flattened in **`workspace-chrome.css`** (imported last in `globals.css`): one shell edge per workspace, leaf cards only.

If you add a new full-page workspace, extend `workspace-chrome.css` rather than adding another global `.panel` border.

### Docker dev: “Loading CSS chunk … failed”

In the EE `client` service, Next.js logs:

`Server is approaching the used memory threshold, restarting...`

When that happens, the browser may still request CSS chunks from the **previous** dev build → `Loading CSS chunk _app-pages-browser_…ChatPanel_tsx.css failed` on `/chat`.

**Fix:**

1. Hard-refresh the tab (or close and reopen `http://localhost:3000/chat`).
2. Tune dev memory in `deploy/.env`: `NEXT_DEV_TURBO=false`, `NODE_MAX_OLD_SPACE_SIZE=2048`, and optionally `CLIENT_DEV_MEM_LIMIT=3g`, then recreate the client. Keep the Node heap below Docker Desktop's available memory so V8 can collect before the container hits an OOM kill. On very small Docker Desktop memory limits, `NEXT_DEV_CPUS=2` can reduce peak memory, but it may slow first route compilation.
3. If the stack is wedged: `make -C deploy dev-ee-down && make -C deploy dev-ee`.

The ChatPanel stylesheet itself is fine (~100KB source); the failure is a stale/missing chunk during dev-server restart, not a CSS syntax error.

---

### `npm ci` fails with `EACCES` (permission denied)

Docker dev containers often create `node_modules`, `.next`, `next-env.d.ts`, and `src/ee` as `root` or `nobody`. Local `npm ci` / `postinstall` / `next build` then cannot write shims or install packages.

**Fix (from repo root):**

```bash
sudo ./scripts/fix-docker-permissions.sh
cd client && rm -rf node_modules .next && npm ci
```

If Docker still owns `.next` and you cannot `chown`, build into a local dist dir:

```bash
cd client
NEXT_DIST_DIR=.next-local NEXT_PUBLIC_EDITION=community npm run build
```

If `chown` fails on your filesystem, remove the blocked paths as root and reinstall:

```bash
sudo rm -rf client/node_modules client/.next
sudo chown -R "$USER:$USER" client/src/ee
cd client && npm ci
```

Use **Node 20.9+** (see `.nvmrc` or `nvm use 20`) — Next.js 16 requires it. System Node 18 on WSL will not match `engines`.

See also `NEXT16_REACT19_UPGRADE.md` for the Next 16 / React 19 upgrade notes.

---

### Checklist before committing

- [ ] No `any` — use proper types or `unknown`
- [ ] No direct `fetch()` calls — use `fetchApi`
- [ ] No permission logic in JSX — use `PermissionGuard` or `usePermissions`
- [ ] No auth checks inside pages — the layout handles it
- [ ] EE components loaded with `dynamic(..., { ssr: false })` in CE layouts
- [ ] New stores use `devtools` middleware
