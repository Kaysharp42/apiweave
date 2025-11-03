"""
Webhook Rate Limiting Middleware
Prevents abuse by limiting requests per webhook
"""
import time
from typing import Dict, Tuple
from collections import defaultdict
from fastapi import HTTPException, status


class RateLimiter:
    """
    Token bucket rate limiter for webhook endpoints
    
    Uses sliding window algorithm to track request rates per webhook.
    """
    
    def __init__(self):
        # webhook_id -> (request_times: list, last_cleanup: float)
        self._buckets: Dict[str, Tuple[list, float]] = defaultdict(lambda: ([], time.time()))
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
        self,
        webhook_id: str,
        max_requests: int = 100,
        window_seconds: int = 3600
    ) -> Tuple[bool, int, int]:
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


# Global rate limiter instance
_rate_limiter = RateLimiter()


async def check_webhook_rate_limit(
    webhook_id: str,
    max_requests_per_hour: int = 100
) -> None:
    """
    FastAPI dependency for webhook rate limiting
    
    Raises HTTPException if rate limit exceeded.
    
    Usage:
        @router.post("/api/webhooks/workflows/{webhook_id}/execute")
        async def execute_workflow_webhook(
            webhook_id: str,
            _: None = Depends(check_webhook_rate_limit)
        ):
            # Rate-limited request
            pass
    
    Args:
        webhook_id: Webhook ID from URL path
        max_requests_per_hour: Maximum requests allowed per hour (default 100)
        
    Raises:
        HTTPException: 429 if rate limit exceeded
    """
    allowed, remaining, reset_time = _rate_limiter.check_rate_limit(
        webhook_id=webhook_id,
        max_requests=max_requests_per_hour,
        window_seconds=3600
    )
    
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Maximum {max_requests_per_hour} requests per hour.",
            headers={
                "X-RateLimit-Limit": str(max_requests_per_hour),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_time),
                "Retry-After": str(reset_time - int(time.time()))
            }
        )


def get_rate_limit_headers(
    webhook_id: str,
    max_requests_per_hour: int = 100
) -> dict:
    """
    Get current rate limit headers for response
    
    Args:
        webhook_id: Webhook ID
        max_requests_per_hour: Maximum requests allowed per hour
        
    Returns:
        Dictionary of rate limit headers
    """
    _, remaining, reset_time = _rate_limiter.check_rate_limit(
        webhook_id=webhook_id,
        max_requests=max_requests_per_hour,
        window_seconds=3600
    )
    
    return {
        "X-RateLimit-Limit": str(max_requests_per_hour),
        "X-RateLimit-Remaining": str(remaining),
        "X-RateLimit-Reset": str(reset_time)
    }
