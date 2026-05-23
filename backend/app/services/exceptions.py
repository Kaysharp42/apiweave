"""
Custom service-layer exceptions for proper HTTP status mapping.
"""


class ResourceNotFoundError(ValueError):
    """Raised when a requested resource does not exist."""


class ConflictError(ValueError):
    """Raised when an operation conflicts with the current resource state."""
