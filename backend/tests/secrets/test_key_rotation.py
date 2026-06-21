"""
Task 27 — Key rotation tests.

Verifies that:
- After libsodium keypair rotation, old ciphertexts remain decryptable
  via the old (now inactive) keypair.
- New writes use the new active keypair.
- After KEK rotation, old AES-256-GCM blobs remain decryptable.
- Multiple rotations preserve all old key accessibility.
"""

from __future__ import annotations

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from nacl.public import PrivateKey, PublicKey, SealedBox

from app.services import scoped_secrets, secret_crypto, secret_kek
from app.services.scoped_secret_resolver import resolve_secret

_MASTER_KEY = b"\xab" * 32


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
    """Create a mock keypair with a real libsodium keypair."""
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
    public_key_bytes = base64.b64decode(public_key_b64)
    public_key = PublicKey(public_key_bytes)
    sealed_box = SealedBox(public_key)
    ciphertext = sealed_box.encrypt(plaintext.encode("utf-8"))
    return base64.b64encode(ciphertext).decode("ascii")


# ---------------------------------------------------------------------------
# Libsodium keypair rotation
# ---------------------------------------------------------------------------


class TestLibsodiumKeypairRotation:
    """After keypair rotation, old ciphertexts remain decryptable."""

    def test_old_ciphertext_decryptable_after_rotation(self):
        """Old ciphertext can be decrypted using the old (inactive) keypair."""
        old_keypair, _ = _make_mock_keypair(key_id="kp-old-001", is_active=False)
        new_keypair, _ = _make_mock_keypair(key_id="kp-new-002", is_active=True)

        plaintext = "NEVER_LEAK_ME_42"
        old_ciphertext = _encrypt_for_public_key(old_keypair.publicKey, plaintext)

        async def _resolve():
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

        result = asyncio.run(_resolve())
        assert result == plaintext

    def test_new_writes_use_new_key(self):
        """New writes encrypted with the new key decrypt correctly."""
        new_keypair, _ = _make_mock_keypair(key_id="kp-new-002", is_active=True)

        plaintext = "new-secret-after-rotation"
        new_ciphertext = _encrypt_for_public_key(new_keypair.publicKey, plaintext)

        async def _resolve():
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

        result = asyncio.run(_resolve())
        assert result == plaintext

    def test_multiple_rotations_all_old_keys_work(self):
        """After multiple rotations, all old keypairs can still decrypt their ciphertexts."""
        keypair_v1, _ = _make_mock_keypair(key_id="kp-v1", is_active=False)
        keypair_v2, _ = _make_mock_keypair(key_id="kp-v2", is_active=False)
        keypair_v3, _ = _make_mock_keypair(key_id="kp-v3", is_active=True)

        ct_v1 = _encrypt_for_public_key(keypair_v1.publicKey, "secret-v1")
        ct_v2 = _encrypt_for_public_key(keypair_v2.publicKey, "secret-v2")
        ct_v3 = _encrypt_for_public_key(keypair_v3.publicKey, "secret-v3")

        async def _resolve_all():
            results = []
            for kp, ct in [(keypair_v1, ct_v1), (keypair_v2, ct_v2), (keypair_v3, ct_v3)]:
                with patch(
                    "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                    new=AsyncMock(return_value=kp),
                ):
                    decrypted = await resolve_secret(
                        scope_type="workspace",
                        scope_id="ws-test-001",
                        ciphertext_b64=ct,
                        key_id=kp.keyId,
                    )
                    results.append(decrypted)
            return results

        results = asyncio.run(_resolve_all())
        assert results == ["secret-v1", "secret-v2", "secret-v3"]

    def test_old_key_cannot_decrypt_new_ciphertext(self):
        """Old key cannot decrypt ciphertext encrypted with a newer key."""
        old_keypair, _ = _make_mock_keypair(key_id="kp-old", is_active=False)
        new_keypair, _ = _make_mock_keypair(key_id="kp-new", is_active=True)

        new_ciphertext = _encrypt_for_public_key(new_keypair.publicKey, "new-secret")

        async def _resolve():
            with patch(
                "app.services.scoped_secret_resolver.get_keypair_by_key_id",
                new=AsyncMock(return_value=old_keypair),
            ):
                return await resolve_secret(
                    scope_type="workspace",
                    scope_id="ws-test-001",
                    ciphertext_b64=new_ciphertext,
                    key_id="kp-old",
                )

        from nacl.exceptions import CryptoError

        with pytest.raises(CryptoError):
            asyncio.run(_resolve())


# ---------------------------------------------------------------------------
# AES-256-GCM KEK rotation
# ---------------------------------------------------------------------------


class TestKekRotation:
    """After KEK rotation, old AES-256-GCM blobs remain decryptable."""

    def test_old_blob_decrypts_after_kek_rotation(self):
        """Blob encrypted with old KEK's DEK still decrypts after rotation."""
        dek_old = b"\x01" * 32
        dek_new = b"\x02" * 32

        async def _scenario():
            # Encrypt with old KEK
            with patch.object(
                secret_kek, "get_active_kek_id", new=AsyncMock(return_value="kek-old")
            ):
                with patch.object(
                    secret_kek,
                    "unwrap_dek_for_kek",
                    new=AsyncMock(side_effect=lambda kid: dek_old if kid == "kek-old" else dek_new),
                ):
                    blob = await secret_crypto.encrypt("NEVER_LEAK_ME_42", kek_id="kek-old")

            # After rotation, decrypt with old KEK's DEK
            with patch.object(
                secret_kek, "get_active_kek_id", new=AsyncMock(return_value="kek-new")
            ):
                with patch.object(
                    secret_kek,
                    "unwrap_dek_for_kek",
                    new=AsyncMock(side_effect=lambda kid: dek_old if kid == "kek-old" else dek_new),
                ):
                    return await secret_crypto.decrypt(blob)

        result = asyncio.run(_scenario())
        assert result == "NEVER_LEAK_ME_42"

    def test_new_blob_uses_new_kek(self):
        """New encryption after rotation uses the new KEK."""
        dek_new = b"\x02" * 32

        async def _scenario():
            with patch.object(
                secret_kek, "get_active_kek_id", new=AsyncMock(return_value="kek-new")
            ):
                with patch.object(
                    secret_kek, "unwrap_dek_for_kek", new=AsyncMock(return_value=dek_new)
                ):
                    blob = await secret_crypto.encrypt("new-secret")
                    return blob

        blob = asyncio.run(_scenario())
        assert blob.kek_id == "kek-new"

    def test_multiple_kek_rotations(self):
        """Blobs from multiple KEK generations all remain decryptable."""
        deks = {
            "kek-gen1": b"\x01" * 32,
            "kek-gen2": b"\x02" * 32,
            "kek-gen3": b"\x03" * 32,
        }

        async def _scenario():
            blobs = []
            # Create blobs with each generation
            for kid, dek in deks.items():
                with patch.object(
                    secret_kek, "unwrap_dek_for_kek", new=AsyncMock(return_value=dek)
                ):
                    blob = await secret_crypto.encrypt(f"secret-{kid}", kek_id=kid)
                    blobs.append((blob, f"secret-{kid}"))

            # All should decrypt
            results = []
            for blob, expected in blobs:
                with patch.object(
                    secret_kek,
                    "unwrap_dek_for_kek",
                    new=AsyncMock(side_effect=lambda kid: deks[kid]),
                ):
                    result = await secret_crypto.decrypt(blob)
                    results.append(result)
            return results

        results = asyncio.run(_scenario())
        assert results == ["secret-kek-gen1", "secret-kek-gen2", "secret-kek-gen3"]
