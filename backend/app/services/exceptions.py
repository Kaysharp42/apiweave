"""
Custom service-layer exceptions for proper HTTP status mapping.
"""


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
