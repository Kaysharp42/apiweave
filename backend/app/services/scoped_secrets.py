"""
Per-scope Libsodium keypair management for GitHub-style secret encryption.

Each scope (user, organization, workspace, environment) gets its own
Curve25519 keypair.  The public key is served to clients so they can
encrypt secret values with ``crypto_box_seal`` (anonymous sender sealed
box).  The private key is encrypted at rest using AES-256-GCM with the
master KEK derived from ``SECRET_ENCRYPTION_KEY``.

Key rotation creates a new active keypair while retaining old inactive
keypairs so that previously encrypted ciphertexts remain decryptable.
"""

from __future__ import annotations

import base64
import logging
import secrets
import time
from datetime import UTC, datetime

from nacl.public import PrivateKey

from app.models import PublicKeyResponse, ScopedKeypair
from app.services.secret_kek import get_master_key, unwrap_dek, wrap_dek

logger = logging.getLogger(__name__)

_ALGORITHM = "libsodium-sealed-box"
_NONCE_SIZE = 12


def _encrypt_private_key(private_key_bytes: bytes) -> str:
    master_key = get_master_key()
    wrapped = wrap_dek(private_key_bytes, master_key)
    return base64.urlsafe_b64encode(wrapped).decode("ascii")


def _decrypt_private_key(encrypted_b64: str) -> bytes:
    master_key = get_master_key()
    wrapped = base64.urlsafe_b64decode(encrypted_b64)
    return unwrap_dek(wrapped, master_key)


def _generate_key_id() -> str:
    return f"kp-{int(time.time())}-{secrets.token_hex(4)}"


async def get_or_create_keypair(
    scope_type: str,
    scope_id: str,
) -> ScopedKeypair:
    """Return the active keypair for a scope, creating one if absent."""
    active = await ScopedKeypair.find_one(
        ScopedKeypair.scopeType == scope_type,
        ScopedKeypair.scopeId == scope_id,
        ScopedKeypair.isActive == True,  # noqa: E712
    )
    if active is not None:
        return active

    private_key = PrivateKey.generate()
    public_key_b64 = base64.b64encode(private_key.public_key.encode()).decode("ascii")
    encrypted_priv = _encrypt_private_key(private_key.encode())
    key_id = _generate_key_id()
    now = datetime.now(UTC)

    doc = ScopedKeypair(
        scopeType=scope_type,
        scopeId=scope_id,
        publicKey=public_key_b64,
        privateKey=encrypted_priv,
        algorithm=_ALGORITHM,
        keyId=key_id,
        isActive=True,
        createdAt=now,
    )
    await doc.insert()
    logger.info("Created keypair %s for %s:%s", key_id, scope_type, scope_id)
    return doc


async def get_public_key(
    scope_type: str,
    scope_id: str,
) -> PublicKeyResponse:
    """Return the public key metadata for a scope."""
    keypair = await get_or_create_keypair(scope_type, scope_id)
    return PublicKeyResponse(
        keyId=keypair.keyId,
        publicKey=keypair.publicKey,
        algorithm=keypair.algorithm,
    )


async def rotate_keypair(
    scope_type: str,
    scope_id: str,
) -> PublicKeyResponse:
    """Rotate the keypair for a scope.

    Marks the current active keypair as inactive and creates a new one.
    Old keypairs remain in the database for decrypting legacy ciphertexts.
    """
    now = datetime.now(UTC)

    active = await ScopedKeypair.find_one(
        ScopedKeypair.scopeType == scope_type,
        ScopedKeypair.scopeId == scope_id,
        ScopedKeypair.isActive == True,  # noqa: E712
    )
    if active is not None:
        active.isActive = False
        active.rotatedAt = now
        await active.save()
        logger.info(
            "Deactivated keypair %s for %s:%s",
            active.keyId,
            scope_type,
            scope_id,
        )

    private_key = PrivateKey.generate()
    public_key_b64 = base64.b64encode(private_key.public_key.encode()).decode("ascii")
    encrypted_priv = _encrypt_private_key(private_key.encode())
    key_id = _generate_key_id()

    doc = ScopedKeypair(
        scopeType=scope_type,
        scopeId=scope_id,
        publicKey=public_key_b64,
        privateKey=encrypted_priv,
        algorithm=_ALGORITHM,
        keyId=key_id,
        isActive=True,
        createdAt=now,
    )
    await doc.insert()
    logger.info("Rotated keypair to %s for %s:%s", key_id, scope_type, scope_id)

    return PublicKeyResponse(
        keyId=doc.keyId,
        publicKey=doc.publicKey,
        algorithm=doc.algorithm,
    )


async def get_keypair_by_key_id(
    scope_type: str,
    scope_id: str,
    key_id: str,
) -> ScopedKeypair | None:
    """Look up a specific keypair by scope and keyId."""
    return await ScopedKeypair.find_one(
        ScopedKeypair.scopeType == scope_type,
        ScopedKeypair.scopeId == scope_id,
        ScopedKeypair.keyId == key_id,
    )


def decrypt_private_key(keypair: ScopedKeypair) -> bytes:
    """Decrypt and return the raw private key bytes from a ScopedKeypair."""
    return _decrypt_private_key(keypair.privateKey)
