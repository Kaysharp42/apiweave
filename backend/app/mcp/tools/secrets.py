"""
MCP secret tools — scoped encrypted secret management.

Old plaintext environment_set_secret and environment_delete_secret tools
have been removed. New tools use the scoped secret API with client-encrypted
sealed-box ciphertext. Metadata-only reads return no values/ciphertext.

Tools:
- secret_get_public_key: Get the public key for a scope (for client encryption)
- secret_list: List secret metadata in a scope (no values)
- secret_create: Create a secret with client-encrypted ciphertext
- secret_update: Update a secret's ciphertext
- secret_delete: Delete a secret
"""
import logging
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.scope_context import require_scope
from app.models import SecretCreateRequest
from app.services import scoped_secrets, secret_service

logger = logging.getLogger(__name__)


async def secret_get_public_key(
    scope_type: Annotated[
        str,
        Field(description="Scope type: 'workspace', 'organization', or 'environment'."),
    ] = "",
    scope_id: Annotated[
        str,
        Field(description="Scope ID (workspace/org/environment ID). Defaults to token scope."),
    ] = "",
) -> dict:
    """Get the public key for encrypting secret values.

    Returns the keyId, publicKey (base64), and algorithm.
    Clients use this to encrypt secret values with libsodium sealed-box
    before calling secret_create or secret_update.
    """
    await ensure_mcp_database()
    scope = require_scope()

    # Default to token scope if not specified
    effective_scope_type = scope_type or scope.scope_type
    effective_scope_id = scope_id or scope.scope_id

    # Verify the requested scope matches the token scope
    if effective_scope_type != scope.scope_type or effective_scope_id != scope.scope_id:
        raise PermissionError(
            f"Access denied: cannot get public key for scope "
            f"{effective_scope_type}/{effective_scope_id}. "
            f"Token scope is {scope.scope_type}/{scope.scope_id}."
        )

    key_info = await scoped_secrets.get_public_key(
        scope_type=effective_scope_type,
        scope_id=effective_scope_id,
    )
    return {
        "scopeType": effective_scope_type,
        "scopeId": effective_scope_id,
        "keyId": key_info.keyId,
        "publicKey": key_info.publicKey,
        "algorithm": key_info.algorithm,
    }


async def secret_list() -> dict:
    """List secret metadata in the authenticated scope.

    Returns metadata only — no ciphertext or plaintext values.
    """
    await ensure_mcp_database()
    scope = require_scope()

    secrets_list = await secret_service.list_secrets(
        scope_type=scope.scope_type,
        scope_id=scope.scope_id,
    )
    return {
        "scopeType": scope.scope_type,
        "scopeId": scope.scope_id,
        "secrets": [
            {
                "secretId": s.secretId,
                "name": s.name,
                "scopeType": s.scopeType,
                "scopeId": s.scopeId,
                "keyId": s.keyId,
                "createdAt": s.createdAt.isoformat() if s.createdAt else None,
                "updatedAt": s.updatedAt.isoformat() if s.updatedAt else None,
            }
            for s in secrets_list
        ],
        "total": len(secrets_list),
    }


async def secret_create(
    name: Annotated[
        str,
        Field(description="Secret name (GitHub-like: alphanumeric + underscore)."),
    ],
    ciphertext: Annotated[
        str,
        Field(description="Base64-encoded libsodium sealed-box ciphertext."),
    ],
    key_id: Annotated[
        str,
        Field(description="Key ID used to encrypt the ciphertext (from secret_get_public_key)."),
    ],
) -> dict:
    """Create a scoped secret with client-encrypted ciphertext.

    The ciphertext must be encrypted using the public key from
    secret_get_public_key for this scope. Plaintext values are
    NEVER accepted.
    """
    await ensure_mcp_database()
    scope = require_scope()

    try:
        result = await secret_service.create_secret(
            scope_type=scope.scope_type,
            scope_id=scope.scope_id,
            request=SecretCreateRequest(
                name=name,
                ciphertext=ciphertext,
                keyId=key_id,
            ),
            actor="service_token",
            actor_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    return {
        "message": "Secret created successfully",
        "secret": {
            "secretId": result.secretId,
            "name": result.name,
            "scopeType": result.scopeType,
            "scopeId": result.scopeId,
            "keyId": result.keyId,
            "createdAt": result.createdAt.isoformat() if result.createdAt else None,
        },
    }


async def secret_update(
    secret_id: Annotated[str, Field(description="Secret ID to update.")],
    name: Annotated[str, Field(description="Secret name (must match existing).")],
    ciphertext: Annotated[
        str,
        Field(description="New base64-encoded libsodium sealed-box ciphertext."),
    ],
    key_id: Annotated[
        str,
        Field(description="Key ID used to encrypt the new ciphertext."),
    ],
) -> dict:
    """Update a secret's ciphertext. Name cannot be changed."""
    await ensure_mcp_database()
    scope = require_scope()

    try:
        result = await secret_service.update_secret(
            secret_id=secret_id,
            request=SecretCreateRequest(
                name=name,
                ciphertext=ciphertext,
                keyId=key_id,
            ),
            actor="service_token",
            actor_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    return {
        "message": "Secret updated successfully",
        "secret": {
            "secretId": result.secretId,
            "name": result.name,
            "scopeType": result.scopeType,
            "scopeId": result.scopeId,
            "keyId": result.keyId,
            "updatedAt": result.updatedAt.isoformat() if result.updatedAt else None,
        },
    }


async def secret_delete(
    secret_id: Annotated[str, Field(description="Secret ID to delete.")],
) -> dict:
    """Delete a scoped secret."""
    await ensure_mcp_database()
    scope = require_scope()

    try:
        await secret_service.delete_secret(
            secret_id=secret_id,
            actor="service_token",
            actor_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    return {
        "message": "Secret deleted successfully",
        "secretId": secret_id,
    }


def register_secret_tools(server: FastMCP) -> None:
    """Register scoped encrypted secret tools."""
    server.tool(
        name="secret_get_public_key",
        description=(
            "Get the public key for encrypting secret values. "
            "Use this before secret_create/secret_update."
        ),
    )(secret_get_public_key)
    server.tool(
        name="secret_list",
        description=(
            "List secret metadata in the authenticated scope. "
            "Returns metadata only — no ciphertext or plaintext values."
        ),
    )(secret_list)
    server.tool(
        name="secret_create",
        description=(
            "Create a scoped secret with client-encrypted ciphertext. "
            "Plaintext values are NEVER accepted."
        ),
    )(secret_create)
    server.tool(
        name="secret_update",
        description="Update a secret's ciphertext. Name cannot be changed.",
    )(secret_update)
    server.tool(
        name="secret_delete",
        description="Delete a scoped secret.",
    )(secret_delete)
