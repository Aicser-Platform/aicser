"""column_semantic_classifier.ensure_column_classifications_fresh enqueues a
job named "classify_data_source_columns" (src/shared/jobs/tasks.py) via ARQ
on a cache miss. ARQ can only execute a job whose function is listed in
WorkerSettings.functions -- an enqueued-but-unregistered job name just fails
in the worker, silently, and the cache never populates, permanently
serving the heuristic fallback. This confirms the registration is actually
wired up in src/shared/jobs/worker.py.

Skipped in environments without the `arq` package installed (a declared
project dependency -- see requirements.txt / pyproject.toml -- just not
present in every dev sandbox); importing src.shared.jobs.worker requires it.
"""

import pytest

pytest.importorskip("arq")


def test_classify_data_source_columns_is_registered_with_the_arq_worker():
    from src.shared.jobs import tasks, worker

    assert "classify_data_source_columns" in worker._FUNCTIONS_BY_NAME
    assert tasks.classify_data_source_columns in worker._JOB_FUNCTIONS
