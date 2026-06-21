"""Bundle structure validation for schema v2 exports."""

from __future__ import annotations

from typing import Any

from .constants import _FORBIDDEN_EXPORT_KEYS


def _validate_bundle_structure(bundle: dict[str, Any]) -> None:
    """Validate the basic structure of a v2 export bundle."""
    if not isinstance(bundle, dict):
        raise ValueError("Bundle must be a JSON object")

    if "workflows" not in bundle:
        raise ValueError("Invalid bundle: missing 'workflows' key")

    # Check for forbidden fields — secret values must never be in a bundle
    _check_no_secret_values(bundle)


def _check_no_secret_values(data: Any, path: str = "") -> None:
    """Recursively check that no forbidden secret fields exist in the bundle."""
    if isinstance(data, dict):
        found = _FORBIDDEN_EXPORT_KEYS & set(data.keys())
        if found:
            raise ValueError(
                f"Bundle contains forbidden secret field(s) at '{path}': {sorted(found)}. "
                "Schema v2 bundles must never contain secret values or ciphertext."
            )
        for key, value in data.items():
            child_path = f"{path}.{key}" if path else key
            _check_no_secret_values(value, child_path)
    elif isinstance(data, list):
        for idx, item in enumerate(data):
            _check_no_secret_values(item, f"{path}[{idx}]")
