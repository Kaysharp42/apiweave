import base64
from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, field_validator
from pymongo import ASCENDING, IndexModel


class EncryptedBlob(BaseModel):
    """
    Encrypted secret value stored in Environment.secrets.

    Serialized as a dict in MongoDB with base64-encoded binary fields.
    The ``kek_id`` routes decryption to the correct DEK, enabling
    multi-key rotation without data migration.
    """

    ciphertext: str  # base64-encoded AES-256-GCM ciphertext+tag
    kek_id: str  # ID of the KEK that wrapped the DEK used for encryption
    algorithm: str  # e.g. "aes-256-gcm"
    nonce: str  # base64-encoded 12-byte nonce

    @field_validator("ciphertext", "nonce", mode="before")
    @classmethod
    def _encode_bytes_to_base64(cls, v: Any) -> Any:
        """Accept raw bytes on construction and encode to base64 str."""
        if isinstance(v, (bytes, bytearray)):
            return base64.b64encode(v).decode("ascii")
        return v

    def get_ciphertext_bytes(self) -> bytes:
        """Decode the base64 ciphertext to raw bytes."""
        return base64.b64decode(self.ciphertext)

    def get_nonce_bytes(self) -> bytes:
        """Decode the base64 nonce to raw bytes."""
        return base64.b64decode(self.nonce)


class EncryptionKey(Document):
    """
    Key encryption key record for envelope encryption.

    Stores a DEK (data encryption key) wrapped by the master KEK from
    ``SECRET_ENCRYPTION_KEY``.  Multiple records support key rotation:
    old blobs decrypt via their ``kek_id``; new writes use the active KEK.
    """

    kek_id: str
    wrapped_dek: str  # base64-encoded nonce(12) + AESGCM(master_kek, dek)
    algorithm: str = "aes-256-gcm"
    created_at: datetime
    is_active: bool = True

    class Settings:
        name = "encryption_keys"
        indexes = [
            IndexModel([("kek_id", ASCENDING)], unique=True),
            IndexModel([("is_active", ASCENDING)]),
        ]


class ScopedKeypair(Document):
    """
    Per-scope Libsodium Curve25519 keypair for sealed-box secret encryption.

    Each scope (user, organization, workspace, environment) has an active
    keypair whose public key is served to clients for encrypting secret
    values before POST.  The private key is encrypted at rest using the
    master KEK derived from ``SECRET_ENCRYPTION_KEY``.

    On rotation the old keypair is marked inactive but retained so that
    previously encrypted ciphertexts can still be decrypted by the trusted
    runtime resolver.

    The compound unique index on (scopeType, scopeId, keyId) ensures that
    each key version for a scope is unique.
    """

    scopeType: Literal["user", "organization", "workspace", "environment"]
    scopeId: str
    publicKey: str  # base64-encoded Curve25519 public key
    privateKey: str  # base64-encoded encrypted private key (at rest)
    algorithm: str = "libsodium-sealed-box"
    keyId: str  # unique key version identifier, e.g. "kp-<timestamp>"
    isActive: bool = True
    createdAt: datetime
    rotatedAt: datetime | None = None

    class Settings:
        name = "scoped_keypairs"
        indexes = [
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("keyId", ASCENDING)],
                unique=True,
            ),
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("isActive", ASCENDING)],
            ),
        ]


class PublicKeyResponse(BaseModel):
    """Public key metadata returned by the GET public-key endpoint."""

    keyId: str
    publicKey: str
    algorithm: str
