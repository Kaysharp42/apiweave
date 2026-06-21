"""Shared constants for project export/import service."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Regex to extract {{secrets.NAME}} references from arbitrary string values.
_SECRET_REF_RE = re.compile(r"\{\{secrets\.([A-Za-z_][A-Za-z0-9_]*)\}\}")

# Schema version for v2 exports.
SCHEMA_VERSION = "2.0"

# Fields that must NEVER appear in an export bundle — fail-closed if detected.
# These are structural fields from the secret storage layer, NOT user variable names.
# User variable names like "api_key" are sanitized by _sanitize_variables_for_export
# but the key itself is allowed to remain (with a <SECRET> placeholder value).
_FORBIDDEN_EXPORT_KEYS: frozenset[str] = frozenset(
    {
        "ciphertext",
        "privateKey",
        "private_key",
        "plaintext",
        "secretValue",
        "secret_value",
        "encryptedValue",
        "encrypted_value",
        "kek_id",
        "kek",
        "dek",
        "wrapped_dek",
        "hmacSecret",
        "hmac_secret",
    }
)
