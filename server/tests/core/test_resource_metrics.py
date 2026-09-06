"""Regression test: process/system resource usage (CPU%, memory%, thread
count) is now sampled onto the existing /metrics Prometheus endpoint.

Confirmed gap this closes: prometheus_client's own default ProcessCollector
already registers process_resident_memory_bytes/process_open_fds/
process_cpu_seconds_total (real, but raw/cumulative -- not directly
"how close to the limit" or "is CPU the bottleneck right now"). Nothing
exposed normalized percentages or system/container-wide (not just this
process) usage before this.
"""

import pytest


def test_sample_resource_metrics_never_raises():
    from src.core.resource_metrics import sample_resource_metrics

    sample_resource_metrics()  # Must not raise even if psutil/prometheus_client are unavailable.


def test_resource_gauges_appear_on_metrics_output():
    pytest.importorskip("psutil")
    pytest.importorskip("prometheus_client")
    from prometheus_client import generate_latest

    from src.core.resource_metrics import sample_resource_metrics

    sample_resource_metrics()
    output = generate_latest().decode()

    for metric in (
        "process_cpu_percent",
        "process_memory_percent",
        "process_threads",
        "system_cpu_percent",
        "system_memory_percent",
    ):
        assert metric in output, f"{metric} missing from /metrics output"


def test_no_collision_with_default_process_collector():
    """prometheus_client's built-in ProcessCollector already registers
    process_resident_memory_bytes/process_open_fds/process_cpu_seconds_total
    -- this module must not redefine any of those (DuplicateTimeseries)."""
    pytest.importorskip("prometheus_client")
    import src.core.resource_metrics  # noqa: F401 -- import itself must not raise
