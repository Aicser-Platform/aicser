# Legacy root-level pytest targets

Default `poetry run pytest` collects only `app/tests/` (see `pyproject.toml` `[tool.pytest.ini_options] testpaths`).

The deprecated **RobustMultiAgentOrchestrator** integration scripts at the server root are kept for manual runs only:

```bash
cd packages/chat2chart/server
PYTHONPATH=. poetry run pytest test_robust_multi_agent.py test_aiser_integration.py -v
```

Production workflows are covered by LangGraph tests under `app/tests/`.
