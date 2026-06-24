"""Enforce uniqueness on users.email — prevents duplicate accounts per email.

Previously ix_users_email was a plain (non-unique) index, which let multiple
auth/provisioning code paths create separate user rows for the same email.
"""
from alembic import op

revision = "j9f0a1b2c3d4"
down_revision = "i7d8e9f0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.create_unique_constraint("uq_users_email", "users", ["email"])


def downgrade() -> None:
    op.drop_constraint("uq_users_email", "users", type_="unique")
    op.create_index("ix_users_email", "users", ["email"])
