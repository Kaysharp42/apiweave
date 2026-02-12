from app.utils.openapi_import_limits import (
    DEFAULT_FETCH_CONCURRENCY,
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    validate_definition_limit,
    validate_endpoint_limit,
)


def test_validate_definition_limit_returns_none_within_limit():
    assert validate_definition_limit(10, max_definitions=50) is None


def test_validate_definition_limit_returns_message_above_limit():
    message = validate_definition_limit(51, max_definitions=50)
    assert message == "Discovered 51 definitions, which exceeds safety limit (50)."


def test_validate_endpoint_limit_returns_message_above_limit():
    message = validate_endpoint_limit(5001, max_endpoints=5000)
    assert message == "Imported endpoint count exceeded safety limit (5000)."


def test_default_timeout_and_concurrency_are_stable():
    assert DEFAULT_FETCH_TIMEOUT_SECONDS == 20.0
    assert DEFAULT_FETCH_CONCURRENCY == 6
