from ee.modules.ai.services.residency import effective_host, violation


def test_host_rules_apply_to_providers_without_api_base():
    policy = {"allowed_hosts": ["openrouter.ai"]}
    assert violation(policy, "openrouter", None) is None
    assert violation(policy, "openai", None)  # api.openai.com isn't listed
    assert effective_host("azure", "https://x.openai.azure.com/") == "x.openai.azure.com"


def test_wildcards_and_provider_lists_still_work():
    assert violation({"allowed_hosts": ["*.openai.azure.com"]}, "azure", "https://eu.openai.azure.com") is None
    assert violation({"allowed_providers": ["azure"]}, "openrouter", None)
