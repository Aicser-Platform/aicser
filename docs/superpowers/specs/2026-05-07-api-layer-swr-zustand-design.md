# API Layer Restructure — SWR + Zustand Separation

**Date:** 2026-05-07  
**Status:** Approved — ready for implementation  
**Scope:** Full migration of all existing stores and services to a clean three-layer architecture

---

## Problem

The current codebase mixes server data fetching, cache management, and UI state inside Zustand stores. This causes:

- Stores that are 400–640 lines long (`useSettingsStore`, `useProjectStore`)
- `loading` and `error` fields duplicated across every store
- No automatic revalidation, deduplication, or background refresh
- Unclear boundary between "data from the server" and "UI preferences in the browser"
- `services/` folder contains HTTP calls, data transforms, and business logic in the same files
- Two competing patterns co-existing: React Query hooks (`useAuthenticatedQuery`) and direct `fetchApi` calls inside stores

---

## Goal

Establish a strict three-layer architecture where every file has exactly one responsibility:

1. **`src/api/`** — raw HTTP calls, nothing else
2. **`src/hooks/`** — SWR data hooks + mutation helpers
3. **`src/stores/`** — Zustand for pure UI/client state only, no async

---

## Layer Architecture

```
Component
   │  reads server data via
   ▼
SWR Hook  (src/hooks/use*.ts)
   │  calls on cache-miss or revalidation
   ▼
API Function  (src/api/*.ts)
   │  calls
   ▼
fetchApi  (src/utils/api.ts)   ← unchanged: handles auth, error parsing, proxy routing
   │
   ▼
Backend (FastAPI)

─────────────────────────────────────

Component
   │  triggers write via
   ▼
Mutation function  (plain async, returned from SWR hook file)
   │  calls fetchApi directly, then
   ├─► mutate()      ← invalidates relevant SWR cache keys
   └─► Zustand set   ← updates UI state only (selectedId, modal open, etc.)

─────────────────────────────────────

Zustand Store  (src/stores/use*.ts)
   └─► UI state only: selected IDs, modal flags, edit mode, local preferences
   └─► NO async functions, NO fetchApi calls, NO loading/error for remote data
```

**Core rule:** If the data lives on the server, SWR owns it. If the state only exists in the browser session, Zustand owns it.

---

## File Structure

```
src/
├── api/                          ← replaces src/services/ — pure HTTP functions
│   ├── dataSources.ts
│   ├── dashboards.ts
│   ├── organizations.ts
│   ├── projects.ts
│   ├── users.ts
│   ├── charts.ts
│   ├── alerts.ts
│   ├── auth.ts
│   └── settings.ts
│
├── hooks/                        ← SWR hooks + mutation helpers (new files added)
│   ├── useDataSources.ts
│   ├── useDashboards.ts
│   ├── useOrganizations.ts
│   ├── useProjects.ts
│   ├── useCharts.ts
│   ├── useAlerts.ts
│   ├── useProfile.ts
│   ├── useSettings.ts
│   └── (non-SWR hooks stay unchanged: useBreakpoint, useClickOutside, etc.)
│
├── stores/                       ← Zustand, UI state only, no async
│   ├── useAuthStore.ts           ← keep (session/user identity is client state)
│   ├── useUIStore.ts             ← new: merges useHeaderStore + useLoadingStore
│   ├── useDataSourceStore.ts     ← shrinks: selectedId + filterType only
│   ├── useDashboardStore.ts      ← shrinks: activeWidgetId + editMode only
│   └── useConversationStore.ts   ← keep (chat is local session state)
│
├── services/                     ← DELETED — content moved to api/ and hooks/
│
└── utils/
    └── api.ts                    ← unchanged (fetchApi, ApiError, handlePlanLimitError)
```

### Naming Conventions

| Layer | Convention | Example |
|---|---|---|
| `src/api/` | Named exports, verb-noun | `listDataSources()`, `getDataSource(id)`, `createDataSource(data)`, `deleteDataSource(id)` |
| `src/hooks/` SWR reads | `use` + plural noun | `useDataSources()`, `useDataSource(id)` |
| `src/hooks/` mutations | `use` + verb + noun | `useCreateDataSource()`, `useDeleteDataSource()` |
| SWR cache keys | String arrays | `['data-sources']`, `['data-sources', id]`, `['orgs', orgId, 'projects']` |
| Zustand stores | UI noun + `Store` | `useDataSourceStore`, `useUIStore` |

---

## Code Patterns

### API Layer — `src/api/dataSources.ts`

Pure HTTP functions. No state, no side effects, no transforms beyond what the API returns.

```ts
import { fetchApi } from '@/utils/api';
import { DataSource } from '@/types/dataSource';

export const listDataSources = (projectId?: string): Promise<DataSource[]> =>
  fetchApi(`/data-sources${projectId ? `?project_id=${projectId}` : ''}`);

export const getDataSource = (id: string): Promise<DataSource> =>
  fetchApi(`/data-sources/${id}`);

export const createDataSource = (data: Partial<DataSource>): Promise<DataSource> =>
  fetchApi('/data-sources', { method: 'POST', body: JSON.stringify(data) });

export const updateDataSource = (id: string, data: Partial<DataSource>): Promise<DataSource> =>
  fetchApi(`/data-sources/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteDataSource = (id: string): Promise<void> =>
  fetchApi(`/data-sources/${id}`, { method: 'DELETE' });
```

### SWR Hook Layer — `src/hooks/useDataSources.ts`

SWR hooks for reads. Mutation helpers call the API function then invalidate the SWR cache.

```ts
import useSWR, { mutate } from 'swr';
import * as api from '@/api/dataSources';
import type { DataSource } from '@/types/dataSource';

// ── Reads ─────────────────────────────────────────────────────────────────

export const useDataSources = (projectId?: string) => {
  const key = ['data-sources', projectId ?? null];
  const { data, error, isLoading } = useSWR(key, () => api.listDataSources(projectId));
  return { dataSources: data ?? [], error, isLoading };
};

export const useDataSource = (id: string | null) => {
  const { data, error, isLoading } = useSWR(id ? ['data-sources', id] : null, () => api.getDataSource(id!));
  return { dataSource: data ?? null, error, isLoading };
};

// ── Mutations ─────────────────────────────────────────────────────────────

const revalidateAll = () =>
  mutate((key) => Array.isArray(key) && key[0] === 'data-sources', undefined, { revalidate: true });

export const useCreateDataSource = () => {
  const create = async (data: Partial<DataSource>) => {
    const result = await api.createDataSource(data);
    await revalidateAll();
    return result;
  };
  return { create };
};

export const useUpdateDataSource = () => {
  const update = async (id: string, data: Partial<DataSource>) => {
    const result = await api.updateDataSource(id, data);
    await revalidateAll();
    return result;
  };
  return { update };
};

export const useDeleteDataSource = () => {
  const remove = async (id: string) => {
    await api.deleteDataSource(id);
    await revalidateAll();
  };
  return { remove };
};
```

### Zustand Store — `src/stores/useDataSourceStore.ts`

UI state only. No async, no API calls, no loading or error fields.

```ts
import { create } from 'zustand';

interface DataSourceUIState {
  selectedId: string | null;
  filterType: string | null;
  select: (id: string | null) => void;
  setFilter: (type: string | null) => void;
}

export const useDataSourceStore = create<DataSourceUIState>()((set) => ({
  selectedId: null,
  filterType: null,
  select: (id) => set({ selectedId: id }),
  setFilter: (type) => set({ filterType: type }),
}));
```

### Usage in a Component

```tsx
const { dataSources, isLoading } = useDataSources(currentProjectId);
const { create } = useCreateDataSource();
const { selectedId, select } = useDataSourceStore();
```

---

## Migration Plan — All Existing Stores

### `useDataSourceStore` (255 lines → ~20 lines)

| Current content | Destination |
|---|---|
| `loadDataSources()`, `createDataSource()`, `deleteDataSource()`, `updateDataSource()` | `src/api/dataSources.ts` + `src/hooks/useDataSources.ts` |
| `dataSources[]`, `loading`, `error` | deleted — SWR owns this |
| `selectedId`, `currentDataSourceId` | stays in store |
| `persist` middleware | remove — SWR cache handles freshness |

### `useDashboardStore` (262 lines → ~30 lines)

| Current content | Destination |
|---|---|
| `loadDashboards()`, `createDashboard()`, `updateDashboard()`, `deleteDashboard()` | `src/api/dashboards.ts` + `src/hooks/useDashboards.ts` |
| `dashboards[]`, `loading`, `error` | deleted — SWR owns this |
| `activeWidgetId`, `editMode`, `selectedWidgetIds` | stays in store |

### `useOrganizationStore` (164 lines → ~20 lines)

| Current content | Destination |
|---|---|
| `loadOrganizations()`, `createOrganization()`, `updateOrganization()`, `deleteOrganization()` | `src/api/organizations.ts` + `src/hooks/useOrganizations.ts` |
| `organizations[]`, `loading`, `error` | deleted — SWR owns this |
| `currentOrganizationId` | stays in store with `persist` |

### `useProjectStore` (462 lines → ~20 lines)

| Current content | Destination |
|---|---|
| All async actions: `loadProjects()`, `createProject()`, `deleteProject()`, `listProjectMembers()`, `inviteUserToProject()`, etc. | `src/api/projects.ts` + `src/hooks/useProjects.ts` |
| `projects[]`, `members[]`, `loading`, `error` | deleted — SWR owns this |
| `currentProjectId` | stays in store with `persist` |

### `useProfileStore` (194 lines → deleted)

| Current content | Destination |
|---|---|
| `getProfile()`, `updateProfile()`, `updatePassword()` | `src/api/users.ts` + `src/hooks/useProfile.ts` |
| `profile`, `loading`, `error` | deleted — SWR owns this |
| No UI-only state remains | delete store entirely |

### `useSettingsStore` (643 lines → ~30 lines)

| Current content | Destination |
|---|---|
| All API-backed settings fetch/save actions | `src/api/settings.ts` + `src/hooks/useSettings.ts` |
| Remote settings data | deleted — SWR owns this |
| `localTheme`, `sidebarCollapsed`, `language` | stays in store with `persist` |

### `useRoleStore` (92 lines → deleted)

| Current content | Destination |
|---|---|
| `listRoles()`, `fetchProjectRoles()` | `src/api/projects.ts` + `                                                                                                                   
● I'm src/hooks/useProjectRoles.ts` |
| `roles[]`, `projectRoles[]`, `loading` | deleted — SWR owns this |
| No UI-only state remains | delete store entirely |

### `useHeaderStore` + `useLoadingStore` → merged into `useUIStore`

```ts
// src/stores/useUIStore.ts
interface UIState {
  sidebarOpen: boolean;
  globalLoading: boolean;  // for full-page spinners only
  activeModal: string | null;
  setSidebarOpen: (open: boolean) => void;
  setGlobalLoading: (loading: boolean) => void;
  openModal: (name: string) => void;
  closeModal: () => void;
}
```

### `useAuthStore` — keep as-is

Session/user identity is genuinely client state. No changes needed.

### `useConversationStore` — keep as-is

Chat conversation state is local session state. No changes needed.

---

## Services Deletion Plan

| File | Action |
|---|---|
| `services/apiService.ts` (500 lines) | Audit each function → HTTP calls move to `src/api/` files, business logic moves to relevant hooks |
| `services/enhancedDataService.ts` (723 lines) | HTTP calls → `src/api/dataSources.ts`, data transform utils → `src/utils/` if reusable |
| `services/socialFeedService.ts` (483 lines) | HTTP calls → `src/api/feed.ts` |
| `services/assetService.ts` (163 lines) | HTTP calls → `src/api/assets.ts` |
| `services/chartDataService.ts` (86 lines) | HTTP calls → `src/api/charts.ts` |
| `services/redisService.ts` (224 lines) | Server-side only — move to `src/app/api/lib/` if used in route handlers only |

---

## Hooks Cleanup

| File | Action |
|---|---|
| `hooks/useAuthenticatedQuery.ts` | Delete after migration — replaced by SWR hooks |
| `hooks/useAuthenticatedMutation.ts` | Delete after migration — replaced by mutation helpers in hook files |
| `hooks/useAuthenticatedFetch.ts` | Keep if used in route handlers; otherwise delete |
| All other hooks | Keep unchanged |

---

## SWR Global Configuration

Add a SWR provider to `src/app/layout.tsx` (or existing Providers component):

```tsx
import { SWRConfig } from 'swr';

<SWRConfig value={{
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5000,
  onError: (error) => {
    if (error?.status === 401) {
      window.location.href = '/login';
    }
  },
}}>
  {children}
</SWRConfig>
```

---

## Migration Rules Summary

1. **Remove `loading` and `error` from all Zustand stores** — SWR owns remote data state
2. **Remove `persist` from any store that held server data** — SWR cache handles freshness; only persist true client preferences (`currentOrgId`, `currentProjectId`, `localTheme`)
3. **No `fetchApi` calls inside stores** — stores are synchronous state containers only
4. **One `src/api/` file per domain** — no cross-domain imports between api files
5. **SWR key format: string arrays** — `['resource', id, 'sub-resource']` for predictable cache invalidation
6. **Mutation = call API fn + call `mutate()`** — never manually update SWR cache, always revalidate
7. **`devtools` middleware on stores** — keep for debugging, remove `persist` unless explicitly needed

---

## What Does NOT Change

- `src/utils/api.ts` — `fetchApi`, `ApiError`, `handlePlanLimitError` are unchanged
- `src/app/api/` route handlers — Next.js proxy routes are unaffected
- `src/auth/` — auth client and CE bearer token logic unchanged
- EE/CE stub pattern in `src/ee/` — unaffected
