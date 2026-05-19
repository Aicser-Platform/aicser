"""ee_tables

Revision ID: f11a9f2c63b1
Revises:
Create Date: 2026-04-29 09:54:19.612005

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f11a9f2c63b1'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = ('ee',)
depends_on: Union[str, Sequence[str], None] = ('0079d06b6fed',)


def upgrade() -> None:
    # ### EE tables ###

    # -- subscription_plans --
    op.create_table('subscription_plans',
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('slug', sa.String(length=50), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('limits', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
    sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscription_plans_id'), 'subscription_plans', ['id'], unique=False)
    op.create_index(op.f('ix_subscription_plans_slug'), 'subscription_plans', ['slug'], unique=True)

    # -- organizations --
    op.create_table('organizations',
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('telegram_enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_organizations_id'), 'organizations', ['id'], unique=False)

    # -- organization_kpi_definitions --
    op.create_table('organization_kpi_definitions',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('kpi_slug', sa.String(length=100), nullable=False),
    sa.Column('kpi_name', sa.String(length=200), nullable=False),
    sa.Column('trigger_keywords', sa.Text(), server_default='', nullable=False),
    sa.Column('sql_expression', sa.Text(), nullable=False),
    sa.Column('required_tables', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('data_source_ids', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('verified_by_user_id', sa.UUID(), nullable=True),
    sa.Column('verified', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('usage_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('organization_id', 'kpi_slug', name='uq_org_kpi_slug')
    )
    op.create_index('ix_org_kpi_org_id', 'organization_kpi_definitions', ['organization_id'], unique=False)
    op.create_index(op.f('ix_organization_kpi_definitions_id'), 'organization_kpi_definitions', ['id'], unique=False)
    op.create_index(op.f('ix_organization_kpi_definitions_organization_id'), 'organization_kpi_definitions', ['organization_id'], unique=False)

    # -- organization_subscriptions --
    op.create_table('organization_subscriptions',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('plan_id', sa.UUID(), nullable=False),
    sa.Column('status', sa.Enum('trialing', 'active', 'past_due', 'canceled', name='subscription_status_enum'), server_default=sa.text("'trialing'"), nullable=False),
    sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('trial_expiring_soon', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('provider', sa.String(length=50), nullable=True),
    sa.Column('provider_subscription_id', sa.String(length=255), nullable=True),
    sa.Column('provider_customer_id', sa.String(length=255), nullable=True),
    sa.Column('provider_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['plan_id'], ['subscription_plans.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_provider_subscription', 'organization_subscriptions', ['provider', 'provider_subscription_id'], unique=False)
    op.create_index(op.f('ix_organization_subscriptions_id'), 'organization_subscriptions', ['id'], unique=False)
    op.create_index(op.f('ix_organization_subscriptions_organization_id'), 'organization_subscriptions', ['organization_id'], unique=True)
    op.create_index(op.f('ix_organization_subscriptions_plan_id'), 'organization_subscriptions', ['plan_id'], unique=False)
    op.create_index(op.f('ix_organization_subscriptions_provider'), 'organization_subscriptions', ['provider'], unique=False)
    op.create_index(op.f('ix_organization_subscriptions_provider_customer_id'), 'organization_subscriptions', ['provider_customer_id'], unique=False)
    op.create_index(op.f('ix_organization_subscriptions_provider_subscription_id'), 'organization_subscriptions', ['provider_subscription_id'], unique=False)
    op.create_index(op.f('ix_organization_subscriptions_status'), 'organization_subscriptions', ['status'], unique=False)

    # -- organization_usage --
    op.create_table('organization_usage',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('metric', sa.String(length=100), nullable=False),
    sa.Column('used', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('period_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('period_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('organization_id', 'metric', 'period_start', name='uq_org_metric_period')
    )
    op.create_index('idx_org_usage_lookup', 'organization_usage', ['organization_id', 'metric', 'period_end'], unique=False)
    op.create_index(op.f('ix_organization_usage_id'), 'organization_usage', ['id'], unique=False)
    op.create_index(op.f('ix_organization_usage_metric'), 'organization_usage', ['metric'], unique=False)
    op.create_index(op.f('ix_organization_usage_organization_id'), 'organization_usage', ['organization_id'], unique=False)

    # -- payment_history --
    op.create_table('payment_history',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('amount', sa.Float(), nullable=False),
    sa.Column('currency', sa.String(length=3), server_default=sa.text("'USD'"), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('provider', sa.String(length=50), nullable=False),
    sa.Column('provider_transaction_id', sa.String(length=255), nullable=True),
    sa.Column('provider_invoice_id', sa.String(length=255), nullable=True),
    sa.Column('payment_method', sa.String(length=50), nullable=True),
    sa.Column('provider_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('paid_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_provider_transaction', 'payment_history', ['provider', 'provider_transaction_id'], unique=False)
    op.create_index(op.f('ix_payment_history_id'), 'payment_history', ['id'], unique=False)
    op.create_index(op.f('ix_payment_history_organization_id'), 'payment_history', ['organization_id'], unique=False)
    op.create_index(op.f('ix_payment_history_provider'), 'payment_history', ['provider'], unique=False)
    op.create_index(op.f('ix_payment_history_provider_invoice_id'), 'payment_history', ['provider_invoice_id'], unique=False)
    op.create_index(op.f('ix_payment_history_provider_transaction_id'), 'payment_history', ['provider_transaction_id'], unique=False)
    op.create_index('uq_payment_provider_invoice_id', 'payment_history', ['provider_invoice_id'], unique=True, postgresql_where=sa.text('provider_invoice_id IS NOT NULL'))

    # -- projects --
    op.create_table('projects',
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('is_private', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_projects_id'), 'projects', ['id'], unique=False)

    # -- roles --
    op.create_table('roles',
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('display_name', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('scope', sa.Enum('organization', 'project', name='role_scope_enum'), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name', 'scope', name='uq_role_name_scope')
    )
    op.create_index(op.f('ix_roles_id'), 'roles', ['id'], unique=False)

    # -- permissions --
    op.create_table('permissions',
    sa.Column('action', sa.String(), nullable=False),
    sa.Column('resource', sa.String(), nullable=False),
    sa.Column('code', sa.String(length=100), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('action', 'resource', name='uq_permission_action_resource'),
    sa.UniqueConstraint('code')
    )
    op.create_index(op.f('ix_permissions_id'), 'permissions', ['id'], unique=False)

    # -- role_permissions --
    op.create_table('role_permissions',
    sa.Column('role_id', sa.UUID(), nullable=False),
    sa.Column('permission_id', sa.UUID(), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ),
    sa.PrimaryKeyConstraint('role_id', 'permission_id', 'id')
    )
    op.create_index(op.f('ix_role_permissions_id'), 'role_permissions', ['id'], unique=False)

    # -- user_roles --
    op.create_table('user_roles',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('role_id', sa.UUID(), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('assigned_by', sa.UUID(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'role_id', 'organization_id', 'project_id', name='uq_user_role_assignment')
    )
    op.create_index(op.f('ix_user_roles_id'), 'user_roles', ['id'], unique=False)

    # -- organization_invitations --
    op.create_table('organization_invitations',
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=False),
    sa.Column('role_id', sa.UUID(), nullable=False),
    sa.Column('token', sa.String(length=255), nullable=False),
    sa.Column('status', sa.Enum('pending', 'accepted', 'expired', 'revoked', name='invite_status_enum'), server_default=sa.text("'pending'"), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('invited_by', sa.UUID(), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email', 'organization_id', 'status', name='uq_active_invite_per_email_org')
    )
    op.create_index(op.f('ix_organization_invitations_email'), 'organization_invitations', ['email'], unique=False)
    op.create_index(op.f('ix_organization_invitations_id'), 'organization_invitations', ['id'], unique=False)
    op.create_index(op.f('ix_organization_invitations_organization_id'), 'organization_invitations', ['organization_id'], unique=False)
    op.create_index(op.f('ix_organization_invitations_token'), 'organization_invitations', ['token'], unique=True)

    # -- conversation --
    op.create_table('conversation',
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=50), server_default=sa.text("'active'"), nullable=True),
    sa.Column('type', sa.String(length=50), server_default=sa.text("'chat2chart'"), nullable=True),
    sa.Column('json_metadata', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_conversation_id'), 'conversation', ['id'], unique=False)
    op.create_index(op.f('ix_conversation_project_id'), 'conversation', ['project_id'], unique=False)
    op.create_index(op.f('ix_conversation_user_id'), 'conversation', ['user_id'], unique=False)

    # -- message --
    op.create_table('message',
    sa.Column('conversation_id', sa.UUID(), nullable=False),
    sa.Column('query', sa.Text(), nullable=True),
    sa.Column('answer', sa.Text(), nullable=True),
    sa.Column('error', sa.String(), nullable=True),
    sa.Column('status', sa.String(), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('ai_metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversation.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_message_id'), 'message', ['id'], unique=False)
    op.create_index(op.f('ix_message_user_id'), 'message', ['user_id'], unique=False)

    # -- llm_audit_log --
    op.create_table('llm_audit_log',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('organization_id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=True),
    sa.Column('request_id', sa.String(length=128), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('data_source_id', sa.String(), nullable=True),
    sa.Column('provider', sa.String(length=32), nullable=True),
    sa.Column('model', sa.String(length=128), nullable=True),
    sa.Column('analysis_mode', sa.String(length=64), nullable=True),
    sa.Column('node_name', sa.String(length=100), nullable=True),
    sa.Column('prompt_hash', sa.String(length=64), nullable=True),
    sa.Column('response_hash', sa.String(length=64), nullable=True),
    sa.Column('prompt_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('completion_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('total_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=True),
    sa.Column('success', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('valid_output', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('is_final', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('outcome', sa.String(length=20), nullable=True),
    sa.Column('error_code', sa.String(length=64), nullable=True),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['data_source_id'], ['data_sources.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_llm_audit_log_data_source_id'), 'llm_audit_log', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_llm_audit_log_id'), 'llm_audit_log', ['id'], unique=False)
    op.create_index('ix_llm_audit_log_org_created', 'llm_audit_log', ['organization_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_llm_audit_log_organization_id'), 'llm_audit_log', ['organization_id'], unique=False)
    op.create_index(op.f('ix_llm_audit_log_project_id'), 'llm_audit_log', ['project_id'], unique=False)
    op.create_index(op.f('ix_llm_audit_log_provider'), 'llm_audit_log', ['provider'], unique=False)
    op.create_index(op.f('ix_llm_audit_log_request_id'), 'llm_audit_log', ['request_id'], unique=False)

    # -- llm_request_summary --
    op.create_table('llm_request_summary',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('request_id', sa.String(length=128), nullable=False),
    sa.Column('organization_id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.String(length=64), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('data_source_id', sa.String(), nullable=True),
    sa.Column('total_prompt_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('total_completion_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('total_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('dataset_size_mb', sa.Float(), nullable=True),
    sa.Column('estimated_credits', sa.Integer(), nullable=True),
    sa.Column('credits_used', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('real_cost_usd', sa.String(length=20), nullable=True),
    sa.Column('final_status', sa.String(length=20), nullable=True),
    sa.Column('total_attempts', sa.Integer(), server_default=sa.text('1'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['data_source_id'], ['data_sources.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_llm_request_summary_data_source_id'), 'llm_request_summary', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_llm_request_summary_id'), 'llm_request_summary', ['id'], unique=False)
    op.create_index('ix_llm_request_summary_org_created', 'llm_request_summary', ['organization_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_llm_request_summary_organization_id'), 'llm_request_summary', ['organization_id'], unique=False)
    op.create_index(op.f('ix_llm_request_summary_project_id'), 'llm_request_summary', ['project_id'], unique=False)
    op.create_index(op.f('ix_llm_request_summary_request_id'), 'llm_request_summary', ['request_id'], unique=True)

    # -- catalog_assets --
    op.create_table('catalog_assets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('asset_type', sa.String(length=50), nullable=False),
    sa.Column('source_ref', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('owner_user_id', sa.UUID(), nullable=True),
    sa.Column('trust_score', sa.Float(), nullable=True),
    sa.Column('freshness_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('project_id', 'asset_type', 'source_ref', name='uq_catalog_asset_project_type_ref')
    )
    op.create_index(op.f('ix_catalog_assets_asset_type'), 'catalog_assets', ['asset_type'], unique=False)
    op.create_index(op.f('ix_catalog_assets_id'), 'catalog_assets', ['id'], unique=False)
    op.create_index(op.f('ix_catalog_assets_owner_user_id'), 'catalog_assets', ['owner_user_id'], unique=False)
    op.create_index(op.f('ix_catalog_assets_project_id'), 'catalog_assets', ['project_id'], unique=False)
    op.create_index(op.f('ix_catalog_assets_source_ref'), 'catalog_assets', ['source_ref'], unique=False)

    # -- platform_lineage_events --
    op.create_table('platform_lineage_events',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('event_type', sa.String(length=64), nullable=False),
    sa.Column('actor_user_id', sa.UUID(), nullable=True),
    sa.Column('data_source_id', sa.String(length=255), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_platform_lineage_events_actor_user_id'), 'platform_lineage_events', ['actor_user_id'], unique=False)
    op.create_index(op.f('ix_platform_lineage_events_created_at'), 'platform_lineage_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_platform_lineage_events_data_source_id'), 'platform_lineage_events', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_platform_lineage_events_event_type'), 'platform_lineage_events', ['event_type'], unique=False)
    op.create_index(op.f('ix_platform_lineage_events_id'), 'platform_lineage_events', ['id'], unique=False)
    op.create_index(op.f('ix_platform_lineage_events_project_id'), 'platform_lineage_events', ['project_id'], unique=False)

    # -- platform_policy_rules --
    op.create_table('platform_policy_rules',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('rule_type', sa.String(length=64), server_default=sa.text("'data_access'"), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_platform_policy_rules_id'), 'platform_policy_rules', ['id'], unique=False)
    op.create_index(op.f('ix_platform_policy_rules_project_id'), 'platform_policy_rules', ['project_id'], unique=False)

    # -- scheduled_emails --
    op.create_table('scheduled_emails',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('to_emails', postgresql.ARRAY(sa.String(length=255)), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('time_of_day', sa.String(length=5), nullable=False),
    sa.Column('day_of_week', sa.String(length=10), nullable=True),
    sa.Column('day_of_month', sa.Integer(), nullable=True),
    sa.Column('schedule_type', sa.Enum('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', name='scheduletype'), nullable=False),
    sa.Column('next_send_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_send_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('timezone', sa.String(length=50), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_scheduled_emails_id'), 'scheduled_emails', ['id'], unique=False)
    # ### end EE tables ###


def downgrade() -> None:
    # ### EE tables (reverse order) ###
    op.drop_index(op.f('ix_scheduled_emails_id'), table_name='scheduled_emails')
    op.drop_table('scheduled_emails')
    op.drop_index(op.f('ix_platform_policy_rules_project_id'), table_name='platform_policy_rules')
    op.drop_index(op.f('ix_platform_policy_rules_id'), table_name='platform_policy_rules')
    op.drop_table('platform_policy_rules')
    op.drop_index(op.f('ix_platform_lineage_events_project_id'), table_name='platform_lineage_events')
    op.drop_index(op.f('ix_platform_lineage_events_id'), table_name='platform_lineage_events')
    op.drop_index(op.f('ix_platform_lineage_events_event_type'), table_name='platform_lineage_events')
    op.drop_index(op.f('ix_platform_lineage_events_data_source_id'), table_name='platform_lineage_events')
    op.drop_index(op.f('ix_platform_lineage_events_created_at'), table_name='platform_lineage_events')
    op.drop_index(op.f('ix_platform_lineage_events_actor_user_id'), table_name='platform_lineage_events')
    op.drop_table('platform_lineage_events')
    op.drop_index(op.f('ix_catalog_assets_source_ref'), table_name='catalog_assets')
    op.drop_index(op.f('ix_catalog_assets_project_id'), table_name='catalog_assets')
    op.drop_index(op.f('ix_catalog_assets_owner_user_id'), table_name='catalog_assets')
    op.drop_index(op.f('ix_catalog_assets_id'), table_name='catalog_assets')
    op.drop_index(op.f('ix_catalog_assets_asset_type'), table_name='catalog_assets')
    op.drop_table('catalog_assets')
    op.drop_index(op.f('ix_llm_request_summary_request_id'), table_name='llm_request_summary')
    op.drop_index(op.f('ix_llm_request_summary_project_id'), table_name='llm_request_summary')
    op.drop_index(op.f('ix_llm_request_summary_organization_id'), table_name='llm_request_summary')
    op.drop_index('ix_llm_request_summary_org_created', table_name='llm_request_summary')
    op.drop_index(op.f('ix_llm_request_summary_id'), table_name='llm_request_summary')
    op.drop_index(op.f('ix_llm_request_summary_data_source_id'), table_name='llm_request_summary')
    op.drop_table('llm_request_summary')
    op.drop_index(op.f('ix_llm_audit_log_request_id'), table_name='llm_audit_log')
    op.drop_index(op.f('ix_llm_audit_log_provider'), table_name='llm_audit_log')
    op.drop_index(op.f('ix_llm_audit_log_project_id'), table_name='llm_audit_log')
    op.drop_index(op.f('ix_llm_audit_log_organization_id'), table_name='llm_audit_log')
    op.drop_index('ix_llm_audit_log_org_created', table_name='llm_audit_log')
    op.drop_index(op.f('ix_llm_audit_log_id'), table_name='llm_audit_log')
    op.drop_index(op.f('ix_llm_audit_log_data_source_id'), table_name='llm_audit_log')
    op.drop_table('llm_audit_log')
    op.drop_index(op.f('ix_message_user_id'), table_name='message')
    op.drop_index(op.f('ix_message_id'), table_name='message')
    op.drop_table('message')
    op.drop_index(op.f('ix_conversation_user_id'), table_name='conversation')
    op.drop_index(op.f('ix_conversation_project_id'), table_name='conversation')
    op.drop_index(op.f('ix_conversation_id'), table_name='conversation')
    op.drop_table('conversation')
    op.drop_index(op.f('ix_organization_invitations_token'), table_name='organization_invitations')
    op.drop_index(op.f('ix_organization_invitations_organization_id'), table_name='organization_invitations')
    op.drop_index(op.f('ix_organization_invitations_id'), table_name='organization_invitations')
    op.drop_index(op.f('ix_organization_invitations_email'), table_name='organization_invitations')
    op.drop_table('organization_invitations')
    op.drop_index(op.f('ix_user_roles_id'), table_name='user_roles')
    op.drop_table('user_roles')
    op.drop_index(op.f('ix_role_permissions_id'), table_name='role_permissions')
    op.drop_table('role_permissions')
    op.drop_index(op.f('ix_permissions_id'), table_name='permissions')
    op.drop_table('permissions')
    op.drop_index(op.f('ix_roles_id'), table_name='roles')
    op.drop_table('roles')
    op.drop_index(op.f('ix_projects_id'), table_name='projects')
    op.drop_table('projects')
    op.drop_index('uq_payment_provider_invoice_id', table_name='payment_history', postgresql_where=sa.text('provider_invoice_id IS NOT NULL'))
    op.drop_index(op.f('ix_payment_history_provider_transaction_id'), table_name='payment_history')
    op.drop_index(op.f('ix_payment_history_provider_invoice_id'), table_name='payment_history')
    op.drop_index(op.f('ix_payment_history_provider'), table_name='payment_history')
    op.drop_index(op.f('ix_payment_history_organization_id'), table_name='payment_history')
    op.drop_index(op.f('ix_payment_history_id'), table_name='payment_history')
    op.drop_index('idx_provider_transaction', table_name='payment_history')
    op.drop_table('payment_history')
    op.drop_index(op.f('ix_organization_usage_organization_id'), table_name='organization_usage')
    op.drop_index(op.f('ix_organization_usage_metric'), table_name='organization_usage')
    op.drop_index(op.f('ix_organization_usage_id'), table_name='organization_usage')
    op.drop_index('idx_org_usage_lookup', table_name='organization_usage')
    op.drop_table('organization_usage')
    op.drop_index(op.f('ix_organization_subscriptions_status'), table_name='organization_subscriptions')
    op.drop_index(op.f('ix_organization_subscriptions_provider_subscription_id'), table_name='organization_subscriptions')
    op.drop_index(op.f('ix_organization_subscriptions_provider_customer_id'), table_name='organization_subscriptions')
    op.drop_index(op.f('ix_organization_subscriptions_provider'), table_name='organization_subscriptions')
    op.drop_index(op.f('ix_organization_subscriptions_plan_id'), table_name='organization_subscriptions')
    op.drop_index(op.f('ix_organization_subscriptions_organization_id'), table_name='organization_subscriptions')
    op.drop_index(op.f('ix_organization_subscriptions_id'), table_name='organization_subscriptions')
    op.drop_index('idx_provider_subscription', table_name='organization_subscriptions')
    op.drop_table('organization_subscriptions')
    op.drop_index(op.f('ix_organization_kpi_definitions_organization_id'), table_name='organization_kpi_definitions')
    op.drop_index(op.f('ix_organization_kpi_definitions_id'), table_name='organization_kpi_definitions')
    op.drop_index('ix_org_kpi_org_id', table_name='organization_kpi_definitions')
    op.drop_table('organization_kpi_definitions')
    op.drop_index(op.f('ix_organizations_id'), table_name='organizations')
    op.drop_table('organizations')
    op.drop_index(op.f('ix_subscription_plans_slug'), table_name='subscription_plans')
    op.drop_index(op.f('ix_subscription_plans_id'), table_name='subscription_plans')
    op.drop_table('subscription_plans')
    # ### end EE tables ###
