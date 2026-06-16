"""
Slug validation and composition utilities for scoped resources.

Slugs are URL-safe identifiers used in place of raw UUIDs for
organizations, workspaces, projects, and environments.
Rules:
  - Lowercase only (input is normalized)
  - Alphanumeric characters (a-z, 0-9) and underscores (_)
  - Must NOT start with a digit
  - Must NOT be empty
"""

import re

_SLUG_PATTERN = re.compile(r"^[a-z_][a-z0-9_]*$")


def validate_slug(slug: str) -> str:
    """Validate and normalize a slug string.

    Args:
        slug: Raw slug input (may contain uppercase, spaces, etc.)

    Returns:
        Normalized lowercase slug.

    Raises:
        ValueError: If the slug is empty, contains invalid characters,
            or starts with a digit.
    """
    if not slug or not slug.strip():
        raise ValueError("Slug must not be empty")

    normalized = slug.strip().lower()
    normalized = re.sub(r"[\s_-]+", "_", normalized)

    if not _SLUG_PATTERN.match(normalized):
        raise ValueError(
            f"Invalid slug: {normalized!r}. "
            "Slug must contain only lowercase letters, digits, and underscores; "
            "must not start with a digit."
        )

    return normalized


def compose_slug(prefix: str, name: str) -> str:
    """Compose a scoped slug from a prefix and a resource name.

    Useful for generating predictable slugs like ``org-name/project-name``.

    Args:
        prefix: Parent scope slug (e.g. organization slug).
        name: Resource name to slugify.

    Returns:
        Combined slug in the form ``{prefix_slug}/{name_slug}``.
    """
    prefix_slug = validate_slug(prefix)
    name_slug = validate_slug(name)
    return f"{prefix_slug}/{name_slug}"
