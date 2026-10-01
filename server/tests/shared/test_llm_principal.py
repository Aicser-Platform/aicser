import asyncio

from src.shared.llm_principal import get_llm_principal, set_llm_principal


def test_principal_follows_the_request_and_keeps_its_org():
    async def request():
        set_llm_principal("u1", "org-1")
        set_llm_principal("u1")  # a later user-only set must not drop the verified org
        inner = asyncio.create_task(asyncio.sleep(0, result=get_llm_principal()))
        return await inner

    assert asyncio.run(request()) == ("u1", "org-1")
    assert get_llm_principal() is None  # nothing leaks outside the request
