"""
Tests for webhook authentication middleware
"""

import time
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.middleware.webhook_auth import (
    InvalidSignatureError,
    InvalidTokenError,
    ReplayAttackError,
    authenticate_webhook_request,
    generate_hmac_signature,
    validate_hmac_signature,
    validate_webhook_token,
)


@pytest.fixture
def mock_webhook():
    """Create a mock webhook for testing using SimpleNamespace"""
    return SimpleNamespace(
        webhookId="wh-test123",
        resourceType="workflow",
        resourceId="wf-abc123",
        environmentId="env-test",
        token="wht_test_token_abc123",
        hmacSecret="test_secret_key_xyz789",
        enabled=True,
        createdAt=datetime.now(UTC),
        updatedAt=datetime.now(UTC),
        usageCount=0,
    )


@pytest.fixture
def mock_request():
    """Create a mock FastAPI request"""
    request = Mock()
    request.headers = {
        "X-Webhook-Token": "wht_test_token_abc123",
        "X-Webhook-Timestamp": str(int(time.time())),
        "X-Webhook-Signature": "",
    }
    request.body = AsyncMock(return_value=b'{"test": "data"}')
    return request


class TestTokenValidation:
    """Tests for webhook token validation"""

    @pytest.mark.asyncio
    async def test_valid_token(self, mock_webhook):
        """Test validation with correct token"""
        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            result = await validate_webhook_token("wh-test123", "wht_test_token_abc123")
            assert result is True

    @pytest.mark.asyncio
    async def test_invalid_token(self, mock_webhook):
        """Test validation with incorrect token"""
        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            with pytest.raises(InvalidTokenError, match="Invalid webhook token"):
                await validate_webhook_token("wh-test123", "wrong_token")

    @pytest.mark.asyncio
    async def test_webhook_not_found(self):
        """Test validation when webhook doesn't exist"""
        with patch("app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=None):
            with pytest.raises(InvalidTokenError, match="Webhook not found"):
                await validate_webhook_token("wh-nonexistent", "any_token")

    @pytest.mark.asyncio
    async def test_disabled_webhook(self, mock_webhook):
        """Test validation when webhook is disabled"""
        mock_webhook.enabled = False
        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            with pytest.raises(InvalidTokenError, match="Webhook is disabled"):
                await validate_webhook_token("wh-test123", "wht_test_token_abc123")


class TestHMACSignature:
    """Tests for HMAC signature generation and validation"""

    def test_generate_signature(self):
        """Test HMAC signature generation"""
        secret = "test_secret"
        timestamp = "1699123456"
        body = b'{"test": "data"}'

        signature = generate_hmac_signature(secret, timestamp, body)

        # Verify it's a valid hex string
        assert len(signature) == 64  # SHA256 produces 64 hex characters
        assert all(c in "0123456789abcdef" for c in signature)

    def test_signature_deterministic(self):
        """Test that same inputs produce same signature"""
        secret = "test_secret"
        timestamp = "1699123456"
        body = b'{"test": "data"}'

        sig1 = generate_hmac_signature(secret, timestamp, body)
        sig2 = generate_hmac_signature(secret, timestamp, body)

        assert sig1 == sig2

    def test_signature_changes_with_body(self):
        """Test that different bodies produce different signatures"""
        secret = "test_secret"
        timestamp = "1699123456"

        sig1 = generate_hmac_signature(secret, timestamp, b'{"test": "data1"}')
        sig2 = generate_hmac_signature(secret, timestamp, b'{"test": "data2"}')

        assert sig1 != sig2

    def test_signature_changes_with_timestamp(self):
        """Test that different timestamps produce different signatures"""
        secret = "test_secret"
        body = b'{"test": "data"}'

        sig1 = generate_hmac_signature(secret, "1699123456", body)
        sig2 = generate_hmac_signature(secret, "1699123457", body)

        assert sig1 != sig2

    @pytest.mark.asyncio
    async def test_valid_signature(self, mock_webhook):
        """Test validation with correct HMAC signature"""
        timestamp = str(int(time.time()))
        body = b'{"test": "data"}'
        signature = generate_hmac_signature(mock_webhook.hmacSecret, timestamp, body)

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            result = await validate_hmac_signature("wh-test123", signature, timestamp, body)
            assert result is True

    @pytest.mark.asyncio
    async def test_invalid_signature(self, mock_webhook):
        """Test validation with incorrect HMAC signature"""
        timestamp = str(int(time.time()))
        body = b'{"test": "data"}'
        wrong_signature = "0" * 64  # Invalid signature

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            with pytest.raises(InvalidSignatureError, match="Invalid HMAC signature"):
                await validate_hmac_signature("wh-test123", wrong_signature, timestamp, body)

    @pytest.mark.asyncio
    async def test_old_timestamp(self, mock_webhook):
        """Test validation with old timestamp (replay attack)"""
        old_timestamp = str(int(time.time()) - 400)  # 400 seconds ago
        body = b'{"test": "data"}'
        signature = generate_hmac_signature(mock_webhook.hmacSecret, old_timestamp, body)

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            with pytest.raises(ReplayAttackError, match="Timestamp too old"):
                await validate_hmac_signature(
                    "wh-test123",
                    signature,
                    old_timestamp,
                    body,
                    max_age_seconds=300,  # 5 minutes
                )

    @pytest.mark.asyncio
    async def test_future_timestamp(self, mock_webhook):
        """Test validation with future timestamp"""
        future_timestamp = str(int(time.time()) + 400)  # 400 seconds in future
        body = b'{"test": "data"}'
        signature = generate_hmac_signature(mock_webhook.hmacSecret, future_timestamp, body)

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            with pytest.raises(ReplayAttackError, match="Timestamp too old/new"):
                await validate_hmac_signature(
                    "wh-test123", signature, future_timestamp, body, max_age_seconds=300
                )

    @pytest.mark.asyncio
    async def test_invalid_timestamp_format(self, mock_webhook):
        """Test validation with invalid timestamp format"""
        body = b'{"test": "data"}'
        signature = "0" * 64

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            with pytest.raises(ReplayAttackError, match="Invalid timestamp format"):
                await validate_hmac_signature("wh-test123", signature, "not_a_number", body)


class TestRequestAuthentication:
    """Tests for full request authentication"""

    @pytest.mark.asyncio
    async def test_successful_authentication(self, mock_webhook, mock_request):
        """Test successful authentication with valid token and signature"""
        # Generate valid signature
        timestamp = mock_request.headers["X-Webhook-Timestamp"]
        body = await mock_request.body()
        signature = generate_hmac_signature(mock_webhook.hmacSecret, timestamp, body)
        mock_request.headers["X-Webhook-Signature"] = signature

        # Reset body mock for actual test
        mock_request.body = AsyncMock(return_value=body)

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            success, error = await authenticate_webhook_request(mock_request, "wh-test123")
            assert success is True
            assert error is None

    @pytest.mark.asyncio
    async def test_missing_token_header(self, mock_webhook, mock_request):
        """Test authentication with missing token header"""
        del mock_request.headers["X-Webhook-Token"]

        success, error = await authenticate_webhook_request(mock_request, "wh-test123")
        assert success is False
        assert error is not None
        assert "Missing X-Webhook-Token" in error

    @pytest.mark.asyncio
    async def test_missing_signature_header(self, mock_webhook, mock_request):
        """Test authentication with missing signature header"""
        del mock_request.headers["X-Webhook-Signature"]

        success, error = await authenticate_webhook_request(mock_request, "wh-test123")
        assert success is False
        assert error is not None
        assert "Missing X-Webhook-Signature" in error

    @pytest.mark.asyncio
    async def test_missing_timestamp_header(self, mock_webhook, mock_request):
        """Test authentication with missing timestamp header"""
        mock_request.headers["X-Webhook-Signature"] = "some-signature-value"
        del mock_request.headers["X-Webhook-Timestamp"]

        success, error = await authenticate_webhook_request(mock_request, "wh-test123")
        assert success is False
        assert error is not None
        assert "Missing X-Webhook-Timestamp" in error

    @pytest.mark.asyncio
    async def test_invalid_token_error(self, mock_webhook, mock_request):
        """Test authentication with invalid token"""
        mock_request.headers["X-Webhook-Token"] = "wrong_token"
        mock_request.headers["X-Webhook-Signature"] = "0" * 64

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            success, error = await authenticate_webhook_request(mock_request, "wh-test123")
            assert success is False
            assert error is not None
            assert "Token validation failed" in error

    @pytest.mark.asyncio
    async def test_invalid_signature_error(self, mock_webhook, mock_request):
        """Test authentication with invalid signature"""
        mock_request.headers["X-Webhook-Signature"] = "0" * 64

        with patch(
            "app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=mock_webhook
        ):
            success, error = await authenticate_webhook_request(mock_request, "wh-test123")
            assert success is False
            assert error is not None
            assert "Signature validation failed" in error


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
