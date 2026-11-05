"""A streamed tool-calling answer is rebuilt in arrival order.

litellm stamps each chunk with a wall-clock `created_at` and sorts by it when rebuilding; the stamps
can go backwards, which once scrambled a markdown table in an agent answer ("| Branch 66M |").
"""

import pytest
from litellm.types.utils import Delta, ModelResponseStream, StreamingChoices

from ee.modules.ai.services import litellm_service as LS


def _chunk(text, created_at):
    chunk = ModelResponseStream(id="c1", model="m", choices=[StreamingChoices(index=0, delta=Delta(content=text))])
    chunk._hidden_params["created_at"] = created_at
    return chunk


class _Stream:
    def __init__(self, chunks):
        self._it = iter(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


@pytest.mark.asyncio
async def test_backwards_timestamps_do_not_reorder_the_answer(monkeypatch):
    pieces = ["| Metric | Branch 2 |", " Others |\n", "| Principal | $1.06M |", " $1.12M–$1.66M |"]
    # The third chunk is stamped earlier than the first two (clock went backwards).
    chunks = [_chunk(p, t) for p, t in zip(pieces, [10.0, 10.1, 9.0, 10.3])]

    async def fake_acompletion(**kw):
        assert kw["stream"] is True
        return _Stream(chunks)

    monkeypatch.setattr(LS, "acompletion", fake_acompletion)
    seen = []

    async def on_text(text):
        seen.append(text)

    response = await LS.LiteLLMService._stream_tool_completion({"model": "m", "messages": []}, [], on_text)
    assert response.choices[0].message.content == "".join(pieces)
    assert seen[-1] == "".join(pieces)
