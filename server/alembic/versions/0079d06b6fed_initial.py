"""initial

Revision ID: 0079d06b6fed
Revises:
Create Date: 2026-04-29 08:50:34.214717

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0079d06b6fed'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = ('ce',)
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### CE tables ###

    # -- users --
    op.create_table('users',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('username', sa.String(length=100), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('first_name', sa.String(length=100), nullable=True),
    sa.Column('last_name', sa.String(length=100), nullable=True),
    sa.Column('role', sa.String(length=64), server_default=sa.text("'user'"), nullable=True),
    sa.Column('status', sa.String(length=32), server_default=sa.text("'active'"), nullable=True),
    sa.Column('tenant_id', sa.String(length=128), server_default=sa.text("'default'"), nullable=True),
    sa.Column('onboarding_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('onboarding_progress', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('onboarding_started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('phone_number', sa.String(length=20), nullable=True),
    sa.Column('company', sa.String(length=255), nullable=True),
    sa.Column('location', sa.String(length=255), nullable=True),
    sa.Column('timezone', sa.String(length=50), nullable=True),
    sa.Column('bio', sa.Text(), nullable=True),
    sa.Column('avatar_url', sa.String(length=255), nullable=True),
    sa.Column('is_pro', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.Column('job_role', sa.String(length=128), nullable=True),
    sa.Column('industry', sa.String(length=100), nullable=True),
    sa.Column('company_size', sa.String(length=50), nullable=True),
    sa.Column('data_experience', sa.String(length=50), nullable=True),
    sa.Column('primary_use_case', sa.String(length=100), nullable=True),
    sa.Column('data_frequency', sa.String(length=50), nullable=True),
    sa.Column('goals', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('telegram_chat_id', sa.String(length=50), nullable=True),
    sa.Column('telegram_username', sa.String(length=100), nullable=True),
    sa.Column('telegram_status', sa.Enum('connected', 'pending', 'disconnected', name='telegram_status_enum'), nullable=True),
    sa.Column('telegram_context', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=False)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_telegram_chat_id'), 'users', ['telegram_chat_id'], unique=True)
    op.create_index(op.f('ix_users_user_id'), 'users', ['user_id'], unique=True)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=False)

    # -- data_sources --
    op.create_table('data_sources',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('type', sa.String(), nullable=False),
    sa.Column('format', sa.String(), nullable=True),
    sa.Column('db_type', sa.String(), nullable=True),
    sa.Column('size', sa.Integer(), nullable=True),
    sa.Column('row_count', sa.Integer(), nullable=True),
    sa.Column('schema', sa.JSON(), nullable=True),
    sa.Column('sample_data', sa.JSON(), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('connection_config', sa.JSON(), nullable=True),
    sa.Column('file_path', sa.String(), nullable=True),
    sa.Column('original_filename', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('tenant_id', sa.String(), server_default=sa.text("'default'"), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('last_accessed', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_data_sources_id'), 'data_sources', ['id'], unique=False)
    op.create_index(op.f('ix_data_sources_user_id'), 'data_sources', ['user_id'], unique=False)

    # -- project_data_source --
    op.create_table('project_data_source',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('data_source_id', sa.String(), nullable=False),
    sa.Column('data_source_type', sa.String(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_project_data_source_data_source_id'), 'project_data_source', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_project_data_source_id'), 'project_data_source', ['id'], unique=False)
    op.create_index(op.f('ix_project_data_source_project_id'), 'project_data_source', ['project_id'], unique=False)

    # -- file_storage --
    op.create_table('file_storage',
    sa.Column('object_key', sa.String(), nullable=False),
    sa.Column('file_data', postgresql.BYTEA(), nullable=False),
    sa.Column('file_size', sa.Integer(), nullable=False),
    sa.Column('content_type', sa.String(), nullable=True),
    sa.Column('original_filename', sa.String(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=True),
    sa.PrimaryKeyConstraint('object_key')
    )
    op.create_index(op.f('ix_file_storage_object_key'), 'file_storage', ['object_key'], unique=False)

    # -- connector_runtime_jobs --
    op.create_table('connector_runtime_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('connector_mode', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_connector_runtime_jobs_connector_mode'), 'connector_runtime_jobs', ['connector_mode'], unique=False)
    op.create_index(op.f('ix_connector_runtime_jobs_id'), 'connector_runtime_jobs', ['id'], unique=False)
    op.create_index(op.f('ix_connector_runtime_jobs_project_id'), 'connector_runtime_jobs', ['project_id'], unique=False)

    # -- data_queries --
    op.create_table('data_queries',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('data_source_id', sa.String(), nullable=False),
    sa.Column('natural_language_query', sa.Text(), nullable=True),
    sa.Column('query_config', sa.JSON(), nullable=True),
    sa.Column('result_count', sa.Integer(), nullable=True),
    sa.Column('execution_time_ms', sa.Integer(), nullable=True),
    sa.Column('query_type', sa.JSON(), nullable=True),
    sa.Column('business_context', sa.JSON(), nullable=True),
    sa.Column('chart_type', sa.String(), nullable=True),
    sa.Column('chart_config', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_data_queries_id'), 'data_queries', ['id'], unique=False)
    op.create_index(op.f('ix_data_queries_user_id'), 'data_queries', ['user_id'], unique=False)

    # -- dashboards --
    op.create_table('dashboards',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('config', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )

    # -- dashboard_charts --
    op.create_table('dashboard_charts',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=False),
    sa.Column('chart_id', sa.UUID(), nullable=False),
    sa.Column('layout', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_dashboard_charts_chart_id'), 'dashboard_charts', ['chart_id'], unique=False)
    op.create_index(op.f('ix_dashboard_charts_dashboard_id'), 'dashboard_charts', ['dashboard_id'], unique=False)
    op.create_index(op.f('ix_dashboard_charts_id'), 'dashboard_charts', ['id'], unique=False)

    # -- dashboard_pages --
    op.create_table('dashboard_pages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('page_order', sa.Integer(), nullable=True),
    sa.Column('layout_config', sa.JSON(), nullable=True),
    sa.Column('filters', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # -- dashboard_shares --
    op.create_table('dashboard_shares',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=False),
    sa.Column('shared_by', sa.UUID(), nullable=False),
    sa.Column('shared_with', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('permission', sa.String(length=20), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('share_token', sa.String(length=255), nullable=True),
    sa.Column('access_count', sa.Integer(), nullable=True),
    sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # -- dashboard_templates --
    op.create_table('dashboard_templates',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('category', sa.String(length=100), nullable=True),
    sa.Column('template_config', sa.JSON(), nullable=False),
    sa.Column('preview_image_url', sa.String(length=500), nullable=True),
    sa.Column('is_public', sa.Boolean(), nullable=True),
    sa.Column('is_featured', sa.Boolean(), nullable=True),
    sa.Column('usage_count', sa.Integer(), nullable=True),
    sa.Column('rating', sa.Float(), nullable=True),
    sa.Column('required_plan', sa.String(length=20), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )

    # -- dashboard_analytics --
    op.create_table('dashboard_analytics',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('event_type', sa.String(length=50), nullable=False),
    sa.Column('event_data', sa.JSON(), nullable=True),
    sa.Column('session_id', sa.String(length=255), nullable=True),
    sa.Column('load_time', sa.Float(), nullable=True),
    sa.Column('render_time', sa.Float(), nullable=True),
    sa.Column('query_time', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # -- charts --
    op.create_table('charts',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('data_source_id', sa.String(), nullable=True),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('chart_type', sa.String(length=100), nullable=True),
    sa.Column('chart_query', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('chart_options', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('chart_library', sa.String(length=50), nullable=True),
    sa.Column('status', sa.String(length=50), nullable=True),
    sa.Column('complexity_score', sa.Integer(), nullable=True),
    sa.Column('data_source', sa.String(length=255), nullable=True),
    sa.Column('form_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('datasource', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('message_id', sa.UUID(), nullable=True),
    sa.Column('conversation_id', sa.UUID(), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ),
    sa.ForeignKeyConstraint(['data_source_id'], ['data_sources.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_charts_data_source_id'), 'charts', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_charts_id'), 'charts', ['id'], unique=True)
    op.create_index(op.f('ix_charts_user_id'), 'charts', ['user_id'], unique=False)

    # -- query_patterns --
    op.create_table('query_patterns',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('data_source_id', sa.String(), nullable=True),
    sa.Column('schema_hash', sa.String(length=24), nullable=False),
    sa.Column('nl_query', sa.Text(), nullable=False),
    sa.Column('nl_query_normalized', sa.Text(), nullable=False),
    sa.Column('sql', sa.Text(), nullable=False),
    sa.Column('analytics_type', sa.String(length=50), server_default=sa.text("'descriptive'"), nullable=True),
    sa.Column('score', sa.Integer(), server_default=sa.text('1'), nullable=True),
    sa.Column('execution_count', sa.Integer(), server_default=sa.text('1'), nullable=True),
    sa.Column('avg_latency_ms', sa.Integer(), nullable=True),
    sa.Column('origin', sa.String(length=50), server_default=sa.text("'ai_pipeline'"), nullable=True),
    sa.Column('embedding', sa.JSON(), nullable=True),
    sa.Column('dashboard_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_query_patterns_data_source_id'), 'query_patterns', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_query_patterns_id'), 'query_patterns', ['id'], unique=False)
    op.create_index(op.f('ix_query_patterns_nl_query_normalized'), 'query_patterns', ['nl_query_normalized'], unique=False)
    op.create_index(op.f('ix_query_patterns_schema_hash'), 'query_patterns', ['schema_hash'], unique=False)
    op.create_index(op.f('ix_query_patterns_user_id'), 'query_patterns', ['user_id'], unique=False)

    # -- dashboard_embeds --
    op.create_table('dashboard_embeds',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=False),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('embed_token', sa.String(length=255), nullable=False),
    sa.Column('options', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('access_count', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.Column('deleted_at', sa.DateTime(), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ),
    sa.PrimaryKeyConstraint('id')
    )

    # -- knowledge_documents --
    op.create_table('knowledge_documents',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('data_source_id', sa.String(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('filename', sa.String(), nullable=False),
    sa.Column('file_type', sa.String(length=10), nullable=True),
    sa.Column('chunk_count', sa.Integer(), server_default=sa.text('0'), nullable=True),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'processing'"), nullable=True),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['data_source_id'], ['data_sources.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_knowledge_documents_data_source_id'), 'knowledge_documents', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_knowledge_documents_id'), 'knowledge_documents', ['id'], unique=False)
    op.create_index(op.f('ix_knowledge_documents_user_id'), 'knowledge_documents', ['user_id'], unique=False)

    # -- document_chunks --
    op.create_table('document_chunks',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('document_id', sa.UUID(), nullable=False),
    sa.Column('data_source_id', sa.String(), nullable=False),
    sa.Column('chunk_index', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('token_count', sa.Integer(), nullable=True),
    sa.Column('embedding', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['document_id'], ['knowledge_documents.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_chunks_data_source_id'), 'document_chunks', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_document_chunks_document_id'), 'document_chunks', ['document_id'], unique=False)
    op.create_index(op.f('ix_document_chunks_id'), 'document_chunks', ['id'], unique=False)

    # -- schema_table_index --
    op.create_table('schema_table_index',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('data_source_id', sa.String(), nullable=False),
    sa.Column('table_name', sa.String(length=255), nullable=False),
    sa.Column('schema_name', sa.String(length=255), nullable=True),
    sa.Column('column_names_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('column_types_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('row_count', sa.BigInteger(), nullable=True),
    sa.Column('embedding', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('domain_tag', sa.String(length=64), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schema_table_index_data_source_id'), 'schema_table_index', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_schema_table_index_domain_tag'), 'schema_table_index', ['domain_tag'], unique=False)
    op.create_index(op.f('ix_schema_table_index_id'), 'schema_table_index', ['id'], unique=False)
    op.create_index(op.f('ix_schema_table_index_table_name'), 'schema_table_index', ['table_name'], unique=False)

    # -- schema_column_index --
    op.create_table('schema_column_index',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('data_source_id', sa.String(), nullable=False),
    sa.Column('table_name', sa.String(length=255), nullable=False),
    sa.Column('column_name', sa.String(length=255), nullable=False),
    sa.Column('data_type', sa.String(length=64), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('embedding', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_schema_column_index_column_name'), 'schema_column_index', ['column_name'], unique=False)
    op.create_index(op.f('ix_schema_column_index_data_source_id'), 'schema_column_index', ['data_source_id'], unique=False)
    op.create_index(op.f('ix_schema_column_index_id'), 'schema_column_index', ['id'], unique=False)
    op.create_index(op.f('ix_schema_column_index_table_name'), 'schema_column_index', ['table_name'], unique=False)

    # -- feed_author_follows --
    op.create_table('feed_author_follows',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('follower_id', sa.UUID(), nullable=False),
    sa.Column('following_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['follower_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['following_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('follower_id', 'following_id', name='uq_feed_author_follow')
    )
    op.create_index('idx_feed_author_follows_follower', 'feed_author_follows', ['follower_id'], unique=False)
    op.create_index('idx_feed_author_follows_following', 'feed_author_follows', ['following_id'], unique=False)
    op.create_index(op.f('ix_feed_author_follows_id'), 'feed_author_follows', ['id'], unique=False)

    # -- feed_posts --
    op.create_table('feed_posts',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('asset_type', sa.Enum('dashboard', 'chart', 'insight', name='asset_type_enum'), nullable=False),
    sa.Column('asset_id', sa.UUID(), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('author_id', sa.UUID(), nullable=True),
    sa.Column('visibility', sa.Enum('private', 'project', 'organization', 'public', name='feed_visibility_enum'), server_default=sa.text("'private'"), nullable=False),
    sa.Column('status', sa.Enum('draft', 'pending', 'approved', 'rejected', name='publish_status_enum'), server_default=sa.text("'draft'"), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
    sa.Column('approved_by', sa.UUID(), nullable=True),
    sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('rejected_by', sa.UUID(), nullable=True),
    sa.Column('rejected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('rejection_reason', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('featured', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('featured_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('public_access_level', sa.Enum('results_only', 'full_access', name='publication_access_level_enum'), server_default=sa.text("'results_only'"), nullable=False),
    sa.Column('requires_login', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('comment_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('reaction_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('save_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('view_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('share_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.ForeignKeyConstraint(['approved_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['rejected_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('asset_type', 'asset_id', name='uq_feed_posts_asset')
    )
    op.create_index('idx_feed_posts_org_visibility', 'feed_posts', ['organization_id', 'visibility'], unique=False)
    op.create_index('idx_feed_posts_project_visibility', 'feed_posts', ['project_id', 'visibility'], unique=False)
    op.create_index(op.f('ix_feed_posts_id'), 'feed_posts', ['id'], unique=False)

    # -- feed_comments --
    op.create_table('feed_comments',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('mentions', postgresql.ARRAY(sa.UUID()), nullable=True),
    sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('deleted_by', sa.UUID(), nullable=True),
    sa.Column('moderation_status', sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['parent_id'], ['feed_comments.id'], ),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feed_comments_id'), 'feed_comments', ['id'], unique=False)

    # -- feed_comment_reactions --
    op.create_table('feed_comment_reactions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('comment_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('reaction', sa.Enum('like', 'love', 'insightful', 'applause', 'funny', 'celebrate', name='comment_reaction_type_enum'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['comment_id'], ['feed_comments.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('comment_id', 'user_id', name='uq_feed_comment_reaction_user')
    )
    op.create_index('idx_feed_comment_reactions_comment', 'feed_comment_reactions', ['comment_id'], unique=False)
    op.create_index(op.f('ix_feed_comment_reactions_id'), 'feed_comment_reactions', ['id'], unique=False)

    # -- feed_interactions --
    op.create_table('feed_interactions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('type', sa.Enum('like', 'love', 'insightful', 'applause', 'funny', 'celebrate', 'save', name='interaction_type_enum'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('post_id', 'user_id', 'type', name='uq_feed_interactions_user_type')
    )
    op.create_index(op.f('ix_feed_interactions_id'), 'feed_interactions', ['id'], unique=False)

    # -- feed_events --
    op.create_table('feed_events',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=False),
    sa.Column('target_user_id', sa.UUID(), nullable=True),
    sa.Column('type', sa.Enum('publish', 'comment', 'reaction', 'approval', 'share', 'save', 'mention', 'created', 'updated', 'approved', 'rejected', 'approval_requested', name='event_type_enum'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('is_read', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ),
    sa.ForeignKeyConstraint(['target_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feed_events_id'), 'feed_events', ['id'], unique=False)

    # -- feed_views --
    op.create_table('feed_views',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('viewed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('session_id', sa.String(length=255), nullable=True),
    sa.Column('duration_seconds', sa.Integer(), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.Text(), nullable=True),
    sa.Column('referrer', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feed_views_id'), 'feed_views', ['id'], unique=False)

    # -- feed_collections --
    op.create_table('feed_collections',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('is_public', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feed_collections_id'), 'feed_collections', ['id'], unique=False)

    # -- feed_collection_items --
    op.create_table('feed_collection_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('collection_id', sa.UUID(), nullable=False),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['collection_id'], ['feed_collections.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('collection_id', 'post_id', name='uq_feed_collection_item')
    )
    op.create_index(op.f('ix_feed_collection_items_id'), 'feed_collection_items', ['id'], unique=False)

    # -- feed_notifications --
    op.create_table('feed_notifications',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('recipient_id', sa.UUID(), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('post_id', sa.UUID(), nullable=True),
    sa.Column('comment_id', sa.UUID(), nullable=True),
    sa.Column('type', sa.Enum('mention', 'comment', 'reaction', 'share', 'approval', name='notification_type_enum'), nullable=False),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('is_read', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['comment_id'], ['feed_comments.id'], ),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feed_notifications_id'), 'feed_notifications', ['id'], unique=False)

    # -- feed_shares --
    op.create_table('feed_shares',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('post_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('channel', sa.String(length=64), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_feed_shares_id'), 'feed_shares', ['id'], unique=False)
    # ### end CE tables ###


def downgrade() -> None:
    # ### CE tables (reverse order) ###
    op.drop_index(op.f('ix_feed_shares_id'), table_name='feed_shares')
    op.drop_table('feed_shares')
    op.drop_index(op.f('ix_feed_notifications_id'), table_name='feed_notifications')
    op.drop_table('feed_notifications')
    op.drop_index(op.f('ix_feed_collection_items_id'), table_name='feed_collection_items')
    op.drop_table('feed_collection_items')
    op.drop_index(op.f('ix_feed_collections_id'), table_name='feed_collections')
    op.drop_table('feed_collections')
    op.drop_index(op.f('ix_feed_views_id'), table_name='feed_views')
    op.drop_table('feed_views')
    op.drop_index(op.f('ix_feed_events_id'), table_name='feed_events')
    op.drop_table('feed_events')
    op.drop_index(op.f('ix_feed_interactions_id'), table_name='feed_interactions')
    op.drop_table('feed_interactions')
    op.drop_index(op.f('ix_feed_comment_reactions_id'), table_name='feed_comment_reactions')
    op.drop_index('idx_feed_comment_reactions_comment', table_name='feed_comment_reactions')
    op.drop_table('feed_comment_reactions')
    op.drop_index(op.f('ix_feed_comments_id'), table_name='feed_comments')
    op.drop_table('feed_comments')
    op.drop_index(op.f('ix_feed_posts_id'), table_name='feed_posts')
    op.drop_index('idx_feed_posts_project_visibility', table_name='feed_posts')
    op.drop_index('idx_feed_posts_org_visibility', table_name='feed_posts')
    op.drop_table('feed_posts')
    op.drop_index(op.f('ix_feed_author_follows_id'), table_name='feed_author_follows')
    op.drop_index('idx_feed_author_follows_following', table_name='feed_author_follows')
    op.drop_index('idx_feed_author_follows_follower', table_name='feed_author_follows')
    op.drop_table('feed_author_follows')
    op.drop_index(op.f('ix_schema_column_index_table_name'), table_name='schema_column_index')
    op.drop_index(op.f('ix_schema_column_index_id'), table_name='schema_column_index')
    op.drop_index(op.f('ix_schema_column_index_data_source_id'), table_name='schema_column_index')
    op.drop_index(op.f('ix_schema_column_index_column_name'), table_name='schema_column_index')
    op.drop_table('schema_column_index')
    op.drop_index(op.f('ix_schema_table_index_table_name'), table_name='schema_table_index')
    op.drop_index(op.f('ix_schema_table_index_id'), table_name='schema_table_index')
    op.drop_index(op.f('ix_schema_table_index_domain_tag'), table_name='schema_table_index')
    op.drop_index(op.f('ix_schema_table_index_data_source_id'), table_name='schema_table_index')
    op.drop_table('schema_table_index')
    op.drop_index(op.f('ix_document_chunks_id'), table_name='document_chunks')
    op.drop_index(op.f('ix_document_chunks_document_id'), table_name='document_chunks')
    op.drop_index(op.f('ix_document_chunks_data_source_id'), table_name='document_chunks')
    op.drop_table('document_chunks')
    op.drop_index(op.f('ix_knowledge_documents_user_id'), table_name='knowledge_documents')
    op.drop_index(op.f('ix_knowledge_documents_id'), table_name='knowledge_documents')
    op.drop_index(op.f('ix_knowledge_documents_data_source_id'), table_name='knowledge_documents')
    op.drop_table('knowledge_documents')
    op.drop_table('dashboard_embeds')
    op.drop_index(op.f('ix_query_patterns_user_id'), table_name='query_patterns')
    op.drop_index(op.f('ix_query_patterns_schema_hash'), table_name='query_patterns')
    op.drop_index(op.f('ix_query_patterns_nl_query_normalized'), table_name='query_patterns')
    op.drop_index(op.f('ix_query_patterns_id'), table_name='query_patterns')
    op.drop_index(op.f('ix_query_patterns_data_source_id'), table_name='query_patterns')
    op.drop_table('query_patterns')
    op.drop_index(op.f('ix_charts_user_id'), table_name='charts')
    op.drop_index(op.f('ix_charts_id'), table_name='charts')
    op.drop_index(op.f('ix_charts_data_source_id'), table_name='charts')
    op.drop_table('charts')
    op.drop_table('dashboard_analytics')
    op.drop_table('dashboard_shares')
    op.drop_table('dashboard_pages')
    op.drop_table('dashboard_templates')
    op.drop_index(op.f('ix_dashboard_charts_id'), table_name='dashboard_charts')
    op.drop_index(op.f('ix_dashboard_charts_dashboard_id'), table_name='dashboard_charts')
    op.drop_index(op.f('ix_dashboard_charts_chart_id'), table_name='dashboard_charts')
    op.drop_table('dashboard_charts')
    op.drop_table('dashboards')
    op.drop_index(op.f('ix_data_queries_user_id'), table_name='data_queries')
    op.drop_index(op.f('ix_data_queries_id'), table_name='data_queries')
    op.drop_table('data_queries')
    op.drop_index(op.f('ix_connector_runtime_jobs_project_id'), table_name='connector_runtime_jobs')
    op.drop_index(op.f('ix_connector_runtime_jobs_id'), table_name='connector_runtime_jobs')
    op.drop_index(op.f('ix_connector_runtime_jobs_connector_mode'), table_name='connector_runtime_jobs')
    op.drop_table('connector_runtime_jobs')
    op.drop_index(op.f('ix_file_storage_object_key'), table_name='file_storage')
    op.drop_table('file_storage')
    op.drop_index(op.f('ix_project_data_source_project_id'), table_name='project_data_source')
    op.drop_index(op.f('ix_project_data_source_id'), table_name='project_data_source')
    op.drop_index(op.f('ix_project_data_source_data_source_id'), table_name='project_data_source')
    op.drop_table('project_data_source')
    op.drop_index(op.f('ix_data_sources_user_id'), table_name='data_sources')
    op.drop_index(op.f('ix_data_sources_id'), table_name='data_sources')
    op.drop_table('data_sources')
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_user_id'), table_name='users')
    op.drop_index(op.f('ix_users_telegram_chat_id'), table_name='users')
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    # ### end CE tables ###
