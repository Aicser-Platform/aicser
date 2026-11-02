"""Files given with an Agent task become inputs on any model."""

from __future__ import annotations

import base64

import pytest

from src.modules.agent import attachments as A


@pytest.mark.asyncio
async def test_pdf_is_stored_whole_in_parts(monkeypatch):
    stored = {}

    async def put_artifact(run_id, *, result, tool_name, title=None, preview=None):
        stored.update(result)
        return "result://1"

    async def pdf_text(raw, name):
        return "A" * 4500

    import ee.modules.ai.services.multimodal_ingestion as MI

    monkeypatch.setattr(A.W, "put_artifact", put_artifact)
    monkeypatch.setattr(MI, "_extract_pdf_text", pdf_text)
    note = await A.prepare("r1", [{"type": "pdf", "name": "policy.pdf", "base64": base64.b64encode(b"%PDF").decode()}])
    assert "policy.pdf: 3 part(s) stored as result://1" in note and "read_result" in note
    assert [r["part"] for r in stored["rows"]] == [1, 2, 3]


@pytest.mark.asyncio
async def test_images_and_voice_go_through_chat_ingestion(monkeypatch):
    import ee.modules.ai.services.multimodal_ingestion as MI

    class Ctx:
        text_excerpt = "[Voice transcript: note.webm]\nCompare Q3 with Q2"
        attachment_summaries = ["Voice transcribed: note.webm"]

    async def ingest(atts, litellm_service=None):
        assert [a["name"] for a in atts] == ["note.webm"]
        return Ctx()

    monkeypatch.setattr(MI, "ingest_attachments", ingest)
    note = await A.prepare("r1", [{"type": "voice", "name": "note.webm", "base64": "AAAA"}])
    assert "Compare Q3 with Q2" in note


@pytest.mark.asyncio
async def test_no_attachments_add_nothing():
    assert await A.prepare("r1", []) == ""
