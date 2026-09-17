#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_PRIVATE_URL:-}" ]; then
  export DATABASE_URL="$DATABASE_PRIVATE_URL"
elif [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_URL:-}" ]; then
  export DATABASE_URL="$POSTGRES_URL"
elif [ -z "${DATABASE_URL:-}" ] && [ -n "${PGHOST:-}" ] && [ -n "${PGUSER:-}" ] && [ -n "${PGPASSWORD:-}" ]; then
  PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-railway}}"
  PGPORT="${PGPORT:-5432}"
  export DATABASE_URL="postgresql+asyncpg://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
fi

if [ -z "${REDIS_URL:-}" ] && [ -n "${REDIS_PRIVATE_URL:-}" ]; then
  export REDIS_URL="$REDIS_PRIVATE_URL"
elif [ -z "${REDIS_URL:-}" ] && [ -n "${REDISHOST:-}" ] && [ -n "${REDISPORT:-}" ]; then
  if [ -n "${REDISPASSWORD:-}" ]; then
    export REDIS_URL="redis://:${REDISPASSWORD}@${REDISHOST}:${REDISPORT}/0"
  else
    export REDIS_URL="redis://${REDISHOST}:${REDISPORT}/0"
  fi
fi

if [ -z "${REDIS_URL:-}" ]; then
  echo "ERROR: REDIS_URL is not set for the ARQ worker."
  echo "Set REDIS_URL on the Railway worker service, e.g. \${{Redis.REDIS_URL}} or REDIS_PRIVATE_URL."
  exit 1
fi

echo "Starting Aicser ARQ background worker..."
exec python -m arq src.shared.jobs.worker.WorkerSettings
