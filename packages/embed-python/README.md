# aicser-embed

Mint signed, single-use Aicser embed links from your Python server, for embedding a dashboard, chart, or executive report for one of your customers.

```bash
pip install aicser-embed
```

```python
import os
from aicser_embed import sign_embed_url

embed = sign_embed_url(
    base_url="https://api.aicser.com",          # your Aicser API
    api_key=os.environ["AICSER_API_KEY"],        # Settings → API keys; keep it on the server
    dashboard_id="b4b3…",                        # or resource_id=… with scope="chart"|"report"
    locked_filters=[{"field": "tenant_id", "value": customer.id}],
    expires_in_minutes=60,
    allowed_domains=["app.example.com"],
    download="none",                             # "none" | "image" | "data"
)
# Put embed.url in an <iframe>, or hand it to @aicser/embed's getToken.
# Reports: sign_embed_url(..., resource_id="conversationId:messageId", scope="report")
```

- **Locked filters.** Aicser applies them to every query made with the link, so a visitor can't see another customer's rows.
- **Single use.** A link opens once, so mint one per page view. With `@aicser/embed`, return a fresh link's `token` from `getToken` and sessions renew without reloading the page.
- **Errors.** Failures raise `AicserSignError`, which carries `.status`: 401 for a bad key, 402 for a plan without embedding, 404 for an unknown resource.

The package uses only the standard library and supports Python 3.8+.
