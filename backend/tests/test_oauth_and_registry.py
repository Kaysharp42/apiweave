"""Tests for OAuth AsyncClient timeout and DynamicFunctions registry allowlist.

Covers findings:
- F13: httpx AsyncClient calls must have explicit timeout
- F17: DynamicFunctions registry must match an explicit allowlist
"""

from __future__ import annotations

import ast
import os
from pathlib import Path

from app.runner.dynamic_functions import DynamicFunctions

PROVIDER_REGISTRY_PATH = Path(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "app",
    "auth",
    "provider_registry.py",
).resolve()


# ---------------------------------------------------------------------------
# F13 — OAuth AsyncClient timeout check
# ---------------------------------------------------------------------------


def test_all_oauth_async_clients_have_timeout() -> None:
    """Every AsyncClient() in provider_registry.py must have timeout=10.0.

    Uses AST to parse the source and verify every ``AsyncClient(`` call
    (from httpx) includes a ``timeout`` keyword.  If a new OAuth provider
    is added without a timeout, this test fails.
    """
    source = PROVIDER_REGISTRY_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source)

    offending: list[int] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Name) or node.func.id != "AsyncClient":
            continue
        has_timeout = any(kw.arg == "timeout" for kw in node.keywords if kw.arg is not None)
        if not has_timeout:
            offending.append(node.lineno)

    assert not offending, (
        f"AsyncClient() calls without timeout on lines: {offending}. " "Add timeout=10.0 to each."
    )


# ---------------------------------------------------------------------------
# F17 — DynamicFunctions registry allowlist
# ---------------------------------------------------------------------------


def test_dynamic_functions_registry_matches_allowlist() -> None:
    """DynamicFunctions.get_all_functions() must match the expected allowlist.

    If a developer adds a new function to the registry without also updating
    the allowlist in this test, the test fails, preventing unapproved
    additions.
    """
    expected = {
        "randomString",
        "randomNumber",
        "randomEmail",
        "uuid",
        "timestamp",
        "iso_timestamp",
        "date",
        "futureDate",
        "pastDate",
        "randomChoice",
        "randomAlpha",
        "randomNumeric",
        "randomHex",
    }

    registered = DynamicFunctions.get_all_functions()
    registered_names = {key.split("(")[0] for key in registered}

    assert registered_names == expected, (
        f"Registered names {sorted(registered_names)} do not match "
        f"expected {sorted(expected)}. "
        "If you added a new function, add it to the allowlist in this test."
    )


# ---------------------------------------------------------------------------
# Verify every known function resolves and returns a string
# ---------------------------------------------------------------------------


def test_known_dynamic_functions_resolve() -> None:
    """All 13 known dynamic functions resolve via get_function() and work."""
    function_names: list[str] = [
        "randomString",
        "randomNumber",
        "randomEmail",
        "uuid",
        "timestamp",
        "iso_timestamp",
        "date",
        "futureDate",
        "pastDate",
        "randomChoice",
        "randomAlpha",
        "randomNumeric",
        "randomHex",
    ]

    for name in function_names:
        fn = DynamicFunctions.get_function(name)
        assert fn is not None, f"get_function({name!r}) returned None"

        # Each function should produce a non-empty string result
        result = fn() if name != "randomChoice" else fn("a,b,c")
        assert isinstance(result, str), f"{name}() did not return str, got {type(result)}"
        assert len(result) > 0, f"{name}() returned empty string"
