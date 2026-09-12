"""LiteLLM canned help copy must never be treated as analysis, SQL, or a report."""

import os

os.environ.setdefault("AISER_EDITION", "enterprise")

from ee.modules.ai.utils.llm_fallback import is_llm_service_fallback_text


_FALLBACK = """I understand you're looking for data analysis. While I'm experiencing some technical difficulties with my AI service, I can still help you with:

🔍 Data Analysis Guidance:
- Connect your data source using the "Connect Data" button
- Upload CSV files or connect databases

📊 Available Tools:
- Chart Builder with ECharts integration
- SQL query builder
"""


def test_detects_canned_connect_data_fallback():
    assert is_llm_service_fallback_text(_FALLBACK) is True
    assert is_llm_service_fallback_text(_FALLBACK.split("\n")[0]) is True


def test_ignores_real_analysis_copy():
    assert is_llm_service_fallback_text(
        "Revenue grew 12% in Q3, driven by enterprise renewals."
    ) is False
    assert is_llm_service_fallback_text("") is False
    assert is_llm_service_fallback_text(None) is False
