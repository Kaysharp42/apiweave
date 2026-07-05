"""Desktop-shell token gate — the decision predicate, DB-free."""

from app.main import desktop_request_allowed

TOKEN = "secret-token"


def test_no_token_configured_allows_everything() -> None:
    # Web/Docker deployments leave DESKTOP_UI_TOKEN empty — gate is a no-op.
    assert desktop_request_allowed("GET", "/api/workspaces", "", "")


def test_matching_token_allowed() -> None:
    assert desktop_request_allowed("GET", "/api/workspaces", TOKEN, TOKEN)


def test_missing_or_wrong_token_rejected() -> None:
    assert not desktop_request_allowed("GET", "/api/workspaces", "", TOKEN)
    assert not desktop_request_allowed("POST", "/api/workspaces", "nope", TOKEN)


def test_exempt_paths_bypass_token() -> None:
    # These must stay reachable without the webview token.
    assert desktop_request_allowed("GET", "/health", "", TOKEN)
    assert desktop_request_allowed("POST", "/mcp", "", TOKEN)
    assert desktop_request_allowed("POST", "/mcp/messages", "", TOKEN)
    assert desktop_request_allowed("OPTIONS", "/api/workspaces", "", TOKEN)


def test_mcp_prefix_not_overmatched() -> None:
    # A path merely starting with the letters "mcp" is not the mount.
    assert not desktop_request_allowed("GET", "/mcp-config", "", TOKEN)
    assert not desktop_request_allowed("GET", "/api/mcp", "", TOKEN)
