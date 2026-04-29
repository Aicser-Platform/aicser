import click
from alembic.config import main as alembic_main


@click.group()
def db():
    """Perform database migrations."""


@db.command(name="upgrade")
def upgrade():
    """Migrate the database."""
    # Use sync version of alembic commands
    try:
        alembic_main(["--raiseerr", "upgrade", "head"])
    except Exception as e:
        click.echo(f"Error during migration: {e}", err=True)
        raise click.Abort()


@db.command()
@click.argument("revision", required=True)
def downgrade(revision):
    """Downgrade the database to a previous revision."""
    try:
        alembic_main(["--raiseerr", "downgrade", revision])
    except Exception as e:
        click.echo(f"Error during downgrade: {e}", err=True)
        raise click.Abort()


@db.command()
@click.option("--message", "-m", required=True)
def revision(message):
    """Create a new revision."""
    try:
        alembic_main(["--raiseerr", "revision", "--autogenerate", "-m", message])
    except Exception as e:
        click.echo(f"Error creating revision: {e}", err=True)
        raise click.Abort()
