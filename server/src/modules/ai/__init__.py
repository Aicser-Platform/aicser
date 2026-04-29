"""
CE shim: redirect src.modules.ai.* imports to ee/modules/ai/
This allows EE modules that import from src.modules.ai.* to resolve correctly
when the ee/ directory is available in the Docker image.
"""
import os

_ee_ai_path = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "ai")
)

if os.path.isdir(_ee_ai_path):
    __path__ = [_ee_ai_path]
