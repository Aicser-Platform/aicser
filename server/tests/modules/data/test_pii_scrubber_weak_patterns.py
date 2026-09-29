"""Codes like customer or product ids aren't driver's licences unless the text says so."""

import pytest

from src.modules.data.services import pii_scrubber as P

pytestmark = pytest.mark.skipif(P._presidio_analyzer is None, reason="Presidio not installed")


def test_bare_codes_are_kept():
    for code in ["C0012", "SKU A1234567", "Order B998877 shipped"]:
        assert "DRIVER_LICENSE" not in P.pii_scrubber.scrub_text(code), code


def test_licence_with_context_is_still_masked():
    out = P.pii_scrubber.scrub_text("My driver's license number is D1234567 issued in CA")
    assert "D1234567" not in out
