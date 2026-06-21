from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict
from pymongo import ASCENDING, IndexModel


class Secret(Document):
    """
    GitHub-style scoped secret metadata + sealed-box ciphertext.

    The ciphertext is the base64-encoded libsodium sealed-box ciphertext
    encrypted by the client using the scope's public key.  The server
    NEVER holds plaintext outside the trusted runtime resolver.

    Metadata list/get responses strip the ciphertext field — only the
    trusted runtime resolver (scoped_secret_resolver) may decrypt.
    """

    secretId: str
    name: str
    scopeType: str  # SecretScope value
    scopeId: str
    ciphertext: str  # base64-encoded sealed-box ciphertext
    keyId: str  # ScopedKeypair keyId used for encryption
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "secrets"
        indexes = [
            IndexModel([("secretId", ASCENDING)], unique=True),
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("name", ASCENDING)], unique=True
            ),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
        ]


class SecretBinding(Document):
    bindingId: str
    secretId: str
    userId: str
    targetScopeType: str  # "workspace" | "environment"
    targetScopeId: str
    createdAt: datetime

    class Settings:
        name = "secret_bindings"
        indexes = [
            IndexModel([("bindingId", ASCENDING)], unique=True),
            IndexModel(
                [
                    ("secretId", ASCENDING),
                    ("targetScopeType", ASCENDING),
                    ("targetScopeId", ASCENDING),
                ],
                unique=True,
            ),
            IndexModel([("userId", ASCENDING)]),
        ]


class SecretCreateRequest(BaseModel):
    """Request body for creating/updating a scoped secret."""

    name: str
    ciphertext: str  # base64-encoded sealed-box ciphertext
    keyId: str  # keyId of the public key used to encrypt


class SecretMetadataResponse(BaseModel):
    """
    Secret metadata returned by list/get endpoints.

    NEVER includes ciphertext or plaintext value.
    """

    model_config = ConfigDict(from_attributes=True)

    secretId: str
    name: str
    scopeType: str
    scopeId: str
    keyId: str
    createdAt: datetime
    updatedAt: datetime


class SecretBindingCreateRequest(BaseModel):
    """Request body for binding a user secret to a workspace/environment."""

    secretId: str
    targetScopeType: str  # "workspace" | "environment"
    targetScopeId: str


class SecretBindingResponse(BaseModel):
    """Secret binding metadata returned by list endpoints."""

    model_config = ConfigDict(from_attributes=True)

    bindingId: str
    secretId: str
    userId: str
    targetScopeType: str
    targetScopeId: str
    createdAt: datetime
