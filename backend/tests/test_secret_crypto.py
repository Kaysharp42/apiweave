"""
Tests for AES-256-GCM envelope encryption (secret_crypto) and KEK rotation.

Covers:
- Round-trip encrypt/decrypt
- Nonce uniqueness (different ciphertexts for same plaintext)
- EncryptedBlob structure (kek_id, algorithm, base64 nonce)
- Tampered ciphertext raises InvalidTag
- Missing KEK record raises ValueError
- KEK rotation: old blobs still decrypt after rotation
- EnvironmentRepository.set_secret / get_secret round-trip
"""
from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.exceptions import InvalidTag

from app.models import EncryptedBlob
from app.services import secret_crypto, secret_kek


_DEK = b"\x00" * 32  # deterministic 256-bit DEK for tests
_KEK_ID = "kek-test-001"


@pytest.fixture(autouse=True)
def _mock_kek_layer():
    """Mock the KEK layer so tests don't need MongoDB."""
    with (
        patch.object(secret_kek, "get_active_kek_id", new=AsyncMock(return_value=_KEK_ID)),
        patch.object(secret_kek, "unwrap_dek_for_kek", new=AsyncMock(return_value=_DEK)),
    ):
        yield


class TestEncryptDecryptRoundTrip:
    def test_round_trip_returns_original(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("my-secret-value"))
        result = asyncio.run(secret_crypto.decrypt(blob))
        assert result == "my-secret-value"

    def test_round_trip_unicode(self):
        import asyncio

        plaintext = "héllo wörld 🌍"
        blob = asyncio.run(secret_crypto.encrypt(plaintext))
        result = asyncio.run(secret_crypto.decrypt(blob))
        assert result == plaintext

    def test_round_trip_empty_string(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt(""))
        result = asyncio.run(secret_crypto.decrypt(blob))
        assert result == ""


class TestNonceUniqueness:
    def test_different_nonces_produce_different_ciphertexts(self):
        import asyncio

        blob1 = asyncio.run(secret_crypto.encrypt("same-plaintext"))
        blob2 = asyncio.run(secret_crypto.encrypt("same-plaintext"))
        assert blob1.ciphertext != blob2.ciphertext
        assert blob1.nonce != blob2.nonce


class TestEncryptedBlobStructure:
    def test_blob_has_correct_kek_id(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("test"))
        assert blob.kek_id == _KEK_ID

    def test_blob_has_correct_algorithm(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("test"))
        assert blob.algorithm == "aes-256-gcm"

    def test_blob_nonce_is_valid_base64(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("test"))
        decoded = base64.b64decode(blob.nonce)
        assert len(decoded) == 12

    def test_blob_ciphertext_is_valid_base64(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("test"))
        decoded = base64.b64decode(blob.ciphertext)
        assert len(decoded) > 0


class TestDecryptTamperedCiphertext:
    def test_tampered_ciphertext_raises_invalid_token(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("secret"))
        raw = base64.b64decode(blob.ciphertext)
        tampered = bytes([raw[0] ^ 0xFF]) + raw[1:]
        tampered_blob = EncryptedBlob(
            ciphertext=tampered,
            kek_id=blob.kek_id,
            algorithm=blob.algorithm,
            nonce=blob.nonce,
        )
        with pytest.raises(InvalidTag):
            asyncio.run(secret_crypto.decrypt(tampered_blob))


class TestDecryptMissingKek:
    def test_missing_kek_raises_value_error(self):
        import asyncio

        blob = asyncio.run(secret_crypto.encrypt("secret"))

        with patch.object(
            secret_kek,
            "unwrap_dek_for_kek",
            new=AsyncMock(side_effect=ValueError("KEK record 'kek-gone' not found")),
        ):
            bad_blob = EncryptedBlob(
                ciphertext=blob.ciphertext,
                kek_id="kek-gone",
                algorithm=blob.algorithm,
                nonce=blob.nonce,
            )
            with pytest.raises(ValueError, match="not found"):
                asyncio.run(secret_crypto.decrypt(bad_blob))


class TestKekRotation:
    def test_old_blob_decrypts_after_rotation(self):
        import asyncio

        dek1 = b"\x01" * 32
        dek2 = b"\x02" * 32

        async def _rotate_scenario():
            with patch.object(secret_kek, "get_active_kek_id", new=AsyncMock(return_value="kek-1")):
                with patch.object(secret_kek, "unwrap_dek_for_kek", new=AsyncMock(side_effect=lambda kid: dek1 if kid == "kek-1" else dek2)):
                    blob = await secret_crypto.encrypt("rotate-me", kek_id="kek-1")

            with patch.object(secret_kek, "get_active_kek_id", new=AsyncMock(return_value="kek-2")):
                with patch.object(secret_kek, "unwrap_dek_for_kek", new=AsyncMock(side_effect=lambda kid: dek1 if kid == "kek-1" else dek2)):
                    result = await secret_crypto.decrypt(blob)

            return result

        assert asyncio.run(_rotate_scenario()) == "rotate-me"


class TestEnvironmentRepositorySecrets:
    def test_set_and_get_secret_round_trip(self):
        import asyncio
        from app.repositories.environment_repository import EnvironmentRepository

        mock_env = MagicMock()
        mock_env.secrets = {}
        mock_env.save = AsyncMock()

        async def _round_trip():
            with patch.object(EnvironmentRepository, "get_by_id", new=AsyncMock(return_value=mock_env)):
                await EnvironmentRepository.set_secret("env-1", "api_key", "sk_live_abc")

            stored = mock_env.secrets["api_key"]
            assert isinstance(stored, dict)
            assert "ciphertext" in stored
            assert stored["kek_id"] == _KEK_ID
            assert stored["algorithm"] == "aes-256-gcm"

            with patch.object(EnvironmentRepository, "get_by_id", new=AsyncMock(return_value=mock_env)):
                return await EnvironmentRepository.get_secret("env-1", "api_key")

        result = asyncio.run(_round_trip())
        assert result == "sk_live_abc"

    def test_get_secret_legacy_plaintext(self):
        import asyncio
        from app.repositories.environment_repository import EnvironmentRepository

        mock_env = MagicMock()
        mock_env.secrets = {"old_key": "plain-value"}

        async def _legacy():
            with patch.object(EnvironmentRepository, "get_by_id", new=AsyncMock(return_value=mock_env)):
                return await EnvironmentRepository.get_secret("env-1", "old_key")

        assert asyncio.run(_legacy()) == "plain-value"

    def test_get_secret_missing_key_returns_none(self):
        import asyncio
        from app.repositories.environment_repository import EnvironmentRepository

        mock_env = MagicMock()
        mock_env.secrets = {}

        async def _missing():
            with patch.object(EnvironmentRepository, "get_by_id", new=AsyncMock(return_value=mock_env)):
                return await EnvironmentRepository.get_secret("env-1", "nope")

        assert asyncio.run(_missing()) is None
