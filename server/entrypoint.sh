#!/bin/bash

# Credential encryption is required in every environment (no plaintext
# fallback - see src/modules/data/utils/credentials.py). Local/dev
# environments without an explicit ENCRYPTION_KEY get one generated once
# and persisted to the bind-mounted server directory so it survives
# container restarts. Anything else must set ENCRYPTION_KEY explicitly.
DEV_ENV_NAMES="development|dev|test|testing|local|"
if [ -z "$ENCRYPTION_KEY" ] && [[ "$(echo "${ENVIRONMENT:-development}" | tr '[:upper:]' '[:lower:]')" =~ ^($DEV_ENV_NAMES)$ ]]; then
  KEY_FILE="/app/.dev_encryption_key"
  if [ ! -s "$KEY_FILE" ]; then
    /venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "Generated a dev-only ENCRYPTION_KEY at $KEY_FILE - do NOT commit this file or reuse it outside local dev."
  fi
  export ENCRYPTION_KEY="$(cat "$KEY_FILE")"
fi

until nc -z postgres 5432; do
  echo "Waiting for PostgreSQL..."
  sleep 1
done
echo "PostgreSQL is up - running chat2chart-server migrations"
cd /app && /venv/bin/python -m alembic -c alembic.ini upgrade heads
echo "chat2chart-server migrations complete - starting server"

# Source environment variables from .env file explicitly
if [ -f .env ]; then
  export $(cat .env | xargs)
fi

# Print environment variables for debugging purposes (optional)
# env

exec "$@"
