#!/bin/bash

until nc -z postgres 5432; do
  echo "Waiting for PostgreSQL..."
  sleep 1
done
echo "PostgreSQL is up - running chat2chart-server migrations"
cd /app && /venv/bin/python -m alembic -c alembic.ini upgrade head
echo "chat2chart-server migrations complete - starting server"

# Source environment variables from .env file explicitly
if [ -f .env ]; then
  export $(cat .env | xargs)
fi

# Print environment variables for debugging purposes (optional)
# env

# Start Uvicorn server
/venv/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
