"""
Tests for per-scope Libsodium keypair infrastructure (Wave 1, Tasks 3a-3c).

Covers:
- Round-trip: encrypt with public key, decrypt via trusted runtime resolver
- Rotation: old key still decrypts; new writes use the new key
- Private key encryption at rest
- Public key endpoint returns correct metadata
"""
from __future__ import annotations

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from nacl.public import PrivateKey, PublicKey, SealedBox

from app.services import scoped_secrets
from app.services.scoped_secret_resolver import resolve_secret

_MASTER_KEY = b"\xAB" * 32


@pytest.fixture(autouse=True)
def _mock_master_key():
    with patch.object(scoped_secrets, "get_master_key", return_value=_MASTER_KEY):
        yield


def _make_mock_keypair(
    scope_type: str = "workspace",
    scope_id: str = "ws-test-001",
    key_id: str = "kp-test-001",
    is_active: bool = True,
) -> tuple[MagicMock, bytes]:
    """Create a mock keypair object with a real keypair for testing."""
    private_key = PrivateKey.generate()
    public_key_b64 = base64.b64encode(private_key.public_key.encode()).decode("ascii")

    encrypted_priv = scoped_secrets._encrypt_private_key(private_key.encode())

    mock_doc = MagicMock()
    mock_doc.scopeType = scope_type
    mock_doc.scopeId = scope_id
    mock_doc.publicKey = public_key_b64
    mock_doc.privateKey = encrypted_priv
    mock_doc.algorithm = "libsodium-sealed-box"
    mock_doc.keyId = key_id
    mock_doc.isActive = is_active

    return mock_doc, private_key.encode()


def _encrypt_for_public_key(public_key_b64: str, plaintext: str) -> str:
    """Encrypt a plaintext string using a public key (sealed box)."""
    public_key_bytes = base64.b64decode(public_key_b64)
    public_key = PublicKey(public_key_bytes)
    sealed_box = SealedBox(public_key)
    ciphertext = sealed_box.encrypt(plaintext.encode("utf-8"))
    return base64.b64encode(ciphertext).decode("ascii")


class TestRoundTrip:
    def test_encrypt_with_public_key_decrypt_via_resolver(self):
        """Encrypt with public key, decrypt via trusted runtime resolver."""
        keypair, _ = _make_mock_keypair()
        plaintext = "super-secret-api-key-12345"

        ciphertext_b64 = _encrypt_for_public_key(keypair.publicKey, plaintext)

        async def _resolve():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=ciphertext_b64,
                    key_id="kp-test-001",
                )

        result = asyncio.run(_resolve())
        assert result == plaintext

    def test_round_trip_unicode(self):
        """Round-trip works with unicode characters."""
        keypair, _ = _make_mock_keypair()
        plaintext = "héllo wörld 🌍 🔐"

        ciphertext_b64 = _encrypt_for_public_key(keypair.publicKey, plaintext)

        async def _resolve():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=ciphertext_b64,
                    key_id="kp-test-001",
                )

        result = asyncio.run(_resolve())
        assert result == plaintext

    def test_round_trip_empty_string(self):
        """Round-trip works with empty string."""
        keypair, _ = _make_mock_keypair()
        plaintext = ""

        ciphertext_b64 = _encrypt_for_public_key(keypair.publicKey, plaintext)

        async def _resolve():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=ciphertext_b64,
                    key_id="kp-test-001",
                )

        result = asyncio.run(_resolve())
        assert result == plaintext


class TestRotation:
    def test_old_key_still_decrypts_after_rotation(self):
        """After rotation, old key can still decrypt old ciphertexts."""
        old_keypair, _ = _make_mock_keypair(key_id="kp-old-001", is_active=False)
        new_keypair, _ = _make_mock_keypair(key_id="kp-new-002", is_active=True)

        old_plaintext = "old-secret-value"
        old_ciphertext = _encrypt_for_public_key(old_keypair.publicKey, old_plaintext)

        async def _resolve_old():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=old_keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=old_ciphertext,
                    key_id="kp-old-001",
                )

        result = asyncio.run(_resolve_old())
        assert result == old_plaintext

    def test_new_writes_use_new_key(self):
        """After rotation, new writes encrypted with new key decrypt correctly."""
        new_keypair, _ = _make_mock_keypair(key_id="kp-new-002", is_active=True)

        new_plaintext = "new-secret-value"
        new_ciphertext = _encrypt_for_public_key(new_keypair.publicKey, new_plaintext)

        async def _resolve_new():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=new_keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=new_ciphertext,
                    key_id="kp-new-002",
                )

        result = asyncio.run(_resolve_new())
        assert result == new_plaintext

    def test_old_key_cannot_decrypt_new_ciphertext(self):
        """Old key cannot decrypt ciphertext encrypted with new key."""
        old_keypair, _ = _make_mock_keypair(key_id="kp-old-001", is_active=False)
        new_keypair, _ = _make_mock_keypair(key_id="kp-new-002", is_active=True)

        new_plaintext = "new-secret-value"
        new_ciphertext = _encrypt_for_public_key(new_keypair.publicKey, new_plaintext)

        async def _resolve_with_old():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=old_keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=new_ciphertext,
                    key_id="kp-old-001",
                )

        from nacl.exceptions import CryptoError

        with pytest.raises(CryptoError):
            asyncio.run(_resolve_with_old())


class TestPrivateKeyEncryptionAtRest:
    def test_private_key_is_encrypted(self):
        """Private key stored in mock is encrypted, not raw."""
        keypair, raw_private_key = _make_mock_keypair()

        stored_bytes = base64.urlsafe_b64decode(keypair.privateKey)
        assert stored_bytes != raw_private_key
        assert len(stored_bytes) > len(raw_private_key)

    def test_decrypt_private_key_returns_raw(self):
        """decrypt_private_key returns the raw private key bytes."""
        keypair, raw_private_key = _make_mock_keypair()

        decrypted = scoped_secrets.decrypt_private_key(keypair)
        assert decrypted == raw_private_key


class TestPublicKeyEndpoint:
    def test_get_public_key_returns_metadata(self):
        """get_public_key returns keyId, publicKey, and algorithm."""
        keypair, _ = _make_mock_keypair()

        async def _get():
            with patch(
                "app.services.scoped_secrets.get_or_create_keypair",
                new=AsyncMock(return_value=keypair),
            ):
                return await scoped_secrets.get_public_key("workspace", "ws-test-001")

        result = asyncio.run(_get())
        assert result.keyId == keypair.keyId
        assert result.publicKey == keypair.publicKey
        assert result.algorithm == "libsodium-sealed-box"


class TestResolverMissingKeypair:
    def test_missing_keypair_raises_value_error(self):
        """Resolver raises ValueError if keypair not found."""
        async def _resolve():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=None),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-missing",
                    ciphertext_b64="dummy",
                    key_id="kp-missing",
                )

        with pytest.raises(ValueError, match="Keypair not found"):
            asyncio.run(_resolve())
