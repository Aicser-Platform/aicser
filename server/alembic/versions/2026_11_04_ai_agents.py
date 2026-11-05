"""One AI agent: draft and published versions, audience, abilities and shared memory.

Existing embed assistants stay live: their current settings become version 1.
"""

from __future__ import annotations

from alembic import op

revision = "2026_11_04_ai_agents"
down_revision = "2026_11_04_mcp_oauth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE embed_assistants
            ADD COLUMN IF NOT EXISTS abilities JSONB NOT NULL DEFAULT '{"documents": true, "data": false, "actions": false}'::jsonb,
            ADD COLUMN IF NOT EXISTS audience VARCHAR(16) NOT NULL DEFAULT 'me',
            ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'draft',
            ADD COLUMN IF NOT EXISTS published_audience VARCHAR(16),
            ADD COLUMN IF NOT EXISTS published_config JSONB,
            ADD COLUMN IF NOT EXISTS published_version INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS pending_config JSONB,
            ADD COLUMN IF NOT EXISTS pending_audience VARCHAR(16),
            ADD COLUMN IF NOT EXISTS pending_by UUID,
            ADD COLUMN IF NOT EXISTS pending_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS pending_note TEXT,
            ADD COLUMN IF NOT EXISTS monthly_limit_usd DOUBLE PRECISION
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS embed_assistant_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            assistant_id UUID NOT NULL REFERENCES embed_assistants(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            audience VARCHAR(16) NOT NULL,
            config JSONB NOT NULL,
            requested_by UUID,
            approved_by UUID,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (assistant_id, version)
        )
    """)
    op.execute("ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS agent_id UUID")
    op.execute("CREATE INDEX IF NOT EXISTS ix_agent_memories_agent_id ON agent_memories (agent_id)")
    op.execute("""
        UPDATE embed_assistants SET
            abilities = jsonb_build_object('documents', true, 'data', capabilities = 'full_engine', 'actions', false),
            audience = CASE WHEN auth_mode IN ('embed_jwt', 'anonymous') THEN 'public'
                            WHEN visibility = 'public' THEN 'organization' ELSE 'me' END,
            status = 'published', published_version = 1
        WHERE published_config IS NULL
    """)
    op.execute("""
        UPDATE embed_assistants SET published_audience = audience, published_config = jsonb_build_object(
            'name', name, 'system_prompt', system_prompt, 'welcome_message', welcome_message,
            'fallback_message', fallback_message, 'conversation_starters', conversation_starters,
            'icon_emoji', icon_emoji, 'color', color, 'preferred_model', preferred_model, 'temperature', temperature,
            'library_ids', library_ids, 'data_source_ids', data_source_ids,
            'primary_data_source_id', primary_data_source_id, 'allowed_modes', allowed_modes, 'abilities', abilities)
        WHERE published_config IS NULL
    """)
    op.execute("""
        INSERT INTO embed_assistant_versions (assistant_id, version, audience, config, note)
        SELECT id, 1, published_audience, published_config, 'Settings when agents were introduced' FROM embed_assistants
        WHERE published_version = 1
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE agent_memories DROP COLUMN IF EXISTS agent_id")
    op.execute("DROP TABLE IF EXISTS embed_assistant_versions")
    op.execute("""
        ALTER TABLE embed_assistants DROP COLUMN IF EXISTS abilities, DROP COLUMN IF EXISTS audience, DROP COLUMN IF EXISTS status,
            DROP COLUMN IF EXISTS published_audience, DROP COLUMN IF EXISTS published_config, DROP COLUMN IF EXISTS published_version,
            DROP COLUMN IF EXISTS pending_config, DROP COLUMN IF EXISTS pending_audience, DROP COLUMN IF EXISTS pending_by,
            DROP COLUMN IF EXISTS pending_at, DROP COLUMN IF EXISTS pending_note, DROP COLUMN IF EXISTS monthly_limit_usd
    """)
