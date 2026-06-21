"""
Custom application exceptions.

These exceptions live in ``app.core`` so all layers (routes, services,
runner, repositories) can raise them without creating cross-layer
dependencies. The ``app.services.exceptions`` module re-exports them
for backward compatibility with existing call sites.
"""

from typing import Any


class ResourceNotFoundError(ValueError):
    """Raised when a requested resource does not exist."""


class ConflictError(ValueError):
    """Raised when an operation conflicts with the current resource state."""


class AuditWriteUnavailableError(RuntimeError):
    """
    Raised when an audit event cannot be written.

    Callers in security-sensitive paths (secret resolution, protected env bypass)
    MUST treat this as a fail-closed signal: abort the operation rather than
    proceeding without an audit trail.
    """


__all__ = [
    "ResourceNotFoundError",
    "ConflictError",
    "AuditWriteUnavailableError",
    "Any",
]
