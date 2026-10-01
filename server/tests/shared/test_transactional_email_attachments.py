"""Scheduled report emails can carry the dashboard's PDF report as an attachment (SMTP and Resend)."""

import json

from src.shared import transactional_email as T


def test_smtp_message_carries_the_pdf(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self, **k):
            pass

        def login(self, *a):
            pass

        def send_message(self, msg):
            sent["msg"] = msg

    monkeypatch.setattr(T.smtplib, "SMTP", FakeSMTP)
    T._send_sync(["a@example.com"], "Weekly", "See attached", config={"host": "smtp.test", "from": "bot@example.com",
                 "port": 587, "use_tls": True}, attachments=[("Sales - report.pdf", b"%PDF-1.7 test", "application/pdf")])
    parts = [p for p in sent["msg"].iter_attachments()]
    assert len(parts) == 1 and parts[0].get_filename() == "Sales - report.pdf"
    assert parts[0].get_content_type() == "application/pdf" and parts[0].get_content() == b"%PDF-1.7 test"


def test_resend_payload_carries_base64_attachment(monkeypatch):
    captured = {}

    class Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=30):
        captured["payload"] = json.loads(req.data)
        return Resp()

    monkeypatch.setattr(T.urllib.request, "urlopen", fake_urlopen)
    T._send_resend_sync(["a@example.com"], "Weekly", "See attached", config={"api_key": "k", "from": "bot@example.com"},
                        attachments=[("r.pdf", b"PDF", "application/pdf")])
    assert captured["payload"]["attachments"] == [{"filename": "r.pdf", "content": "UERG"}]
