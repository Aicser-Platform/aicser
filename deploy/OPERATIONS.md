# Running Aicser in production

## What runs

| Part | Holds state | Notes |
| --- | --- | --- |
| Server (API) | No | Scale out freely. |
| Worker | No | Alerts, schedules, Agent tasks, sensor readers, pipelines. Jobs that must run once take a Redis lease, so extra replicas are safe. |
| Client (web) | No | Scale out freely. |
| PostgreSQL | **Yes** | Everything people create: users, connections, models, dashboards, alerts, audit log. |
| Lake and uploads (`/app/lake`, `/app/uploads`, or object storage) | **Yes** | Lakehouse tables, uploaded files, exports. |
| Redis | No | Cache and job queue. Losing it drops queued jobs; scheduled ones run again at their next time. |

Two secrets must be kept with the backups: `SECRET_KEY` (sign-in tokens) and `ENCRYPTION_KEY` (connection passwords and API keys are encrypted with it). **A database backup without `ENCRYPTION_KEY` cannot open any saved connection.**

## Kubernetes (Helm)

```bash
kubectl create secret generic aicser-server-secrets --from-env-file=server.env
helm upgrade --install aicser deploy/helm/aicser \
  --set server.image=REGISTRY/aicser-server:VERSION \
  --set client.image=REGISTRY/aicser-client:VERSION \
  --set persistence.enabled=true --set persistence.existingClaim=aicser-shared
```

- Migrations run as a Job before new pods start (`migrations.enabled`).
- Use managed PostgreSQL (16+, `pgvector` extension) and managed Redis; set `DATABASE_URL` and `REDIS_URL` in the secret.
- Lake and uploads need a ReadWriteMany volume (EFS, Azure Files, Filestore), or configure object storage in Settings › Lakehouse and leave `persistence` off.
- Pod disruption budgets keep one server and one client up during node drains.

## Backups

| What | How | Suggested frequency |
| --- | --- | --- |
| PostgreSQL | Managed service point-in-time recovery, or `pg_dump -Fc` | Continuous (PITR), or nightly dump |
| Lake and uploads | Object storage versioning, or volume snapshots | Daily |
| `SECRET_KEY`, `ENCRYPTION_KEY` | Your secrets manager | On change |

Restore drill (do it once before go-live, then quarterly):

1. Restore PostgreSQL into a new database; restore lake/uploads to the same paths or bucket.
2. Deploy the **same version** that took the backup, with the same `SECRET_KEY` and `ENCRYPTION_KEY`.
3. Sign in, open a dashboard, test one connection, and check Settings › Audit log shows recent entries.
4. Upgrade to the current version if needed (migrations run on start).

## Recovery targets

With managed PostgreSQL point-in-time recovery and versioned object storage, a realistic target is **data loss of minutes (RPO ≤ 15 min)** and **back in service within an hour (RTO ≤ 1 h)**: restore the database, point a fresh deployment at it. Without PITR, RPO is the time since the last dump.

For a standby region, replicate PostgreSQL (read replica promoted on failover) and the lake bucket (cross-region replication); keep the images in a registry both regions can pull.

## Upgrades

1. Back up PostgreSQL.
2. Read the release notes for anything marked *action needed*.
3. `helm upgrade` (or `make ee-serial` on Docker Compose). Migrations run first; pods roll one at a time.
4. Roll back by deploying the previous version **and** restoring the database if a migration changed data. Migrations are forward-only.

## Monitoring

- `GET /health` on the server and client for load balancers and uptime checks.
- `deploy/observability/` has an OpenTelemetry collector, Prometheus and Tempo configuration; set `OTEL_EXPORTER_OTLP_ENDPOINT` to send traces and metrics.
- Watch: worker running (the Alerts page warns when it is down), queue depth in Redis, PostgreSQL connections and disk, AI spend (Settings › Usage & billing).
