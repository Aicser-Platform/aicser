# Next.js 16 + React 19 Upgrade

**Status:** Complete  
**Versions:** `next@16.2.12`, `react@^19` / `react-dom@^19`, Node `>=20.9` (`Dockerfile*` → `node:20.19-alpine`)  
**Shipped with:** ESLint 9 flat config, `src/proxy.ts`, webpack-pinned scripts (`--webpack`)

---

## What changed

| Area | Change |
| --- | --- |
| Pages | Server + `*PageClient.tsx` for `dynamic(..., { ssr: false })` |
| Params | Async `Promise` params / `useParams` on dynamic routes |
| Middleware | Consolidated → `src/proxy.ts` (`export function proxy`) |
| Config | Dropped `eslint.ignoreDuringBuilds` + `instrumentationHook`; `turbopack` top-level; `NEXT_DIST_DIR` optional |
| Ace | `react-ace@^14` for React 19 peers |
| Lint | React Compiler rules from Next 16 triaged to **warn**; classic `rules-of-hooks` stays **error** |
| Docker | Client images pinned to `node:20.19-alpine`; prod build uses `next build --webpack` |

---

## Verification

| Check | Result |
| --- | --- |
| CE `npm run build` | Pass |
| EE `npm run build` | Pass |
| `npm run test` | Pass |
| `npm run lint` | Pass — **0 errors** (warnings = existing debt + Compiler migration) |
| `npm run audit:prod` | 0 vulnerabilities |

If Docker owns `.next` / `next-env.d.ts`: `sudo ./scripts/fix-docker-permissions.sh`, or `NEXT_DIST_DIR=.next-local npm run build`.

---

## Follow-ups (optional later PRs)

- [ ] Drop `--webpack` once Turbopack fully replaces custom `webpack()` aliases
- [ ] Gradually fix React Compiler warnings (`set-state-in-effect`, `refs`, …) then restore them to `error`
- [ ] Reduce general ESLint warning debt (`no-console`, `no-explicit-any`, …)
- [ ] Zustand 5 (optional)

---

## Manual smoke before merge

- [ ] Auth login / refresh / invite (via `proxy.ts`)
- [ ] `/chat` EE dashboard preview + Studio deep links
- [ ] `/dashboards` Studio + Ace/Monaco SQL
- [ ] Embeds + PWA / Serwist
