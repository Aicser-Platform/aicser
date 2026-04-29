import logging
try:
    from prometheus_client import Counter, Gauge
except Exception:
    Counter = None
    Gauge = None

logger = logging.getLogger(__name__)

# Define metric counters if prometheus_client installed; otherwise provide no-op wrappers
if Counter:
    DS_CREATE_COUNTER = Counter('data_sources_created_total', 'Total data sources created')
    DS_UPDATE_COUNTER = Counter('data_sources_updated_total', 'Total data sources updated')
    DS_DELETE_COUNTER = Counter('data_sources_deleted_total', 'Total data sources deleted')
    CONNECTION_TEST_COUNTER = Counter('connection_tests_total', 'Total connection tests attempted', ['result'])
else:
    class _Noop:
        def inc(self, *args, **kwargs):
            return
    DS_CREATE_COUNTER = DS_UPDATE_COUNTER = DS_DELETE_COUNTER = _Noop()
    class _NoopL:
        def labels(self, *args, **kwargs):
            return _Noop()
    CONNECTION_TEST_COUNTER = _NoopL()


