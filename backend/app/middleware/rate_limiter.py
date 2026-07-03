"""
Webhook Rate Limiting Middleware
Prevents abuse by limiting requests per webhook
"""

import time
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import HTTPException, status

from app.config import settings


class RateLimiter:
    """
    Token bucket rate limiter for webhook endpoints

    Uses sliding window algorithm to track request rates per webhook.
    """

    def __init__(self):
        # webhook_id -> (request_times: list, last_cleanup: float)
        self._buckets: dict[str, tuple[list, float]] = defaultdict(lambda: ([], time.time()))
        self._cleanup_interval = 3600  # Clean old entries every hour

    def _cleanup_old_buckets(self):
        """Remove buckets that haven't been used in over an hour"""
        current_time = time.time()
        to_remove = []

        for webhook_id, (_, last_cleanup) in self._buckets.items():
            if current_time - last_cleanup > self._cleanup_interval:
                to_remove.append(webhook_id)

        for webhook_id in to_remove:
            del self._buckets[webhook_id]

    def check_rate_limit(
        self, webhook_id: str, max_requests: int = 100, window_seconds: int = 3600
    ) -> tuple[bool, int, int]:
        """
        Check if request is within rate limit

        Args:
            webhook_id: Webhook identifier
            max_requests: Maximum requests allowed in window (default 100)
            window_seconds: Time window in seconds (default 3600 = 1 hour)

        Returns:
            Tuple of (allowed: bool, remaining: int, reset_time: int)
            - allowed: Whether request should be allowed
            - remaining: Number of requests remaining in window AFTER this request
            - reset_time: Unix timestamp when rate limit resets
        """
        current_time = time.time()
        cutoff_time = current_time - window_seconds

        # Get or create bucket
        request_times, _ = self._buckets[webhook_id]

        # Remove old requests outside the window
        request_times[:] = [t for t in request_times if t > cutoff_time]

        # Update last cleanup time
        self._buckets[webhook_id] = (request_times, current_time)

        # Check if limit exceeded
        current_count = len(request_times)
        allowed = current_count < max_requests

        # Calculate reset time (when oldest request expires)
        if request_times:
            oldest_request = min(request_times)
            reset_time = int(oldest_request + window_seconds)
        else:
            reset_time = int(current_time + window_seconds)

        if allowed:
            # Add current request to bucket
            request_times.append(current_time)
            # Remaining AFTER adding this request
            remaining = max(0, max_requests - len(request_times))
        else:
            # Request blocked, remaining is 0
            remaining = 0

        # Periodic cleanup
        if current_time - self._buckets[webhook_id][1] > 300:  # Every 5 minutes
            self._cleanup_old_buckets()

        return allowed, remaining, reset_time


# Global rate limiter instance.
# This store is in-memory and process-local; a server restart clears all buckets.
_rate_limiter = RateLimiter()


async def _check_rate_limit_mongodb(
    key: str, max_requests: int, window_seconds: int
) -> tuple[bool, int, int]:
    """Shared fixed-window limiter backed by MongoDB (atomic across instances).

    Atomically increments the per-(key, window) counter and decides from the
    resulting count, so concurrent requests across API instances share one
    effective limit. Returns (allowed, remaining, reset_time).
    """
    from beanie.odm.operators.update.general import Inc

    from app.models import RateLimitCounter

    now = int(time.time())
    window_start = now - (now % window_seconds)
    reset_time = window_start + window_seconds

    # Atomic increment-or-create for this (key, window). On insert the counter
    # starts at 1; on a matching window it is incremented. Re-read for the count
    # (a concurrent increment from another instance only makes us stricter, which
    # is the safe direction for a limiter).
    await RateLimitCounter.find_one(
        RateLimitCounter.key == key,
        RateLimitCounter.windowStart == window_start,
    ).upsert(
        Inc({RateLimitCounter.hits: 1}),
        on_insert=RateLimitCounter(
            key=key,
            windowStart=window_start,
            hits=1,
            expires_at=datetime.fromtimestamp(reset_time + window_seconds, tz=UTC),
        ),
    )
    doc = await RateLimitCounter.find_one(
        RateLimitCounter.key == key,
        RateLimitCounter.windowStart == window_start,
    )
    count = doc.hits if doc else 1
    allowed = count <= max_requests
    remaining = max(0, max_requests - count)
    return allowed, remaining, reset_time


async def check_webhook_rate_limit(webhook_id: str, max_requests_per_hour: int = 100) -> int:
    """
    FastAPI dependency for webhook rate limiting.

    Returns remaining request count for downstream header generation.
    Raises HTTPException if rate limit exceeded. The backend (process-local
    memory vs. shared MongoDB) is selected by RATE_LIMITER_BACKEND.
    """
    if settings.get_rate_limiter_backend() == "mongodb":
        allowed, remaining, reset_time = await _check_rate_limit_mongodb(
            key=f"webhook:{webhook_id}",
            max_requests=max_requests_per_hour,
            window_seconds=3600,
        )
    else:
        allowed, remaining, reset_time = _rate_limiter.check_rate_limit(
            webhook_id=webhook_id, max_requests=max_requests_per_hour, window_seconds=3600
        )

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Maximum {max_requests_per_hour} requests per hour.",
            headers={
                "X-RateLimit-Limit": str(max_requests_per_hour),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_time),
                "Retry-After": str(reset_time - int(time.time())),
            },
        )

    return remaining


def get_rate_limit_headers(
    webhook_id: str,
    max_requests_per_hour: int = 100,
    remaining: int | None = None,
) -> dict:
    """
    Read-only rate limit headers for the response.

    Must NOT call check_rate_limit — that would consume an extra slot.
    When `remaining` is provided from the dependency, use it directly.
    """
    current_time = time.time()
    window_seconds = 3600
    cutoff_time = current_time - window_seconds
    request_times, _ = _rate_limiter._buckets.get(webhook_id, ([], current_time))
    active_times = [t for t in request_times if t > cutoff_time]

    if remaining is not None:
        remaining = max(0, remaining)
    else:
        remaining = max(0, max_requests_per_hour - len(active_times))

    reset_time = (
        int(min(active_times) + window_seconds)
        if active_times
        else int(current_time + window_seconds)
    )

    return {
        "X-RateLimit-Limit": str(max_requests_per_hour),
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Reset": str(reset_time),
    }
