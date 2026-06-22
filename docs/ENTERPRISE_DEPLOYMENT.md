# Enterprise Deployment Guide

Aicser Enterprise Edition supports **dual-track deployment** from the same codebase: self-hosted (air-gap / VPC) and managed SaaS.

## Self-hosted EE (air-gap mode)

Use when data must never leave the customer VPC or when outbound network access is restricted.

### Quick start

```bash
cp .env.example deploy/.env
# Required
# AISER_EDITION=enterprise
# AISER_EDITION_LICENSE_KEY=...
# DATABASE_URL=postgresql+asyncpg://...
# JWT_SECRET_KEY=...
# OPENAI_API_KEY=...  # or customer LLM endpoint via LiteLLM

cd deploy
docker compose -f docker-compose.ee.yml up -d
```

### Air-gap checklist

| Control | Configuration |
|--------|----------------|
| Data residency | All Postgres, Redis, and app containers in customer VPC |
| LLM routing | Set `OPENAI_API_BASE` / `AISER_STRONG_MODEL` / `AISER_FAST_MODEL` to customer-hosted models |
| No outbound data | Disable external telemetry; use internal SMTP for alerts/schedules |
| Credentials | Fernet-encrypted in DB (`JWT_SECRET_KEY` / encryption key rotation per org policy) |
| RBAC | Supabase or JWT auth; org/project roles via EE RBAC |
| Audit | `GET /ai/audit/export/{conversation_id}` — SQL, plans, actions, trace IDs |

### Model tiering (cost control)

```bash
AISER_FAST_MODEL=gpt-4o-mini    # supervisor, planner, action_executor
AISER_STRONG_MODEL=gpt-4o       # NL2SQL, insight_engine, RAG
```

## Managed SaaS EE

Use when time-to-value and managed upgrades matter.

### Tenant isolation

- Every row carries `tenant_id` / `organization_id`
- Conversations scoped by `json_metadata.user_id` + project RBAC
- Credit metering via `organizations.ai_credits_used` / `ai_credits_limit`
- Action policy tiers stored in org settings (`org_action_policy` JSONB when configured)

### SaaS operational checklist

| Item | Notes |
|------|--------|
| Multi-tenant Postgres | Row-level org scoping on all EE modules |
| Secrets | Platform-managed Fernet + per-tenant datasource credentials |
| Upgrades | Rolling deploy of `docker-compose.ee.yml` images |
| Compliance | Export audit trail per conversation; L2 actions require approval by default |

## Governed agentic analytics

Both tracks expose the same enterprise agent capabilities:

- **Assess**: business state snapshot (`assess_mode` / "business pulse" queries)
- **Goal alignment**: `active_goal` on conversation + project goal boards (`PUT /projects/{id}/goals`)
- **Visible plan**: persistent `execution_plan` in chat UI (`AgentPlanPanel`)
- **Policy-gated actions**: L0 auto (read SQL/chart), L2 confirm (alerts, schedules)

## Support matrix

| Feature | Self-host | SaaS |
|---------|-----------|------|
| LangGraph multi-agent | Yes | Yes |
| Self-hosted LLM | Yes | Optional |
| Air-gap | Yes | No |
| Managed upgrades | Customer | Aicser |
| Credit metering | Optional | Yes |
