from app.utils.swagger_discovery import (
    build_swagger_config_candidates,
    extract_definitions_from_swagger_config,
    extract_swagger_ui_hints_from_html,
    make_definition_scope,
    parse_swagger_ui_query_hints,
)


def test_parse_swagger_ui_query_hints_extracts_primary_name_and_overrides():
    url = (
        "https://example.internal/webjars/swagger-ui/index.html"
        "?configUrl=/v3/api-docs/swagger-config&urls.primaryName=Asset+Service"
    )
    hints = parse_swagger_ui_query_hints(url)

    assert hints["configUrl"] == "/v3/api-docs/swagger-config"
    assert hints["primaryName"] == "Asset Service"
    assert hints["url"] is None


def test_extract_swagger_ui_hints_from_html_parses_inline_config_values():
    html = """
    <script>
      window.ui = SwaggerUIBundle({
        configUrl: '/v3/api-docs/swagger-config',
        urls: [
          {name: 'Asset Service', url: '/v3/api-docs/asset-service'},
          {name: 'Order Service', url: '/v3/api-docs/order-service'}
        ],
        url: '/v3/api-docs'
      });
    </script>
    """

    hints = extract_swagger_ui_hints_from_html(html)

    assert hints["configUrl"] == "/v3/api-docs/swagger-config"
    assert hints["url"] == "/v3/api-docs"
    assert len(hints["urls"]) == 2
    assert hints["urls"][0]["name"] == "Asset Service"
    assert hints["urls"][1]["url"] == "/v3/api-docs/order-service"


def test_build_swagger_config_candidates_includes_prefix_aware_defaults():
    swagger_ui_url = "https://example.internal/core/webjars/swagger-ui/index.html"
    query_hints = {"configUrl": None, "url": None, "primaryName": None}
    html_hints = {"configUrl": None, "url": None, "urls": []}

    candidates = build_swagger_config_candidates(swagger_ui_url, query_hints, html_hints)

    assert "https://example.internal/core/v3/api-docs/swagger-config" in candidates
    assert "https://example.internal/v3/api-docs/swagger-config" in candidates


def test_extract_definitions_from_swagger_config_resolves_relative_urls():
    config = {
        "urls": [
            {"name": "Asset Service", "url": "/v3/api-docs/asset-service"},
            {"name": "Order Service", "url": "v3/api-docs/order-service"},
        ],
        "urls.primaryName": "Asset Service",
    }
    config_url = "https://example.internal/webjars/swagger-ui/swagger-config"

    extracted = extract_definitions_from_swagger_config(config, config_url)

    assert extracted["primaryName"] == "Asset Service"
    assert len(extracted["definitions"]) == 2
    assert (
        extracted["definitions"][0]["specUrl"]
        == "https://example.internal/v3/api-docs/asset-service"
    )
    assert (
        extracted["definitions"][1]["specUrl"]
        == "https://example.internal/webjars/swagger-ui/v3/api-docs/order-service"
    )


def test_make_definition_scope_creates_stable_slug():
    scope = make_definition_scope(
        "Asset Service v2", "https://example.internal/v3/api-docs/asset-service"
    )
    assert scope == "asset-service-v2"
