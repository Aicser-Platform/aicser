# Trino for the Aicser warehouse (optional)

Trino is the distributed engine for Gold tables that are too large for one machine. It reads the same Iceberg catalog the lakehouse pipeline writes, so no data is copied.

1. Start the coordinator: `docker compose -f docker-compose.ee.yml --profile trino up -d trino`.
2. Point Aicser at it by setting `TRINO_URL=http://trino:8080` in `.env.ee`, then restart the server.
3. In **Warehouse**, create or edit a warehouse and choose **Distributed (Trino)**.

**To scale out**, run more Trino workers against the coordinator:
- give each worker `coordinator=false`;
- set `discovery.uri=http://trino:8080`;
- use the same `entrypoint.sh` (it writes the catalog from the environment).

In Kubernetes, the official Trino Helm chart does this and supports autoscaling workers.

**Namespaces.** Trino's JDBC catalog reads single-level namespaces only (`org_<hex>_gold`). See `server/ee/modules/warehouse/CONTRACT.md`.

**Licence.** Trino is Apache-2.0, and the PostgreSQL JDBC driver it uses is BSD-2-Clause.
