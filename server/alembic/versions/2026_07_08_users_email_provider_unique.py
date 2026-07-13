"""Replace email unique constraint with email + provider composite unique constraint."""

from alembic import op

revision = "2026_07_08_email_provider_unique"
down_revision = "2026_06_29_cross_source_rel"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.create_unique_constraint("uq_users_email_provider", "users", ["email", "provider"])

def downgrade() -> None:
    op.drop_constraint("uq_users_email_provider", "users", type_="unique")
    op.create_unique_constraint("uq_users_email", "users", ["email"])
