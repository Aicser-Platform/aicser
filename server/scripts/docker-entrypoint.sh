#!/bin/sh
# Start as root only long enough to make mounted volumes (uploads, model cache) writable by the
# app user — volumes created by older, root-run images hold root-owned files — then run the app
# as the unprivileged `aiser` user.
set -eu

if [ "$(id -u)" = "0" ]; then
  for dir in /app/uploads "${HF_HOME:-/app/.cache/huggingface}"; do
    mkdir -p "$dir"
    if [ "$(stat -c %u "$dir")" != "1001" ] || [ -n "$(find "$dir" -mindepth 1 ! -user 1001 -print -quit 2>/dev/null)" ]; then
      chown -R aiser:aiser "$dir"
    fi
  done
  exec gosu aiser "$@"
fi

exec "$@"
