"""
Lightweight litellm shim used for tests/development when the real
litellm package is not available or lacks certain helpers. Provides
async helpers `acompletion` and a minimal response shape compatible
with the code in this repo.
"""
import asyncio
from types import SimpleNamespace

# Compatibility flag settable by callers
drop_params = False


class Message:
    def __init__(self, content: str):
        self.content = content


class Choice:
    def __init__(self, content: str):
        self.message = Message(content)


class Usage:
    def __init__(self, prompt_tokens=0, completion_tokens=0, total_tokens=0):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.total_tokens = total_tokens


class ResponseObj(SimpleNamespace):
    def __init__(self, text: str):
        super().__init__()
        self.choices = [Choice(text)]
        self.usage = Usage()


async def acompletion(**kwargs):
    """Async completion shim. Returns a ResponseObj with supplied prompt echoed.

    Accepts arbitrary kwargs and returns quickly. For streaming usage
    callers should use the returned object's attributes.
    """
    # Create a simple echo of the user content if present
    messages = kwargs.get('messages') or []
    text = ''
    if isinstance(messages, (list, tuple)) and len(messages) > 0:
        # Prefer the last user message
        for m in reversed(messages):
            if isinstance(m, dict) and m.get('role') == 'user':
                text = m.get('content')
                break
        if not text:
            # fallback to join all messages
            text = ' '.join([str(m.get('content')) for m in messages if isinstance(m, dict) and m.get('content')])
    else:
        text = kwargs.get('prompt') or kwargs.get('messages') or ''

    # Simple JSON-friendly placeholder
    if isinstance(text, str) and len(text) > 0:
        out = f"{{\"result\": \"{text.strip()[:500]}\"}}"
    else:
        out = '{"result": "ok"}'

    # simulate small async delay
    await asyncio.sleep(0)
    return ResponseObj(out)


def completion(**kwargs):
    """Sync wrapper for completion that calls the async shim.

    Used by any legacy code that expects a synchronous call.
    """
    loop = None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Running inside async loop - create a task and return a simple object
        coro = acompletion(**kwargs)
        fut = asyncio.ensure_future(coro)

        # Return an object that will be awaited by callers expecting async behavior
        return fut
    else:
        return asyncio.run(acompletion(**kwargs))


def chat(*args, **kwargs):
    """Compatibility alias sometimes expected by tests or older code."""
    return completion(*args, **kwargs)

# Async alias
async def achat(*args, **kwargs):
    return await acompletion(**kwargs)

# Provide attribute-compatible names some callers expect
chat = completion
acompletion_alias = acompletion


