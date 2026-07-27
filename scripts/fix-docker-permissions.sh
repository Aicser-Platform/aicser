#!/usr/bin/env bash
# Reset ownership on paths commonly written by Docker dev containers (nobody/root)
# so local `npm ci`, `next build`, and Python tooling work as your user.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
TARGET_GROUP="$(id -gn "$TARGET_USER" 2>/dev/null || echo "$TARGET_USER")"

echo "Fixing permissions under $ROOT for $TARGET_USER:$TARGET_GROUP"

fix_path() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "  chown -R $TARGET_USER:$TARGET_GROUP $path"
    chown -R "$TARGET_USER:$TARGET_GROUP" "$path"
  fi
}

fix_path "$ROOT/client/node_modules"
fix_path "$ROOT/client/.next"
fix_path "$ROOT/client/.next-local"
fix_path "$ROOT/client/.next-ee-local"
fix_path "$ROOT/client/next-env.d.ts"
fix_path "$ROOT/client/tsconfig.json"
fix_path "$ROOT/client/src/ee"
fix_path "$ROOT/packages/embed/node_modules"

# Python bytecode caches created inside containers
while IFS= read -r -d '' cache_dir; do
  fix_path "$cache_dir"
done < <(find "$ROOT/server" -type d -name '__pycache__' -print0 2>/dev/null || true)

echo "Done. You can now run: cd client && npm ci"
