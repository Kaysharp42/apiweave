"""Webhook protected-environment deny path (roadmap §3.3 / P2.4).

A webhook hitting a protected environment with a token that cannot bypass must
be denied (no run enqueued), and the placeholder approval cleaned up — instead
of the old behavior where the gate result was ignored and the run ran anyway.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.routes import webhooks as webhooks_route
from fastapi import HTTPException


async def test_denies_when_gated_and_not_bypassed(monkeypatch: pytest.MonkeyPatch) -> None:
    rejected: dict[str, str] = {}

    async def fake_reject(approval_id: str, token_id: str, *args, **kwargs) -> None:
        rejected["approval_id"] = approval_id
        rejected["token_id"] = token_id

    monkeypatch.setattr(webhooks_route, "reject_gate_record", fake_reject)

    record = SimpleNamespace(approvalId="appr-1")
    with pytest.raises(HTTPException) as exc:
        await webhooks_route._deny_gated_webhook("pending_approval", record, None, "tok-1")

    assert exc.value.status_code == 403
    assert rejected == {"approval_id": "appr-1", "token_id": "tok-1"}


async def test_allows_when_bypassed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail(*a, **k):
        raise AssertionError("should not reject when bypassed")

    monkeypatch.setattr(webhooks_route, "reject_gate_record", fail)
    record = SimpleNamespace(approvalId="appr-1")
    # bypass_reason set => proceed (no raise)
    await webhooks_route._deny_gated_webhook("pending_approval", record, "bypassed", "tok-1")


async def test_allows_when_not_gated(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail(*a, **k):
        raise AssertionError("should not reject when unprotected")

    monkeypatch.setattr(webhooks_route, "reject_gate_record", fail)
    # proceed => no raise
    await webhooks_route._deny_gated_webhook("proceed", None, None, "tok-1")
