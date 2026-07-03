"""MongoDB-backed rate limiter (roadmap §3.7 / P1.8).

Proves the shared fixed-window limiter blocks after the max and that distinct
keys are independent. The shared counter is what makes a multi-instance public
host enforce one effective limit instead of N (one per process).
"""

from __future__ import annotations

import pytest
from app.config import settings
from app.middleware.rate_limiter import check_webhook_rate_limit
from fastapi import HTTPException


async def test_mongodb_limiter_blocks_after_max(seeded, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "RATE_LIMITER_BACKEND", "mongodb")

    for i in range(3):
        remaining = await check_webhook_rate_limit("wh-block", max_requests_per_hour=3)
        assert remaining == 3 - (i + 1)

    with pytest.raises(HTTPException) as exc:
        await check_webhook_rate_limit("wh-block", max_requests_per_hour=3)
    assert exc.value.status_code == 429
    assert exc.value.headers["X-RateLimit-Remaining"] == "0"


async def test_mongodb_limiter_keys_are_independent(
    seeded, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "RATE_LIMITER_BACKEND", "mongodb")

    # Exhaust one key.
    for _ in range(2):
        await check_webhook_rate_limit("wh-a", max_requests_per_hour=2)
    with pytest.raises(HTTPException):
        await check_webhook_rate_limit("wh-a", max_requests_per_hour=2)

    # A different key still has its full allowance.
    remaining = await check_webhook_rate_limit("wh-b", max_requests_per_hour=2)
    assert remaining == 1
