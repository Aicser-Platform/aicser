# @aicser/embed

Embed Aicser dashboards, charts, executive reports and the AI assistant in your app or website. The package includes:
- an iframe SDK with session renewal and host commands;
- a React wrapper;
- a server-side helper that signs per-customer links.

```bash
npm install @aicser/embed
```

## Two ways to embed

| | Public link | Signed link (per customer) |
| --- | --- | --- |
| **For** | A public website, an intranet page, a blog | A SaaS app showing each customer their own data |
| **Made in** | Settings → Embed | Your server, per page view (`@aicser/embed/server`, `aicser-embed` for Python, or `POST /api/embed/sign`) |
| **Who can open it** | Anyone with the link, until it expires or is revoked | One page view: the link opens once and becomes a session |
| **Rows shown** | Everything the dashboard shows | Only the rows the link's locked filters allow, enforced by Aicser on every query |

Both kinds of link support:
- **Allowed sites:** browsers refuse to show the embed on any other site (`frame-ancestors`), and the embed checks the site showing it when it opens.
- **Download setting:** visitors can save nothing (the default), a picture or PDF, or each chart's data as CSV.

Every anonymous view is capped at 2,000 rows per chart (`EMBED_MAX_ROWS` on the server).

## Signed embed (recommended for SaaS)

On your server:

```ts
import { signEmbedUrl } from '@aicser/embed/server';

app.get('/analytics-token', async (req, res) => {
  const { token } = await signEmbedUrl({
    baseUrl: 'https://api.aicser.com',
    apiKey: process.env.AICSER_API_KEY!,        // never ship this to the browser
    dashboardId: 'b4b3…',
    lockedFilters: [{ field: 'tenant_id', value: req.user.tenantId }],
    expiresInMinutes: 60,
    allowedDomains: ['app.example.com'],
  });
  res.json({ token });
});
```

For a chart or report, pass `scope` and `resourceId` instead of `dashboardId`
(`resourceId` for reports is `conversationId:messageId`).

In the browser:

```ts
import { embedDashboard } from '@aicser/embed';

const dashboard = embedDashboard(document.getElementById('analytics')!, 'b4b3…', {
  baseUrl: 'https://app.aicser.com',
  // Called for the first token, before the session runs out, and after a reload.
  getToken: () => fetch('/analytics-token').then((r) => r.json()).then((d) => d.token),
  filters: [{ field: 'region', operator: 'equals', value: 'EU' }],
  onFilterChange: (filters) => console.log('viewer filtered', filters),
});

await dashboard.setFilters([{ field: 'region', operator: 'equals', value: 'APAC' }]);
await dashboard.refresh();
```

## React

```tsx
import { useRef } from 'react';
import { AicserDashboard } from '@aicser/embed/react';
import type { EmbedHandle } from '@aicser/embed';

export function Analytics({ region }: { region: string }) {
  const ref = useRef<EmbedHandle>(null);
  return (
    <>
      <button onClick={() => ref.current?.exportImage('pdf')}>Download PDF</button>
      <AicserDashboard
        ref={ref}
        baseUrl="https://app.aicser.com"
        dashboardId="b4b3…"
        getToken={() => fetch('/analytics-token').then((r) => r.json()).then((d) => d.token)}
        filters={[{ field: 'region', operator: 'equals', value: region }]}  // controlled: updates without a reload
      />
    </>
  );
}
```

`AicserChart` (`chartId`), `AicserChat` (the AI assistant, Enterprise Edition) and `AicserReport` (`reportId` = `conversationId:messageId`, Enterprise Edition) take the same props.

## Public link

```ts
embedDashboard(el, 'b4b3…', { baseUrl: 'https://app.aicser.com', token: 'PUBLIC_LINK_TOKEN' });
```

Or paste the iframe snippet from Settings → Embed.

## API

`embedDashboard(container, dashboardId, options)`, `embedChart(container, chartId, options)`, `embedChat(container, options)` and `embedReport(container, reportId, options)` each return a handle.

### Options

| Option | Description |
| --- | --- |
| `baseUrl` | Aicser app origin (required) |
| `token` | A public link token or a signed token |
| `getToken` | `() => Promise<string>`: fetch a fresh signed token from your server; enables silent renewal |
| `filters`, `pageId` | Initial filters and page |
| `autoResize` | Grow the iframe to its content (default `true`) |
| `onReady`, `onResize`, `onFilterChange`, `onError` | Events from the embed |
| `onTokenExpired` | The session ran out and couldn't be renewed |
| `className`, `style`, `targetOrigin`, `observability` | iframe styling, postMessage origin, optional Sentry |

### Handle

| Method | Description |
| --- | --- |
| `setFilters(filters)` | Replace the viewer's filters. Locked filters still apply on the server. |
| `refresh()` | Re-run every chart |
| `setPage(pageId)` | Show another page |
| `exportImage('png' \| 'pdf')` | Download what's on screen; only works when the link's download setting allows it |
| `setToken(token)` | Hand over a token yourself instead of using `getToken` |
| `on(type, handler)` | Listen to any embed message; returns an unsubscribe function |
| `destroy()` | Remove the iframe and its listeners |

Commands return promises: each one resolves when the embed confirms it, or rejects with `EmbedCommandError`.

## postMessage protocol

**Embed → host:**

```json
{ "source": "aicser-embed", "type": "…", "payload": {} }
```

The types are `ready`, `resize`, `navigate` (`{ filters }`), `error`, `token-expiring`, `token-expired`, `token-updated` and `command-result`.

**Host → embed:** messages are sent only from the page framing the embed, and only from an allowed site:

```json
{ "source": "aicser-host", "type": "…", "payload": {} }
```

The types are `set-token`, `set-filters`, `refresh`, `set-page` and `export`.
