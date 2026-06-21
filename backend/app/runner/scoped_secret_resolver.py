"""
Trusted runtime resolver for scoped sealed-box ciphertexts.

Given a scope (scopeType + scopeId), a sealed-box ciphertext, and the
keyId that was used to encrypt it, this module decrypts the ciphertext
in memory using the corresponding private key.  This is the ONLY path
that should ever hold plaintext secret values at runtime.
"""

from __future__ import annotations

import base64

from nacl.public import PrivateKey, SealedBox

from app.models import ScopedKeypair
from app.repositories.secret_kek import get_master_key, unwrap_dek


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


def _decrypt_private_key(encrypted_b64: str) -> bytes:
    """Decrypt a base64-encoded wrapped private key using the master KEK."""
    master_key = get_master_key()
    wrapped = base64.urlsafe_b64decode(encrypted_b64)
    return unwrap_dek(wrapped, master_key)


def decrypt_private_key(keypair: ScopedKeypair) -> bytes:
    """Decrypt and return the raw private key bytes from a ScopedKeypair."""
    return _decrypt_private_key(keypair.privateKey)


async def resolve_secret(
    scope_type: str,
    scope_id: str,
    ciphertext_b64: str,
    key_id: str,
) -> str:
    """Decrypt a sealed-box ciphertext for the trusted runtime.

    Parameters
    ----------
    scope_type:
        The scope type (user, organization, workspace, environment).
    scope_id:
        The scope identifier.
    ciphertext_b64:
        Base64-encoded sealed-box ciphertext.
    key_id:
        The keyId that was active when the ciphertext was created.

    Returns
    -------
    The decrypted plaintext string.

    Raises
    ------
    ValueError
        If the keypair for the given scope and keyId is not found.
    nacl.exceptions.CryptoError
        If the ciphertext is invalid or was encrypted for a different key.
    """
    keypair = await get_keypair_by_key_id(scope_type, scope_id, key_id)
    if keypair is None:
        raise ValueError(f"Keypair not found for scope {scope_type}:{scope_id} keyId={key_id}")

    private_key_bytes = decrypt_private_key(keypair)
    private_key = PrivateKey(private_key_bytes)
    sealed_box = SealedBox(private_key)

    ciphertext = base64.b64decode(ciphertext_b64)
    plaintext = sealed_box.decrypt(ciphertext)
    return plaintext.decode("utf-8")
