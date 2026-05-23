"""Datetime normalization helpers for MCP structured output."""
from datetime import UTC, datetime
from typing import Any


def utc_datetime(value: Any) -> datetime:
    """Return a timezone-aware UTC datetime for MCP date-time schema fields."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    raise ValueError("Expected datetime-compatible value")


def optional_utc_datetime(value: Any) -> datetime | None:
    """Return a timezone-aware UTC datetime, preserving None."""
    if value is None:
        return None
    return utc_datetime(value)
