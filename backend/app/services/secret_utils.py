"""
Secret detection and sanitization utilities.
Centralized so both FastAPI routes and MCP tools use the same logic.
"""
import re
from typing import Any

SECRET_PATTERNS = [
    re.compile(r"bearer\s+[a-zA-Z0-9_\-\.]+", re.IGNORECASE),
    re.compile(r"api[_-]?key", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"password", re.IGNORECASE),
    re.compile(r"sk_live_", re.IGNORECASE),
    re.compile(r"pk_live_", re.IGNORECASE),
]

SECRET_KEY_PATTERNS = [
    re.compile(r"^api[_-]?key$", re.IGNORECASE),
    re.compile(r"^secret$", re.IGNORECASE),
    re.compile(r"^token$", re.IGNORECASE),
    re.compile(r"^password$", re.IGNORECASE),
    re.compile(r"^auth[_-]?", re.IGNORECASE),
    re.compile(r"[_-]?api[_-]?key$", re.IGNORECASE),
    re.compile(r"[_-]?secret$", re.IGNORECASE),
    re.compile(r"[_-]?token$", re.IGNORECASE),
    re.compile(r"[_-]?password$", re.IGNORECASE),
    re.compile(r"^access[_-]?token$", re.IGNORECASE),
    re.compile(r"^refresh[_-]?token$", re.IGNORECASE),
    re.compile(r"^private[_-]?key$", re.IGNORECASE),
    re.compile(r"^client[_-]?secret$", re.IGNORECASE),
]


def is_secret_key(key: str) -> bool:
    """Check if a dictionary key name suggests it holds a secret value."""
    return any(p.search(key) for p in SECRET_KEY_PATTERNS)


def detect_secrets_in_value(value: str) -> bool:
    """Detect if a value might be a secret based on patterns."""
    if not isinstance(value, str):
        return False
    return any(p.search(value) for p in SECRET_PATTERNS)


def sanitize_secrets_in_dict(
    data: dict[str, Any],
    secret_refs: list[str],
    path: str = "",
) -> dict[str, Any]:
    """Recursively replace potential secret values with <SECRET> placeholder.

    Redacts values that match secret patterns AND values whose key names
    suggest they hold secrets (e.g. api_key, token, password).
    """
    if not isinstance(data, dict):
        return data

    sanitized: dict[str, Any] = {}
    for key, value in data.items():
        current_path = f"{path}.{key}" if path else key
        if isinstance(value, dict):
            sanitized[key] = sanitize_secrets_in_dict(value, secret_refs, current_path)
        elif isinstance(value, str):
            if detect_secrets_in_value(value) or is_secret_key(key):
                sanitized[key] = "<SECRET>"
                secret_refs.append(current_path)
            else:
                sanitized[key] = value
        else:
            sanitized[key] = value
    return sanitized


def serialize_document_for_export(document: Any) -> dict[str, Any]:
    """Convert Beanie documents into JSON-safe dictionaries for exports."""
    serialized = document.model_dump(by_alias=True)
    serialized.pop("_id", None)
    serialized.pop("id", None)
    return serialized
