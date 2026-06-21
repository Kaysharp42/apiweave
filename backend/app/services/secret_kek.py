"""
Key Encryption Key (KEK) management for envelope encryption.

The master KEK is derived from ``settings.SECRET_ENCRYPTION_KEY`` (base64-encoded
32 bytes).  Data Encryption Keys (DEKs) are generated per-environment, wrapped
by the master KEK, and stored in the ``encryption_keys`` MongoDB collection.
"""
from __future__ import annotations

import base64
import binascii
import logging
import secrets
import time
from datetime import UTC, datetime

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings
from app.models import EncryptionKey

logger = logging.getLogger(__name__)

_NONCE_SIZE = 12  # AES-GCM standard nonce size in bytes
_DEK_SIZE = 32    # 256-bit DEK
_KEK_ID_DEFAULT = "kek-default"


def get_master_key() -> bytes:
    """Return the raw 32-byte master KEK from configuration.

    Raises
    ------
    ValueError
        If ``SECRET_ENCRYPTION_KEY`` is not set or does not decode to
        exactly 32 bytes.
    """
    raw = settings.SECRET_ENCRYPTION_KEY
    if not raw:
        raise ValueError(
            "SECRET_ENCRYPTION_KEY is not configured. "
            "Set it in .env or let the validator auto-generate one in dev."
        )
    try:
        padded = raw + "=" * (-len(raw) % 4)
        key = base64.urlsafe_b64decode(padded)
    except binascii.Error as exc:
        raise ValueError(
            f"SECRET_ENCRYPTION_KEY is not valid base64: {exc}"
        ) from exc
    if len(key) != 32:
        raise ValueError(
            f"SECRET_ENCRYPTION_KEY must decode to 32 bytes, got {len(key)}"
        )
    return key


def wrap_dek(dek: bytes, master_key: bytes | None = None) -> bytes:
    """Wrap (encrypt) a DEK with the master KEK.

    Returns ``nonce(12) || AESGCM(master_key, dek)`` as raw bytes.
    The caller is responsible for base64-encoding before storage.
    """
    if master_key is None:
        master_key = get_master_key()
    nonce = secrets.token_bytes(_NONCE_SIZE)
    aesgcm = AESGCM(master_key)
    ciphertext = aesgcm.encrypt(nonce, dek, None)
    return nonce + ciphertext


def unwrap_dek(wrapped_dek: bytes, master_key: bytes | None = None) -> bytes:
    """Unwrap (decrypt) a DEK previously wrapped by :func:`wrap_dek`.

    Parameters
    ----------
    wrapped_dek:
        Raw bytes: ``nonce(12) || ciphertext``.
    master_key:
        32-byte master KEK.  If *None*, reads from configuration.
    """
    if master_key is None:
        master_key = get_master_key()
    if len(wrapped_dek) < _NONCE_SIZE + 16:  # nonce + GCM tag minimum
        raise ValueError("wrapped_dek is too short to contain nonce + tag")
    nonce = wrapped_dek[:_NONCE_SIZE]
    ciphertext = wrapped_dek[_NONCE_SIZE:]
    aesgcm = AESGCM(master_key)
    return aesgcm.decrypt(nonce, ciphertext, None)


async def get_active_kek_id() -> str:
    """Return the ``kek_id`` of the currently active KEK record.

    Raises
    ------
    ValueError
        If no active KEK exists.  Call :func:`get_or_create_default_kek`
        first to bootstrap.
    """
    kek = await EncryptionKey.find_one(
        EncryptionKey.is_active == True  # noqa: E712
    )
    if kek is None:
        raise ValueError(
            "No active KEK found. Call get_or_create_default_kek() first."
        )
    return kek.kek_id


async def get_or_create_default_kek(kek_id: str = _KEK_ID_DEFAULT) -> str:
    """Ensure a KEK record exists for *kek_id*; create one if absent.

    Returns the *kek_id*.
    """
    existing = await EncryptionKey.find_one(
        EncryptionKey.kek_id == kek_id
    )
    if existing is not None:
        return existing.kek_id

    master_key = get_master_key()
    dek = secrets.token_bytes(_DEK_SIZE)
    wrapped = wrap_dek(dek, master_key)

    kek_doc = EncryptionKey(
        kek_id=kek_id,
        wrapped_dek=base64.urlsafe_b64encode(wrapped).decode("ascii"),
        algorithm="aes-256-gcm",
        created_at=datetime.now(UTC),
        is_active=True,
    )
    await kek_doc.insert()
    logger.info("Created new KEK record: %s", kek_id)
    return kek_doc.kek_id


async def unwrap_dek_for_kek(kek_id: str) -> bytes:
    """Convenience: fetch the KEK record and unwrap its DEK.

    Raises
    ------
    ValueError
        If the KEK record does not exist.
    """
    kek = await EncryptionKey.find_one(EncryptionKey.kek_id == kek_id)
    if kek is None:
        raise ValueError(f"KEK record '{kek_id}' not found")
    wrapped = base64.urlsafe_b64decode(kek.wrapped_dek)
    return unwrap_dek(wrapped)


async def rotate_kek() -> str:
    """Rotate to a new KEK: deactivate all existing KEKs, create a new one.

    Returns the ``kek_id`` of the newly created KEK record.
    Old KEK records remain in the database (``is_active=False``) so that
    existing encrypted blobs can still be decrypted via their ``kek_id``.
    """
    all_keks = await EncryptionKey.find(
        EncryptionKey.is_active == True  # noqa: E712
    ).to_list()
    for kek in all_keks:
        kek.is_active = False
        await kek.save()

    master_key = get_master_key()
    dek = secrets.token_bytes(_DEK_SIZE)
    wrapped = wrap_dek(dek, master_key)

    new_kek_id = f"kek-{int(time.time())}"
    kek_doc = EncryptionKey(
        kek_id=new_kek_id,
        wrapped_dek=base64.urlsafe_b64encode(wrapped).decode("ascii"),
        algorithm="aes-256-gcm",
        created_at=datetime.now(UTC),
        is_active=True,
    )
    await kek_doc.insert()
    logger.info("Rotated KEK: new active KEK is %s", new_kek_id)
    return new_kek_id


async def add_kek(wrapped_dek_bytes: bytes) -> str:
    """Add a KEK record with a pre-wrapped DEK.

    Parameters
    ----------
    wrapped_dek_bytes:
        Raw bytes: ``nonce(12) || AESGCM(master_kek, dek)`` — the DEK
        already wrapped by the master KEK.

    Returns the ``kek_id`` of the newly created KEK record.
    """
    new_kek_id = f"kek-{int(time.time())}"
    kek_doc = EncryptionKey(
        kek_id=new_kek_id,
        wrapped_dek=base64.urlsafe_b64encode(wrapped_dek_bytes).decode("ascii"),
        algorithm="aes-256-gcm",
        created_at=datetime.now(UTC),
        is_active=True,
    )
    await kek_doc.insert()
    logger.info("Added KEK record: %s", new_kek_id)
    return new_kek_id
