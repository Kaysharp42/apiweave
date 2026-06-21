"""
Sealed-box keypair management for frontend-to-backend secret transport.

The backend holds a Curve25519 keypair. The public key is served to the
frontend so it can encrypt secret values with ``crypto_box_seal`` (anonymous
sender). The backend opens the sealed box, recovers the plaintext, then
re-encrypts with AES-256-GCM envelope storage via ``secret_crypto``.

The private key is derived deterministically from ``settings.SECRET_ENCRYPTION_KEY``
so it survives restarts without separate storage. In production you would
store the keypair in a vault; here we derive it from the existing master key.
"""

from __future__ import annotations

import base64
import hashlib

from nacl.public import PrivateKey, SealedBox

from app.config import settings

_SEALED_BOX_KEY_ID = "sealed-box-v1"
_ALGORITHM = "libsodium-sealed-box"

_cached_private_key: PrivateKey | None = None
_cached_public_key_b64: str | None = None


def _derive_private_key() -> PrivateKey:
    """Derive a Curve25519 private key from the master secret.

    Uses SHA-256 of ``SECRET_ENCRYPTION_KEY`` truncated to 32 bytes as the
    private key seed. This is deterministic — the same master key always
    produces the same keypair.
    """
    master = settings.SECRET_ENCRYPTION_KEY
    if not master:
        raise ValueError(
            "SECRET_ENCRYPTION_KEY is not configured. "
            "Set it in .env or let the validator auto-generate one in dev."
        )
    seed = hashlib.sha256(master.encode("utf-8")).digest()
    return PrivateKey(seed)


def get_private_key() -> PrivateKey:
    global _cached_private_key
    if _cached_private_key is None:
        _cached_private_key = _derive_private_key()
    return _cached_private_key


def get_public_key_b64() -> str:
    global _cached_public_key_b64
    if _cached_public_key_b64 is None:
        pk = get_private_key().public_key
        _cached_public_key_b64 = base64.b64encode(pk.encode()).decode("ascii")
    return _cached_public_key_b64


def get_key_id() -> str:
    return _SEALED_BOX_KEY_ID


def get_algorithm() -> str:
    return _ALGORITHM


def open_sealed_box(ciphertext_b64: str) -> str:
    """Open a sealed-box ciphertext and return the plaintext string.

    Parameters
    ----------
    ciphertext_b64:
        Base64-encoded ciphertext produced by ``crypto_box_seal``.

    Raises
    ------
    nacl.exceptions.CryptoError
        If the ciphertext is invalid or was encrypted for a different key.
    """
    ciphertext = base64.b64decode(ciphertext_b64)
    private_key = get_private_key()
    sealed_box = SealedBox(private_key)
    plaintext = sealed_box.decrypt(ciphertext)
    return plaintext.decode("utf-8")


def reset_cache() -> None:
    global _cached_private_key, _cached_public_key_b64
    _cached_private_key = None
    _cached_public_key_b64 = None
