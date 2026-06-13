"""
Secret detection and sanitization utilities.
Centralized so both FastAPI routes and MCP tools use the same logic.
"""
import re
from typing import Any

# ---------------------------------------------------------------------------
# Value-level patterns (used by detect_secrets_in_value for callers that
# need heuristic value detection — kept for backward compatibility).
# ---------------------------------------------------------------------------
SECRET_PATTERNS = [
    re.compile(r"bearer\s+[a-zA-Z0-9_\-\.]+", re.IGNORECASE),
    re.compile(r"api[_-]?key", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"password", re.IGNORECASE),
    re.compile(r"sk_live_", re.IGNORECASE),
    re.compile(r"pk_live_", re.IGNORECASE),
]

# ---------------------------------------------------------------------------
# Key-name patterns — used to decide whether a dict key *holds* a secret.
# These are intentionally scoped to key names, not values, to avoid
# over-redacting non-secret data (e.g. request-token-ids).
# ---------------------------------------------------------------------------
SECRET_KEY_PATTERNS = [
    # Exact matches
    re.compile(r"^api[_-]?key$", re.IGNORECASE),
    re.compile(r"^secret$", re.IGNORECASE),
    re.compile(r"^token$", re.IGNORECASE),
    re.compile(r"^password$", re.IGNORECASE),
    re.compile(r"^authorization$", re.IGNORECASE),
    # Prefix: auth_*
    re.compile(r"^auth[_-]", re.IGNORECASE),
    # Suffix: *_api_key
    re.compile(r"[_-]?api[_-]?key$", re.IGNORECASE),
    # Suffix: *_secret
    re.compile(r"[_-]?secret$", re.IGNORECASE),
    # Suffix: *_token
    re.compile(r"[_-]?token$", re.IGNORECASE),
    # Suffix: *_password
    re.compile(r"[_-]?password$", re.IGNORECASE),
    # Compound exact
    re.compile(r"^access[_-]?token$", re.IGNORECASE),
    re.compile(r"^refresh[_-]?token$", re.IGNORECASE),
    re.compile(r"^private[_-]?key$", re.IGNORECASE),
    re.compile(r"^client[_-]?secret$", re.IGNORECASE),
    # --- New patterns (security-remediation wave 1) ---
    # Suffix: *_key (requires separator to avoid "monkey", "donkey", etc.)
    re.compile(r"[_-]key$", re.IGNORECASE),
    # Suffix: *_auth
    re.compile(r"[_-]auth$", re.IGNORECASE),
    # Suffix: *_credential / *_credentials
    re.compile(r"[_-]credential[s]?$", re.IGNORECASE),
    # Suffix: *_private_key
    re.compile(r"[_-]private[_-]key$", re.IGNORECASE),
    # Suffix: *_client_secret
    re.compile(r"[_-]client[_-]secret$", re.IGNORECASE),
]

# Masking placeholder used by structural masking and log masking.
REDACTED = "<REDACTED>"

# Legacy placeholder used by sanitize_secrets_in_dict (backward compat).
SECRET_PLACEHOLDER = "<SECRET>"


def is_secret_key(key: str) -> bool:
    """Check if a dictionary key name suggests it holds a secret value."""
    return any(p.search(key) for p in SECRET_KEY_PATTERNS)


def detect_secrets_in_value(value: str) -> bool:
    """Detect if a value might be a secret based on patterns.

    .. deprecated::
        This heuristic over-matches (e.g. any string containing "token").
        Prefer key-name detection via :func:`is_secret_key` or explicit
        secret-value masking via :func:`mask_secrets_structural`.
        Kept for backward compatibility with existing callers.
    """
    if not isinstance(value, str):
        return False
    return any(p.search(value) for p in SECRET_PATTERNS)


def sanitize_secrets_in_dict(
    data: dict[str, Any],
    secret_refs: list[str],
    path: str = "",
) -> dict[str, Any]:
    """Recursively replace potential secret values with <SECRET> placeholder.

    Uses **key-name detection only** — values whose key names match
    ``SECRET_KEY_PATTERNS`` are redacted.  Over-broad value heuristics
    (e.g. any string containing "bearer" or "token") have been removed
    to prevent false positives on non-secret data like request IDs.
    """
    if not isinstance(data, dict):
        return data

    sanitized: dict[str, Any] = {}
    for key, value in data.items():
        current_path = f"{path}.{key}" if path else key
        if isinstance(value, dict):
            sanitized[key] = sanitize_secrets_in_dict(value, secret_refs, current_path)
        elif isinstance(value, str):
            if is_secret_key(key):
                sanitized[key] = SECRET_PLACEHOLDER
                secret_refs.append(current_path)
            else:
                sanitized[key] = value
        else:
            sanitized[key] = value
    return sanitized


# ---------------------------------------------------------------------------
# Structural masking (security-remediation wave 1)
# ---------------------------------------------------------------------------

def _replace_longest_first(text: str, secret_values: list[str]) -> str:
    """Replace all occurrences of *secret_values* in *text*, longest first.

    Longest-first ordering prevents prefix collisions — e.g. if secrets
    are ``"a"`` and ``"abc"``, replacing ``"abc"`` first ensures the
    shorter secret doesn't partially mask the longer one.
    """
    for secret in sorted(secret_values, key=len, reverse=True):
        if secret:  # skip empty strings
            text = text.replace(secret, REDACTED)
    return text


def mask_log_value(value: str, secret_values: list[str]) -> str:
    """Mask secret values in a log string.

    Returns ``<REDACTED>`` if *value* exactly matches any secret,
    otherwise performs longest-first exact-value replacement.

    Parameters
    ----------
    value:
        The string to mask (e.g. a log message or header value).
    secret_values:
        List of known secret values to mask.
    """
    if not isinstance(value, str):
        return value
    if not secret_values:
        return value
    # Exact match → full redaction
    if value in secret_values:
        return REDACTED
    return _replace_longest_first(value, secret_values)


def mask_secrets_structural(
    data: Any,
    secret_values: list[str],
) -> Any:
    """Walk a dict/list/str structure and mask secrets by two mechanisms:

    1. **Key-name match** — if a dict key matches ``SECRET_KEY_PATTERNS``,
       its value is replaced with ``<REDACTED>`` regardless of content.
    2. **Exact-value replacement** — string values have all known
       *secret_values* replaced (longest first to avoid prefix collisions).

    Recurses into nested dicts and lists.

    Parameters
    ----------
    data:
        Arbitrary JSON-like structure (dict, list, str, int, etc.).
    secret_values:
        List of known secret values to search for in string content.

    Returns
    -------
    The masked structure (same shape as input).
    """
    if isinstance(data, dict):
        return {
            k: (
                REDACTED
                if is_secret_key(k)
                else mask_secrets_structural(v, secret_values)
            )
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [mask_secrets_structural(item, secret_values) for item in data]
    if isinstance(data, str):
        if not secret_values:
            return data
        return _replace_longest_first(data, secret_values)
    return data


def serialize_document_for_export(document: Any) -> dict[str, Any]:
    """Convert Beanie documents into JSON-safe dictionaries for exports."""
    serialized = document.model_dump(by_alias=True)
    serialized.pop("_id", None)
    serialized.pop("id", None)
    return serialized
