"""Python backend for the demo host app: signs embed links with aicser-embed (PyPI).

Standard library only besides the SDK under test. Serves the same web page as the Node backend;
the browser SDK (@aicser/embed, npm) comes from jsDelivr since there is no node_modules here.
"""

from __future__ import annotations

import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import aicser_embed
from aicser_embed import AicserSignError, sign_embed_url

HERE = Path(__file__).resolve().parent
WEB_DIR = (HERE.parent / "web").resolve()


def _load_dotenv(path: Path) -> None:
    """KEY=value lines from ../.env, without overriding the real environment."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv(HERE.parent / ".env")


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def env_list(name: str) -> list:
    return [s.strip() for s in env(name).split(",") if s.strip()]


PORT = int(env("PORT", "4001"))
API_URL = env("AICSER_API_URL", "http://localhost:8001")
APP_URL = env("AICSER_APP_URL", "http://localhost:3001")
API_KEY = env("AICSER_API_KEY")
DASHBOARD_ID = env("AICSER_DASHBOARD_ID")
CHART_ID = env("AICSER_CHART_ID")
ASSISTANT_ID = env("AICSER_ASSISTANT_ID")
CHAT_TOKEN = env("AICSER_CHAT_TOKEN")
LOCKED_FILTER_FIELD = env("LOCKED_FILTER_FIELD")
CUSTOMERS = env_list("CUSTOMERS") or ["acme"]
ALLOWED_DOMAINS = env_list("ALLOWED_DOMAINS")
DOWNLOAD = env("DOWNLOAD", "image")
EXPIRES_IN_MINUTES = int(env("EXPIRES_IN_MINUTES", "60"))
SDK_JS_VERSION = env("SDK_JS_VERSION", "0.3.2")


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _file(self, rel: str) -> None:
        file = (WEB_DIR / rel).resolve()
        if WEB_DIR not in file.parents or not file.is_file():
            return self._json(404, {"error": "Not found"})
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        path = urlparse(self.path).path
        if path == "/api/config":
            return self._json(200, {
                "backend": "Python",
                "signer": f"aicser-embed {aicser_embed.__version__} (PyPI)",
                "appUrl": APP_URL,
                "dashboardId": DASHBOARD_ID,
                "chartId": CHART_ID,
                # A chat token is a public link (it ends up in the iframe URL), so it can go to the browser.
                "assistantId": ASSISTANT_ID,
                "chatToken": CHAT_TOKEN,
                "customers": CUSTOMERS,
                "lockedFilterField": LOCKED_FILTER_FIELD,
            })
        if path.startswith("/sdk/"):
            self.send_response(302)
            self.send_header(
                "Location",
                f"https://cdn.jsdelivr.net/npm/@aicser/embed@{SDK_JS_VERSION}/dist/{path[len('/sdk/'):]}",
            )
            self.end_headers()
            return None
        return self._file("index.html" if path == "/" else path.lstrip("/"))

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/api/embed-token":
            return self._json(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        return self._embed_token(body)

    def _embed_token(self, body: dict) -> None:
        """In your app this sits behind your own login: the customer (and so the locked filter)
        comes from the signed-in user's session, never from the request. The picker stands in."""
        customer = body.get("customer")
        if customer not in CUSTOMERS:
            return self._json(403, {"error": "Unknown customer"})
        scope = "chart" if body.get("scope") == "chart" else "dashboard"
        try:
            embed = sign_embed_url(
                base_url=API_URL,
                api_key=API_KEY,
                scope=scope,
                resource_id=CHART_ID if scope == "chart" else DASHBOARD_ID,
                locked_filters=[{"field": LOCKED_FILTER_FIELD, "value": customer}] if LOCKED_FILTER_FIELD else [],
                expires_in_minutes=EXPIRES_IN_MINUTES,
                allowed_domains=ALLOWED_DOMAINS,
                download=DOWNLOAD,
            )
        except AicserSignError as exc:
            print(f"sign failed ({exc.status}): {exc}")
            return self._json(exc.status, {"error": str(exc)})
        except OSError as exc:  # Aicser unreachable
            return self._json(502, {"error": f"Could not reach Aicser at {API_URL}: {exc}"})
        return self._json(200, {"token": embed.token, "expiresAt": embed.expires_at})

    def log_message(self, fmt: str, *args) -> None:
        if not str(args[0]).startswith("GET /sdk/"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    if not API_KEY:
        print("AICSER_API_KEY is not set — signing will fail.")
    print(f"Python demo (aicser-embed {aicser_embed.__version__}) on http://localhost:{PORT}")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
