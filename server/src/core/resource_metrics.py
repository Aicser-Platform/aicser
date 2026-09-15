"""
Process-level hardware resource usage (CPU / memory / threads / FDs), exposed
as Prometheus gauges on the existing /metrics endpoint.

http_request_duration_seconds (middleware.py) and node_timings/
AIQualityMetric already cover throughput, HTTP-layer latency, and
AI-pipeline latency + response precision (grounding/goal-verification).
prometheus_client's own default ProcessCollector (auto-registered on import,
Linux) already exposes process_resident_memory_bytes/process_open_fds/
process_cpu_seconds_total -- so raw process resource data was already on
/metrics, just never surfaced/known. What was genuinely missing: normalized
PERCENTAGES (raw bytes/cumulative CPU-seconds don't answer "are we close to
the container's memory limit" or "is CPU actually the bottleneck right
now" without extra math) and system/container-wide (not just this process)
usage -- both added here, without duplicating what ProcessCollector already
registers.

Pull-based (sampled fresh on each /metrics scrape, not a background poller):
simpler, no extra thread, and avoids ever serving a stale reading.
"""

import logging
import os

logger = logging.getLogger(__name__)

try:
    import psutil
    from prometheus_client import Gauge

    # Deliberately does NOT redefine process_resident_memory_bytes/
    # process_open_fds/process_cpu_seconds_total -- prometheus_client's own
    # ProcessCollector already registers those on import; adding gauges of
    # the same name raises DuplicateTimeseries.
    _PROCESS_CPU_PERCENT = Gauge(
        "process_cpu_percent",
        "Process CPU usage percent, sampled at scrape time (non-blocking, "
        "reflects usage since the previous call/scrape)",
    )
    _PROCESS_MEMORY_PERCENT = Gauge(
        "process_memory_percent",
        "Process memory (RSS) as a percent of total system memory -- "
        "answers 'how close to the limit' where process_resident_memory_bytes alone does not",
    )
    _PROCESS_THREADS = Gauge(
        "process_threads",
        "Number of OS threads in this process",
    )
    _SYSTEM_CPU_PERCENT = Gauge(
        "system_cpu_percent",
        "Host/container-wide CPU usage percent at scrape time (all processes, not just this one)",
    )
    _SYSTEM_MEMORY_PERCENT = Gauge(
        "system_memory_percent",
        "Host/container-wide memory usage percent at scrape time",
    )

    _process = psutil.Process(os.getpid())
    # Prime the non-blocking CPU-percent counter -- its first call always
    # returns 0.0 (no prior sample to diff against); this call happens once
    # at import time so the first real scrape already has a baseline.
    _process.cpu_percent(interval=None)
    psutil.cpu_percent(interval=None)

    _RESOURCE_METRICS_ENABLED = True
except ImportError:
    _RESOURCE_METRICS_ENABLED = False


def sample_resource_metrics() -> None:
    """Refresh the gauges above. Call right before serving /metrics. Never
    raises -- a sampling failure must not break metrics scraping for
    everything else already registered."""
    if not _RESOURCE_METRICS_ENABLED:
        return
    try:
        _PROCESS_CPU_PERCENT.set(_process.cpu_percent(interval=None))
        _PROCESS_MEMORY_PERCENT.set(_process.memory_percent())
        _PROCESS_THREADS.set(_process.num_threads())
        _SYSTEM_CPU_PERCENT.set(psutil.cpu_percent(interval=None))
        _SYSTEM_MEMORY_PERCENT.set(psutil.virtual_memory().percent)
    except Exception as exc:
        logger.debug("Resource metrics sampling skipped: %s", exc)
