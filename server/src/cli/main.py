import importlib
import pkgutil

import click
from uvicorn import run

from app import cli
from src.core.config import settings


@click.group()
def fastrun():
    pass


# add sub-commands
for load, module_name, is_pkg in pkgutil.walk_packages(
    cli.__path__, cli.__name__ + "."
):
    module = importlib.import_module(module_name)
    p, m = module_name.rsplit(".", 1)

    if m == "main":
        continue

    for attribute in module.__dict__.values():
        if isinstance(attribute, (click.core.Command, click.core.Group)):
            fastrun.add_command(attribute)

            if isinstance(attribute, click.core.Group):
                break


@fastrun.command()
def start():
    """Start the server."""
    try:
        print("Starting the server...")
        run("app.main:app", host=settings.APP_HOST, port=settings.APP_PORT, reload=True)
    except KeyboardInterrupt:
        print("\nServer terminated by user (Ctrl + C).")
        # Add any cleanup logic here if needed
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
    finally:
        print("Shutdown complete.")
