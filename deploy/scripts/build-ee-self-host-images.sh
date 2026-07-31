#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

IMAGE_TAG="${IMAGE_TAG:-self-host}"
AISER_VERSION="${AISER_VERSION:-${IMAGE_TAG}}"
NEXT_PUBLIC_AISER_VERSION="${NEXT_PUBLIC_AISER_VERSION:-${AISER_VERSION}}"
REGISTRY="${REGISTRY:-}"
SERVER_REPOSITORY="${SERVER_REPOSITORY:-aiser-ee-server}"
CLIENT_REPOSITORY="${CLIENT_REPOSITORY:-aiser-ee-client}"
SERVER_IMAGE="${SERVER_IMAGE:-${REGISTRY:+${REGISTRY}/}${SERVER_REPOSITORY}}"
CLIENT_IMAGE="${CLIENT_IMAGE:-${REGISTRY:+${REGISTRY}/}${CLIENT_REPOSITORY}}"

NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"
NEXT_PUBLIC_SSO_PROVIDER="${NEXT_PUBLIC_SSO_PROVIDER:-}"
NEXT_PUBLIC_AUTH_PROVIDER="${NEXT_PUBLIC_AUTH_PROVIDER:-local}"
NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}"
NEXT_PUBLIC_AI_ENABLED="${NEXT_PUBLIC_AI_ENABLED:-true}"
NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS:-1}"
NEXT_BUILD_MAX_OLD_SPACE_SIZE="${NEXT_BUILD_MAX_OLD_SPACE_SIZE:-3072}"
PUSH="${PUSH:-0}"

if [[ ! -d "${ROOT_DIR}/server/ee" || ! -d "${ROOT_DIR}/client/ee" ]]; then
  echo "Enterprise submodules are missing. Run: git submodule update --init --recursive" >&2
  exit 1
fi

echo "Building Enterprise server image: ${SERVER_IMAGE}:${IMAGE_TAG}"
DOCKER_BUILDKIT=1 docker build \
  -f "${ROOT_DIR}/server/Dockerfile.prod" \
  --build-arg AISER_VERSION="${AISER_VERSION}" \
  -t "${SERVER_IMAGE}:${IMAGE_TAG}" \
  "${ROOT_DIR}/server"

echo "Building Enterprise client image: ${CLIENT_IMAGE}:${IMAGE_TAG}"
DOCKER_BUILDKIT=1 docker build \
  -f "${ROOT_DIR}/client/Dockerfile.prod" \
  --build-arg EDITION=enterprise \
  --build-arg NEXT_PUBLIC_EDITION=enterprise \
  --build-arg NEXT_PUBLIC_AISER_DEPLOYMENT_MODE=self_host \
  --build-arg AISER_VERSION="${AISER_VERSION}" \
  --build-arg NEXT_PUBLIC_AISER_VERSION="${NEXT_PUBLIC_AISER_VERSION}" \
  --build-arg NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL}" \
  --build-arg NEXT_PUBLIC_AUTH_PROVIDER="${NEXT_PUBLIC_AUTH_PROVIDER}" \
  --build-arg NEXT_PUBLIC_AI_ENABLED="${NEXT_PUBLIC_AI_ENABLED}" \
  --build-arg NEXT_PUBLIC_SSO_PROVIDER="${NEXT_PUBLIC_SSO_PROVIDER}" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL}" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}" \
  --build-arg NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS}" \
  --build-arg NEXT_BUILD_MAX_OLD_SPACE_SIZE="${NEXT_BUILD_MAX_OLD_SPACE_SIZE}" \
  -t "${CLIENT_IMAGE}:${IMAGE_TAG}" \
  "${ROOT_DIR}/client"

if [[ "${PUSH}" == "1" || "${PUSH}" == "true" ]]; then
  echo "Pushing ${SERVER_IMAGE}:${IMAGE_TAG}"
  docker push "${SERVER_IMAGE}:${IMAGE_TAG}"
  echo "Pushing ${CLIENT_IMAGE}:${IMAGE_TAG}"
  docker push "${CLIENT_IMAGE}:${IMAGE_TAG}"
fi

cat <<EOF

Built:
  ${SERVER_IMAGE}:${IMAGE_TAG}
  ${CLIENT_IMAGE}:${IMAGE_TAG}

Use these values on the VPS:
  AISER_SERVER_IMAGE=${SERVER_IMAGE}:${IMAGE_TAG}
  AISER_CLIENT_IMAGE=${CLIENT_IMAGE}:${IMAGE_TAG}

Run with:
  docker compose --env-file .env -f docker-compose.ee.self-host.yml up -d
EOF
