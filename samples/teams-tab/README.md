# Microsoft Teams tab sample — Aicser embed chat

This folder contains a minimal Teams app manifest for embedding **Aicser Chat** in a Teams tab.

## Prerequisites

- Aicser **Enterprise Edition** deployment (HTTPS)
- Signed JWT embed token with `chat` scope from **Settings → Embed** or `POST /api/embed/tokens`
- Domain allowlist on the token matching your Teams host and Aicser frontend URL

## Setup

1. Replace `YOUR_AICSER_HOST` in `manifest.json` with your deployment host (no protocol), e.g. `app.example.com`.
2. Create an embed token with scope `chat` and optional `allowed_domains` including your Aicser host.
3. Replace `YOUR_JWT_EMBED_TOKEN` in `contentUrl` **or** (recommended) use a small Teams config page that reads a token from your SSO backend and redirects to `/embed/chat?token=…`.
4. Add 192×192 `color.png` and 32×32 `outline.png` icons (not included).
5. Zip the manifest + icons and upload in [Teams Developer Portal](https://dev.teams.microsoft.com/).

## postMessage contract

The embedded chat page emits:

```json
{ "source": "aicser-embed", "type": "ready" }
{ "source": "aicser-embed", "type": "resize", "payload": { "height": 800 } }
```

Listen from a Teams content page host if you wrap the iframe yourself.

## Bot alternative

For proactive notifications, use the EE Teams bot webhook at `/api/teams/messages` (see `server/ee/modules/teams/`).
