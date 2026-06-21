"""
Public encrypt/decrypt API for environment secrets.

Uses AES-256-GCM authenticated encryption.  Each secret is encrypted with a
Data Encryption Key (DEK) that is itself wrapped by the master Key Encryption
Key (KEK) — classic envelope encryption.

The ``kek_id`` on every :class:`EncryptedBlob` routes decryption to the
correct DEK, enabling key rotation without re-encrypting existing data.
"""

from __future__ import annotations

import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.models import EncryptedBlob
from app.repositories import secret_kek

_NONCE_SIZE = 12  # AES-GCM standard nonce size in bytes
_ALGORITHM = "aes-256-gcm"


async def encrypt(plaintext: str, kek_id: str | None = None) -> EncryptedBlob:
    """Encrypt *plaintext* and return an :class:`EncryptedBlob`.

    Parameters
    ----------
    plaintext:
        The secret value to encrypt (UTF-8 string).
    kek_id:
        ID of the KEK whose DEK should be used.  If *None*, the currently
        active KEK is looked up automatically.
    """
    if kek_id is None:
        kek_id = await secret_kek.get_active_kek_id()

    dek = await secret_kek.unwrap_dek_for_kek(kek_id)
    nonce = secrets.token_bytes(_NONCE_SIZE)

    aesgcm = AESGCM(dek)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)

    return EncryptedBlob(
        ciphertext=ciphertext,  # bytes → auto base64 via field_validator
        kek_id=kek_id,
        algorithm=_ALGORITHM,
        nonce=nonce,  # bytes → auto base64 via field_validator
    )


async def decrypt(blob: EncryptedBlob) -> str:
    """Decrypt an :class:`EncryptedBlob` and return the plaintext string.

    Raises
    ------
    cryptography.exceptions.InvalidTag
        If the ciphertext has been tampered with or the DEK is wrong.
    ValueError
        If the KEK record referenced by ``blob.kek_id`` does not exist.
    """
    dek = await secret_kek.unwrap_dek_for_kek(blob.kek_id)

    aesgcm = AESGCM(dek)
    plaintext_bytes = aesgcm.decrypt(
        blob.get_nonce_bytes(),
        blob.get_ciphertext_bytes(),
        None,
    )
    return plaintext_bytes.decode("utf-8")
