#!/usr/bin/env bash
#
# ce-fresh.sh — run the CE stack exactly as a fresh PUBLIC clone would.
#
# Why this exists:
#   `make ce` builds the server image with `COPY . .`, so on a machine that has
#   the private `server/ee/` submodule checked out, EE code gets baked into the
#   CE image. That masks any CE code path that still imports EE unguarded — the
#   very failures new users hit at migration/startup.
#
#   This script excludes `server/ee/` from the CE build (only for this build),
#   wipes the CE volumes so migrations run from scratch, then builds + starts CE
#   and tails the server logs. Your submodule and the shared .dockerignore are
#   restored automatically on exit (including Ctrl-C).
#
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$(cd "$DEPLOY_DIR/../server" && pwd)"
DOCKERIGNORE="$SERVER_DIR/.dockerignore"
BACKUP="$DOCKERIGNORE.ce-fresh.bak"
CE="docker compose --project-directory $DEPLOY_DIR -f $DEPLOY_DIR/docker-compose.ce.yml"

restore() {
  if [ -f "$BACKUP" ]; then
    mv -f "$BACKUP" "$DOCKERIGNORE"
    echo "✅ restored server/.dockerignore (EE build unaffected)"
  fi
}
trap restore EXIT INT TERM

echo "📦 excluding server/ee from the CE build (simulating a fresh clone)…"
cp "$DOCKERIGNORE" "$BACKUP"
printf '\n# --- ce-fresh: exclude private EE submodule to mimic a public clone ---\nee/\n' >> "$DOCKERIGNORE"

echo "🧹 wiping CE volumes so migrations run from scratch…"
$CE down -v --remove-orphans || true

echo "🔨 building + starting CE with NO EE code baked in…"
$CE up -d --build

echo "📜 following server logs — watch for 'Running migrations…' then a clean boot."
echo "   (Ctrl-C stops the log tail; the stack keeps running. server/ee is restored now.)"
$CE logs -f server
