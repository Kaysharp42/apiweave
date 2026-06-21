"""Secret reference extraction and export value sanitization."""

from __future__ import annotations

from typing import Any

from .constants import _FORBIDDEN_EXPORT_KEYS, _SECRET_REF_RE


def _extract_secret_refs_from_string(value: str) -> list[str]:
    """Extract secret names from ``{{secrets.NAME}}`` placeholders in a string."""
    if not isinstance(value, str):
        return []
    return _SECRET_REF_RE.findall(value)


def _extract_secret_refs_from_struct(data: Any) -> list[str]:
    """Recursively walk a JSON-like structure and collect all secret names."""
    refs: list[str] = []
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, str):
                refs.extend(_extract_secret_refs_from_string(value))
            elif isinstance(value, (dict, list)):
                refs.extend(_extract_secret_refs_from_struct(value))
    elif isinstance(data, list):
        for item in data:
            refs.extend(_extract_secret_refs_from_struct(item))
    return refs


def _sanitize_export_value(data: Any) -> Any:
    """Recursively strip any forbidden keys from export data.

    Raises ValueError if a forbidden key is found — this is a programming
    error that must fail loudly to prevent secret leakage.
    """
    if isinstance(data, dict):
        leaked = _FORBIDDEN_EXPORT_KEYS & set(data.keys())
        if leaked:
            raise ValueError(
                f"Export contains forbidden secret fields: {sorted(leaked)}. "
                "This is a programming error — secret values must never reach the export layer."
            )
        return {k: _sanitize_export_value(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_sanitize_export_value(item) for item in data]
    return data
