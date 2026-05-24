"""
Webhook Idempotency Cache
In-memory store for deduplicating webhook executions within a 24-hour window.

Cache key: (webhookId, idempotency_key) — scoped to prevent cross-webhook collisions.
TTL: 86400 seconds (24 hours), lazy eviction on lookup.
"""
import time
from dataclasses import dataclass, field
from typing import Optional

_TTL_SECONDS = 86400  # 24 hours
_CLEANUP_EVERY_N = 1000  # sweep every N lookups
_lookup_counter = 0

_idempotency_cache: dict[tuple[str, str], "IdempotencyEntry"] = {}


@dataclass
class IdempotencyEntry:
    run_id: str
    collection_run_id: Optional[str]
    timestamp: float
    status_code: int
    response_body: dict


def _is_expired(entry: IdempotencyEntry) -> bool:
    return (time.time() - entry.timestamp) > _TTL_SECONDS


def _sweep_expired() -> None:
    """Remove all expired entries from the cache."""
    expired_keys = [k for k, v in _idempotency_cache.items() if _is_expired(v)]
    for k in expired_keys:
        del _idempotency_cache[k]


def get_idempotency_entry(webhook_id: str, idempotency_key: str) -> Optional[IdempotencyEntry]:
    """
    Look up a cached idempotency entry.

    Returns the entry if it exists and is within TTL, otherwise None.
    Performs periodic sweep to evict stale entries.
    """
    global _lookup_counter
    _lookup_counter += 1

    if _lookup_counter % _CLEANUP_EVERY_N == 0:
        _sweep_expired()

    cache_key = (webhook_id, idempotency_key)
    entry = _idempotency_cache.get(cache_key)

    if entry is None:
        return None

    if _is_expired(entry):
        del _idempotency_cache[cache_key]
        return None

    return entry


def store_idempotency_entry(
    webhook_id: str,
    idempotency_key: str,
    run_id: str,
    collection_run_id: Optional[str],
    status_code: int,
    response_body: dict,
) -> IdempotencyEntry:
    """
    Store a new idempotency entry after a successful run creation.

    Returns the stored entry.
    """
    entry = IdempotencyEntry(
        run_id=run_id,
        collection_run_id=collection_run_id,
        timestamp=time.time(),
        status_code=status_code,
        response_body=response_body,
    )
    _idempotency_cache[(webhook_id, idempotency_key)] = entry
    return entry
