import os
from pathlib import Path

import pytest
import yaml

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_required_pipeline_dependencies_are_importable():
    import arq  # noqa: F401
    import croniter  # noqa: F401
    import pyiceberg  # noqa: F401


def test_pipeline_jobs_get_a_long_timeout():
    """Global job_timeout of 300s is fatal for a real load; pipeline jobs override it."""
    from src.shared.jobs.worker import PIPELINE_JOB_TIMEOUT

    assert PIPELINE_JOB_TIMEOUT >= 3600


def test_pipeline_jobs_are_registered_with_worker():
    from src.shared.jobs.worker import PIPELINE_JOB_TIMEOUT, WorkerSettings

    function_names = {
        getattr(fn, "name", None) or getattr(fn, "__name__", None)
        for fn in WorkerSettings.functions
    }
    assert "run_pipeline" in function_names
    assert "dispatch_due_pipelines_job" in function_names

    run_pipeline = next(
        fn
        for fn in WorkerSettings.functions
        if (getattr(fn, "name", None) == "run_pipeline")
    )
    assert run_pipeline.timeout_s == PIPELINE_JOB_TIMEOUT


def test_pipeline_dispatch_cron_is_registered():
    from src.shared.jobs.worker import WorkerSettings

    cron_names = {job.name for job in WorkerSettings.cron_jobs}
    assert "pipeline_schedule_dispatch" in cron_names


# --- Regression guard for the worker service's compose environment -------
#
# The worker process itself only touches Redis at startup, so a worker
# service missing DB/secret env silently boots and passes a container-level
# smoke check ("did it start?") -- then fails on the first cron job that
# opens a DB session (evaluate_alert_rules runs every minute). A static
# check catches this without needing a live EE stack.

REPO_ROOT = Path(__file__).resolve().parents[4]
DEPLOY_DIR = REPO_ROOT / "deploy"
EE_COMPOSE_FILES = [
    DEPLOY_DIR / "docker-compose.ee.yml",
    DEPLOY_DIR / "docker-compose.ee.prod.yml",
    DEPLOY_DIR / "docker-compose.ee.self-host.yml",
]

# Category patterns, not a hardcoded key list: any server env key matching
# one of these is "database or secret" config the worker must also receive.
# This mirrors the categories cited in review: DATABASE_URL / POSTGRES_* /
# SECRET_KEY / ENCRYPTION_KEY.
_DB_SECRET_KEY_PREFIXES = (
    "DATABASE_URL",
    "POSTGRES",
    "SECRET_KEY",
    "ENCRYPTION_KEY",
)


def _is_db_or_secret_key(key: str) -> bool:
    return any(
        key == prefix or key.startswith(prefix) for prefix in _DB_SECRET_KEY_PREFIXES
    )


def _env_mapping(service: dict) -> dict:
    """A service's `environment:` as a plain dict, whether declared as a
    mapping or as a `KEY=value` / bare `KEY` list."""
    env = service.get("environment") or {}
    if isinstance(env, list):
        result = {}
        for item in env:
            if "=" in item:
                k, v = item.split("=", 1)
            else:
                k, v = item, None
            result[k] = v
        return result
    return dict(env)


def _declared_env_keys(service: dict) -> set:
    return set(_env_mapping(service).keys())


@pytest.mark.parametrize("compose_path", EE_COMPOSE_FILES, ids=lambda p: p.name)
def test_worker_gets_same_db_and_secret_env_as_server(compose_path):
    """Also guards AISER_EDITION parity: without a matching AISER_EDITION,
    is_ee_enabled() is false in the worker even though the server in the
    same stack reports EE, so src/modules/pipeline/__init__.py never
    redirects to ee/modules/pipeline and run_pipeline silently no-ops via
    its except ImportError branch on every single run."""
    assert compose_path.exists(), f"expected compose file at {compose_path}"

    with open(compose_path) as f:
        compose = yaml.safe_load(f)

    services = compose.get("services", {})
    assert (
        "server" in services
    ), f"{compose_path.name}: no `server` service to compare against"
    assert "worker" in services, f"{compose_path.name}: no `worker` service defined"

    server = services["server"]
    worker = services["worker"]

    if "env_file" in server:
        # The server itself delegates its env to a file we cannot statically
        # inspect (contents are host-local and often gitignored secrets).
        # Forcing a key/value-level assertion here would be dishonest, so
        # the only thing we can verify is that the worker draws from the
        # same file.
        assert worker.get("env_file") == server.get("env_file"), (
            f"{compose_path.name}: `server` sources its environment via "
            f"env_file {server.get('env_file')!r}; `worker` must reference "
            "the same file so it inherits the same DB/secret/edition config."
        )
        return

    server_env = _env_mapping(server)
    worker_env = _env_mapping(worker)

    required = {k for k in server_env if _is_db_or_secret_key(k)}
    assert required, (
        f"{compose_path.name}: expected `server`'s environment to declare "
        "at least one DB/secret key (DATABASE_URL/POSTGRES_*/SECRET_KEY/"
        "ENCRYPTION_KEY) -- if this file's server env format changed, "
        "update the classification patterns above."
    )

    missing = required - set(worker_env.keys())
    assert not missing, (
        f"{compose_path.name}: `worker` is missing DB/secret env vars that "
        f"`server` declares in this same file: {sorted(missing)}"
    )

    assert (
        "AISER_EDITION" in server_env
    ), f"{compose_path.name}: expected `server` to declare AISER_EDITION"
    assert worker_env.get("AISER_EDITION") == server_env.get("AISER_EDITION"), (
        f"{compose_path.name}: `worker`'s AISER_EDITION "
        f"({worker_env.get('AISER_EDITION')!r}) does not match `server`'s "
        f"({server_env.get('AISER_EDITION')!r}) in this same file -- a "
        "mismatched/missing edition makes is_ee_enabled() false in the "
        "worker, so it never loads ee/modules/pipeline."
    )
