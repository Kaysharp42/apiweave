"""
Upload sandbox — validates that file paths resolve within the configured
UPLOADS_BASE_DIR and enforces the 50 MB size ceiling.

Public API
----------
- UploadSandboxError   – raised on any sandbox violation.
- resolve_upload_path  – validate + resolve a user-supplied path string.
- validate_within_sandbox – check an already-resolved Path against the base dir.
- MAX_UPLOAD_SIZE_BYTES – 50 MB constant (matches executor limit).
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_UPLOAD_SIZE_BYTES: int = 50 * 1024 * 1024  # 50 MB


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------


class UploadSandboxError(Exception):
    """Raised when an upload path violates sandbox constraints."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_uploads_base_dir() -> Path:
    """Return the resolved absolute UPLOADS_BASE_DIR.

    Reads from ``app.config.settings`` when available, falling back to
    ``backend/uploads`` (relative to CWD) so the module is importable even
    before Task 3 lands the setting in config.py.
    """
    try:
        from app.config import settings  # type: ignore[import-untyped]

        raw = getattr(settings, "UPLOADS_BASE_DIR", "uploads")
    except Exception:
        raw = "uploads"

    return Path(raw).resolve()


def _check_pre_resolve(path_str: str) -> None:
    """Defence-in-depth checks *before* ``Path.resolve``.

    Catches obvious traversal attempts and NUL-byte injection that could
    confuse downstream path handling even if ``resolve`` would normalise
    them away.
    """
    # NUL bytes can truncate paths in C-level APIs.
    if "\x00" in path_str:
        raise UploadSandboxError("Path contains NUL byte")

    # Reject any ``..`` segment before resolution.
    parts = Path(path_str).parts
    if ".." in parts:
        raise UploadSandboxError(
            f"Path traversal detected (.. segment): {path_str!r}"
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate_within_sandbox(resolved_path: Path) -> None:
    """Raise :class:`UploadSandboxError` if *resolved_path* is outside the
    configured ``UPLOADS_BASE_DIR``.

    Both paths **must** already be absolute and resolved (no symlinks /
    ``..`` segments).
    """
    base_dir = _get_uploads_base_dir()

    # ``Path.is_relative_to`` is available from Python 3.9+.
    if not resolved_path.is_relative_to(base_dir):
        raise UploadSandboxError(
            f"Path {resolved_path} is outside the uploads sandbox "
            f"({base_dir})"
        )


def resolve_upload_path(
    path_str: str,
    *,
    must_exist: bool = True,
) -> Path:
    """Validate and resolve *path_str* against the upload sandbox.

    Parameters
    ----------
    path_str:
        Raw path string (from user input or workflow variable).
    must_exist:
        When ``True`` (default) the file must exist on disk — mirrors
        ``Path.resolve(strict=True)``.

    Returns
    -------
    Path
        The resolved, absolute path inside the sandbox.

    Raises
    ------
    UploadSandboxError
        On any validation failure (traversal, outside sandbox, size limit,
        missing file).
    """
    # 1. Pre-resolve guards --------------------------------------------------
    _check_pre_resolve(path_str)

    # 2. Resolve to absolute, normalised path --------------------------------
    try:
        resolved = Path(path_str).resolve(strict=must_exist)
    except FileNotFoundError:
        raise UploadSandboxError(f"File not found: {path_str!r}")
    except OSError as exc:
        raise UploadSandboxError(
            f"Invalid path {path_str!r}: {exc}"
        ) from exc

    # 3. Sandbox containment -------------------------------------------------
    validate_within_sandbox(resolved)

    # 4. Must be a regular file (not a directory / device) -------------------
    if must_exist and not resolved.is_file():
        raise UploadSandboxError(f"Path is not a regular file: {resolved}")

    # 5. Size limit ----------------------------------------------------------
    if must_exist:
        file_size = resolved.stat().st_size
        if file_size > MAX_UPLOAD_SIZE_BYTES:
            size_mb = file_size / (1024 * 1024)
            raise UploadSandboxError(
                f"File too large: {size_mb:.1f} MB "
                f"(max {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB)"
            )

    return resolved
