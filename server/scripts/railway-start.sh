#!/bin/sh
set -eu

PORT="${PORT:-8000}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_PRIVATE_URL:-}" ]; then
  export DATABASE_URL="$DATABASE_PRIVATE_URL"
elif [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_URL:-}" ]; then
  export DATABASE_URL="$POSTGRES_URL"
elif [ -z "${DATABASE_URL:-}" ] && [ -n "${PGHOST:-}" ] && [ -n "${PGUSER:-}" ] && [ -n "${PGPASSWORD:-}" ]; then
  PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-railway}}"
  PGPORT="${PGPORT:-5432}"
  export DATABASE_URL="postgresql+asyncpg://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Set it on the Railway server service, for example:"
  echo "  DATABASE_URL=\${{<postgres-service>.DATABASE_URL}}"
  echo "or provide Railway PGHOST/PGUSER/PGPASSWORD/PGDATABASE variables."
  exit 1
fi

if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "Running database migrations..."
  python -m alembic -c alembic.ini upgrade heads
fi

echo "Starting Aicser server on port ${PORT}..."
exec uvicorn src.main:app --host 0.0.0.0 --port "$PORT"
