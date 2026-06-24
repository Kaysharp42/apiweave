"""
Regression test: register_resources() and register_prompts() must be idempotent.

Without the guard at server.py, FastMCP logs 'Resource already exists' / 'Prompt
already exists' warnings on every reload (e.g. in test runs that re-import the
server module). The fix mirrors the existing _tools_registered guard.
"""

import importlib

import pytest


@pytest.fixture
def _fresh_server_module(monkeypatch):
    """Reset the registration flags so the guards don't short-circuit."""
    import app.mcp.server as server_module

    monkeypatch.setattr(server_module, "_tools_registered", False)
    monkeypatch.setattr(server_module, "_resources_registered", False)
    monkeypatch.setattr(server_module, "_prompts_registered", False)
    yield server_module


@pytest.mark.asyncio
async def test_register_resources_is_idempotent(_fresh_server_module, caplog):
    """Calling register_resources() twice must not raise or log 'already exists'."""
    server_module = _fresh_server_module
    caplog.set_level("WARNING")

    server_module.register_resources()
    server_module.register_resources()

    already_exists = [
        record.message
        for record in caplog.records
        if "already exists" in record.message.lower()
    ]
    assert not already_exists, (
        "register_resources() must be idempotent; got duplicates: "
        f"{already_exists}"
    )


@pytest.mark.asyncio
async def test_register_prompts_is_idempotent(_fresh_server_module, caplog):
    """Calling register_prompts() twice must not raise or log 'already exists'."""
    server_module = _fresh_server_module
    caplog.set_level("WARNING")

    server_module.register_prompts()
    server_module.register_prompts()

    already_exists = [
        record.message
        for record in caplog.records
        if "already exists" in record.message.lower()
    ]
    assert not already_exists, (
        "register_prompts() must be idempotent; got duplicates: "
        f"{already_exists}"
    )


@pytest.mark.asyncio
async def test_register_resources_does_not_re_register_when_guard_set(
    _fresh_server_module,
):
    """When the guard is set, the second call is a no-op (no exception)."""
    server_module = _fresh_server_module
    server_module.register_resources()
    server_module._resources_registered = True
    # Second call should be a no-op.
    server_module.register_resources()
