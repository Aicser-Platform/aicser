from src.modules.data.services.semantic_context_service import describe_metric_format


def test_formats_are_read_out_for_ask():
    assert describe_metric_format("currency:USD:2") == "currency USD"
    assert describe_metric_format("percent:1").startswith("a percentage")
    assert describe_metric_format("integer") == "a whole number"
    assert describe_metric_format(None) is None and describe_metric_format("number:2") is None
