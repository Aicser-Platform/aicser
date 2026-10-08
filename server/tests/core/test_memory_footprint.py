"""
Regression guards for per-process memory on memory-billed hosts (Railway): heavy
ML stacks must not load on import, and staging workers must be able to run small.
"""
import importlib
import subprocess
import sys

import pytest


def test_pii_scrubber_import_does_not_load_presidio():
    # Fresh interpreter: other tests in this process may already have loaded Presidio.
    code = (
        "import sys, src.modules.data.services.pii_scrubber as m; "
        "print('presidio_analyzer' in sys.modules, m._presidio_analyzer is m._UNLOADED)"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.split()[-2:] == ["False", "True"]


def test_pii_scrubber_falls_back_to_regex_when_presidio_unavailable(monkeypatch):
    import src.modules.data.services.pii_scrubber as pii_module

    monkeypatch.setattr(pii_module, "_presidio_analyzer", pii_module._UNLOADED)
    monkeypatch.setattr(pii_module, "_presidio_anonymizer", pii_module._UNLOADED)
    monkeypatch.setattr(pii_module, "_load_presidio", lambda: (None, None))

    assert pii_module._ensure_presidio() is False
    assert pii_module._presidio_analyzer is None
    assert "<EMAIL>" in pii_module.pii_scrubber.scrub_text("contact jane@example.com")


def test_pii_scrubber_loads_presidio_once(monkeypatch):
    import src.modules.data.services.pii_scrubber as pii_module

    calls = []

    def fake_load():
        calls.append(1)
        return None, None

    monkeypatch.setattr(pii_module, "_presidio_analyzer", pii_module._UNLOADED)
    monkeypatch.setattr(pii_module, "_presidio_anonymizer", pii_module._UNLOADED)
    monkeypatch.setattr(pii_module, "_load_presidio", fake_load)
    pii_module._ensure_presidio()
    pii_module._ensure_presidio()
    assert calls == [1]


def test_predictive_deps_check_does_not_import_them(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    from src.core.lifespan import _check_predictive_deps

    for name in ("prophet", "pmdarima", "statsmodels"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    result = _check_predictive_deps()
    assert set(result) == {"prophet", "pmdarima", "statsmodels"}
    for name in ("prophet", "pmdarima", "statsmodels"):
        assert name not in sys.modules


@pytest.fixture
def reload_worker(monkeypatch):
    import src.shared.jobs.worker as worker_module

    def _reload(**env):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return importlib.reload(worker_module)

    yield _reload
    monkeypatch.delenv("ARQ_MAX_JOBS", raising=False)
    monkeypatch.delenv("WORKER_CRONS_ENABLED", raising=False)
    importlib.reload(worker_module)


def test_worker_defaults_keep_crons_and_concurrency(reload_worker):
    worker = reload_worker()
    assert worker.WorkerSettings.max_jobs == 10
    assert "alert_rule_evaluation" in {job.name for job in worker.WorkerSettings.cron_jobs}


def test_worker_crons_disabled_keeps_only_heartbeat(reload_worker):
    worker = reload_worker(WORKER_CRONS_ENABLED="false", ARQ_MAX_JOBS="2")
    assert worker.WorkerSettings.max_jobs == 2
    assert [job.name for job in worker.WorkerSettings.cron_jobs] == ["worker_heartbeat"]


def test_pii_ner_can_be_disabled(monkeypatch):
    import src.modules.data.services.pii_scrubber as pii_module

    monkeypatch.setenv("AISER_PII_NER", "false")
    assert pii_module._load_presidio() == (None, None)
