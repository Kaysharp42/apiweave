"""
Tests for webhook rate limiting middleware
"""

import time

import pytest
from fastapi import HTTPException

from app.middleware.rate_limiter import (
    RateLimiter,
    check_webhook_rate_limit,
    get_rate_limit_headers,
)


class TestRateLimiter:
    """Tests for RateLimiter class"""

    def test_first_request_allowed(self):
        """Test that first request is always allowed"""
        limiter = RateLimiter()
        allowed, remaining, reset_time = limiter.check_rate_limit("wh-test1", max_requests=100)

        assert allowed is True
        assert remaining == 99  # 100 - 1
        assert reset_time > time.time()

    def test_multiple_requests_allowed(self):
        """Test that multiple requests within limit are allowed"""
        limiter = RateLimiter()
        webhook_id = "wh-test2"
        max_requests = 10

        for i in range(max_requests):
            allowed, remaining, _ = limiter.check_rate_limit(webhook_id, max_requests=max_requests)
            assert allowed is True
            assert remaining == max_requests - i - 1

    def test_rate_limit_exceeded(self):
        """Test that requests are blocked when limit exceeded"""
        limiter = RateLimiter()
        webhook_id = "wh-test3"
        max_requests = 5

        # Use up all allowed requests
        for _ in range(max_requests):
            allowed, _, _ = limiter.check_rate_limit(webhook_id, max_requests=max_requests)
            assert allowed is True

        # Next request should be blocked
        allowed, remaining, _ = limiter.check_rate_limit(webhook_id, max_requests=max_requests)
        assert allowed is False
        assert remaining == 0

    def test_window_sliding(self):
        """Test that old requests expire from the window"""
        limiter = RateLimiter()
        webhook_id = "wh-test4"
        max_requests = 3
        window_seconds = 2  # 2 second window

        # Use up all requests
        for _ in range(max_requests):
            allowed, _, _ = limiter.check_rate_limit(
                webhook_id, max_requests=max_requests, window_seconds=window_seconds
            )
            assert allowed is True

        # Should be blocked now
        allowed, _, _ = limiter.check_rate_limit(
            webhook_id, max_requests=max_requests, window_seconds=window_seconds
        )
        assert allowed is False

        # Wait for window to slide
        time.sleep(2.1)

        # Should be allowed again
        allowed, remaining, _ = limiter.check_rate_limit(
            webhook_id, max_requests=max_requests, window_seconds=window_seconds
        )
        assert allowed is True
        assert remaining == max_requests - 1

    def test_different_webhooks_independent(self):
        """Test that different webhooks have independent rate limits"""
        limiter = RateLimiter()
        webhook_id1 = "wh-test5"
        webhook_id2 = "wh-test6"
        max_requests = 3

        # Use up webhook1's limit
        for _ in range(max_requests):
            allowed, _, _ = limiter.check_rate_limit(webhook_id1, max_requests=max_requests)
            assert allowed is True

        # webhook1 should be blocked
        allowed, _, _ = limiter.check_rate_limit(webhook_id1, max_requests=max_requests)
        assert allowed is False

        # webhook2 should still work
        allowed, remaining, _ = limiter.check_rate_limit(webhook_id2, max_requests=max_requests)
        assert allowed is True
        assert remaining == max_requests - 1

    def test_reset_time_calculation(self):
        """Test that reset time is calculated correctly"""
        limiter = RateLimiter()
        webhook_id = "wh-test7"
        window_seconds = 3600

        before_time = time.time()
        allowed, _, reset_time = limiter.check_rate_limit(
            webhook_id, max_requests=100, window_seconds=window_seconds
        )
        after_time = time.time()

        assert allowed is True
        # Reset time should be approximately current time + window
        # Allow 1-second tolerance for int() truncation in reset_time calculation
        assert reset_time >= before_time + window_seconds - 1
        assert reset_time <= after_time + window_seconds + 1  # Allow 1 second tolerance


class TestCheckWebhookRateLimit:
    """Tests for check_webhook_rate_limit dependency"""

    @pytest.mark.asyncio
    async def test_allowed_request(self):
        """Test that allowed request doesn't raise exception"""
        webhook_id = "wh-test-allowed"

        # Should not raise exception
        await check_webhook_rate_limit(webhook_id, max_requests_per_hour=100)

    @pytest.mark.asyncio
    async def test_rate_limit_exception(self):
        """Test that rate limit exceeded raises 429 exception"""
        webhook_id = "wh-test-blocked"
        max_requests = 2

        # Use up the limit
        for _ in range(max_requests):
            await check_webhook_rate_limit(webhook_id, max_requests_per_hour=max_requests)

        # Next request should raise 429
        with pytest.raises(HTTPException) as exc_info:
            await check_webhook_rate_limit(webhook_id, max_requests_per_hour=max_requests)

        assert exc_info.value.status_code == 429
        assert "Rate limit exceeded" in exc_info.value.detail

        # Check headers
        headers = exc_info.value.headers
        assert headers is not None
        assert "X-RateLimit-Limit" in headers
        assert headers["X-RateLimit-Limit"] == str(max_requests)
        assert headers["X-RateLimit-Remaining"] == "0"
        assert "X-RateLimit-Reset" in headers
        assert "Retry-After" in headers


class TestGetRateLimitHeaders:
    """Tests for get_rate_limit_headers function"""

    def test_headers_format(self):
        """Test that headers are formatted correctly"""
        webhook_id = "wh-test-headers"
        max_requests = 100

        headers = get_rate_limit_headers(webhook_id, max_requests_per_hour=max_requests)

        assert "X-RateLimit-Limit" in headers
        assert headers["X-RateLimit-Limit"] == str(max_requests)
        assert "X-RateLimit-Remaining" in headers
        assert "X-RateLimit-Reset" in headers

    def test_headers_remaining_decreases(self):
        """Test that remaining count decreases with each request"""
        webhook_id = "wh-test-headers-decrease"
        max_requests = 10

        # Create a limiter and use it
        from app.middleware.rate_limiter import _rate_limiter

        # First request
        headers1 = get_rate_limit_headers(webhook_id, max_requests_per_hour=max_requests)
        remaining1 = int(headers1["X-RateLimit-Remaining"])

        # Make an actual rate limit check to consume a request
        _rate_limiter.check_rate_limit(webhook_id, max_requests=max_requests, window_seconds=3600)

        # Second request
        headers2 = get_rate_limit_headers(webhook_id, max_requests_per_hour=max_requests)
        remaining2 = int(headers2["X-RateLimit-Remaining"])

        assert remaining2 < remaining1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
