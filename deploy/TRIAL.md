# Enterprise trial on your own servers

30 days, up to 10 people, every feature. Your data and your AI keys stay with you.

## Install

You need a Linux server with Docker, 4 CPUs and 16 GB of memory.

1. Sign in to our registry with the command in your trial email.
2. Download the stack and create your settings file:

   ```bash
   cp .env.ee.self-host.example .env
   ```

3. In `.env`, set `AISER_EDITION_LICENSE_KEY` to the key from your email, and set `FRONTEND_URL`
   and `NEXT_PUBLIC_API_URL` to your server's addresses.
4. Add one AI key, such as `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. To keep AI on your own network,
   follow [AIR_GAPPED.md](AIR_GAPPED.md).
5. Start it:

   ```bash
   docker compose --env-file .env -f docker-compose.ee.self-host.yml up -d
   ```

Sign in, then use **Getting started** in the header for the next steps.

## No internet access

Ask us for an offline license file. Save it as `license/license.jwt` next to the compose file, set
`AISER_LICENSE_FILE=/app/license/license.jwt`, and leave `AISER_EDITION_LICENSE_KEY` empty. Nothing contacts us. An offline license can't be extended, so we
issue a new file when you need more time.

## When the trial ends

Aicser becomes read-only. Everyone can still sign in, read and export. Nothing is deleted, and adding
a new license restores everything.

## What we receive

While a trial runs, your server sends us four counts about once every 15 minutes: people, data
sources, dashboards and questions asked. We use them to offer help if you get stuck. No names, data
or questions are ever sent. Set `AISER_LICENSE_USAGE_SIGNAL=false` to turn this off. Paid licenses and
offline licenses send nothing.
