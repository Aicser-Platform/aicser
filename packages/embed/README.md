# @aicser/embed

Lightweight JavaScript helpers for embedding Aicser dashboards, charts, and chat in third-party apps (Teams, SharePoint, intranet pages).

## Install

```bash
npm install @aicser/embed
```

## Create an embed token

1. Open **Settings → Embed** in Aicser.
2. Create a token with the scopes you need (`dashboard`, `chart`, `chat`).
3. Copy the JWT or iframe snippet.

Alternatively, call `POST /api/embed/tokens` from your backend using a user session.

## Vanilla usage

```html
<div id="dashboard"></div>
<script type="module">
  import { embedDashboard } from '@aicser/embed';

  embedDashboard(document.getElementById('dashboard'), 'YOUR_DASHBOARD_ID', {
    baseUrl: 'https://app.aicser.com',
    token: 'YOUR_EMBED_JWT',
    onReady: () => console.log('embed ready'),
    onResize: (height) => console.log('resize', height),
    onError: (message) => console.error(message),
  });
</script>
```

## API

### `embedDashboard(container, dashboardId, options)`

Embeds a read-only dashboard at `/embed/dashboard/{id}?token=...`.

### `embedChart(container, slug, options)`

Embeds a chart at `/embed/chart/{slug}?token=...`.

### `embedChat(container, options)`

Embeds the minimal chat UI at `/embed/chat?token=...` (requires Enterprise Edition).

### Options

| Option | Description |
| --- | --- |
| `baseUrl` | Aicser app origin (required) |
| `token` | Signed JWT from Settings → Embed (required) |
| `className` | Optional iframe CSS class |
| `style` | Optional iframe inline styles |
| `targetOrigin` | postMessage origin filter (defaults to `baseUrl`) |
| `onReady` | Fired when embed sends `ready` |
| `onResize` | Fired when embed requests height change |
| `onError` | Fired on embed errors |

### Return value

Each function returns `{ iframe, destroy }`. Call `destroy()` to remove listeners and the iframe.

## postMessage protocol

Child embed pages emit messages shaped as:

```json
{ "source": "aicser-embed", "type": "ready", "payload": {} }
```

Supported types: `ready`, `resize`, `navigate`, `error`, `ping`.

## SSO and server-side token minting (v0.2)

For intranet and Teams integrations, mint embed JWTs from your backend after SSO:

1. Authenticate the user (OIDC/SAML/session cookie).
2. Call `POST /api/embed/tokens` with scopes and optional `allowed_domains`.
3. Pass the JWT to `@aicser/embed` or an iframe `?token=` URL.

Set `EMBED_JWT_ONLY=true` on the server to reject legacy DB embed tokens.

## Teams sample

See [`samples/teams-tab/`](../../samples/teams-tab/) for a Microsoft Teams static tab manifest and setup steps.

## Security notes

- Tokens are signed with `JWT_SECRET_KEY` and can be revoked from Settings → Embed.
- Optionally restrict hostnames via **Allowed domains** when creating a token.
- Never expose long-lived tokens in public client-side code; prefer server-side token minting for production integrations.
