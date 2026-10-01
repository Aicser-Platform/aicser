# Changelog

## 0.3.1 — 2026-09-29

### Added
- `embedReport` / `AicserReport` for executive report embeds (`conversationId:messageId`).
- `signEmbedUrl` accepts `scope` (`dashboard` | `chart` | `report`) and `resourceId` (keeps `dashboardId` for dashboards).

## 0.3.0 — 2026-09-26

### Added
- `getToken` option: sessions renew silently before they run out and after a reload (signed links open once).
- Host commands on the handle: `setFilters`, `refresh`, `setPage`, `exportImage` and `setToken`, plus `on(type, handler)`. Commands return promises confirmed by the embed.
- `@aicser/embed/react`: `AicserDashboard`, `AicserChart` and `AicserChat`, with controlled `filters` and `pageId` and a `ref` to the handle.
- `@aicser/embed/server`: `signEmbedUrl()` mints a signed, single-use link with locked filters, allowed sites and a download setting.
- New events: `token-expiring`, `token-expired`, `token-updated` and `command-result`.

### Changed
- The iframe sends a `strict-origin-when-cross-origin` referrer, so the embed can check which site is showing it.
- `token` is optional when `getToken` is given.
- Package metadata: repository and homepage now point at github.com/Aicser-Platform/aicser; `sideEffects: false` for tree-shaking; requires Node 18+ (the server helper uses the built-in `fetch`).

## 0.2.0 — 2026-05-23

### Added
- JWT-only embed authentication (`EMBED_JWT_ONLY`) with domain allowlist validation
- SSO-ready token helpers and postMessage utilities for dashboard, chart, and chat embeds
- Teams tab sample manifest under `samples/teams-tab/`

### Changed
- README documents JWT issuance, allowed domains, and iframe integration patterns
- Package exports typed helpers from `dist/index.js`

## 0.1.0

- Initial `@aicser/embed` release with iframe URL builders and postMessage bridge
