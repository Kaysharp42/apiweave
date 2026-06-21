"""
Tests for backend/app/services/safe_http.py — SSRF prevention utilities.

Covers:
- is_safe_url pure validation (no I/O)
- validate_url exception raising
- check_redirect_allowed
- safe_get / safe_post / safe_request (with mocked aiohttp)
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.safe_http import (
    BLOCKED_NETWORKS,
    MAX_REDIRECT_HOPS,
    SafeUrlError,
    check_redirect_allowed,
    is_safe_url,
    safe_get,
    safe_post,
    safe_request,
    validate_url,
)


def _patch_settings(
    *,
    approved_domains_enabled: bool = False,
    approved_domains: str = "",
):
    """Return a patch context manager that overrides the relevant settings."""
    mock_settings = MagicMock()
    mock_settings.APPROVED_DOMAINS_ENABLED = approved_domains_enabled
    mock_settings.get_approved_domains_list.return_value = [
        d.strip() for d in approved_domains.split(",") if d.strip()
    ]
    return patch("app.services.safe_http.settings", mock_settings)


class TestIsSafeUrlBlockedIPs:
    """Private / reserved IPs must be rejected."""

    @pytest.mark.parametrize(
        "url",
        [
            "http://127.0.0.1/",
            "http://127.0.0.1:8080/secret",
            "https://127.0.0.1/",
            "http://127.255.255.255/",
        ],
        ids=["loopback", "loopback-port", "loopback-https", "loopback-high"],
    )
    def test_loopback_ipv4(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://10.0.0.1/",
            "http://10.255.255.255/",
            "https://10.10.10.10/",
        ],
        ids=["10-net", "10-net-high", "10-net-https"],
    )
    def test_private_10(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://169.254.169.254/",
            "http://169.254.169.254/latest/meta-data/",
            "http://169.254.0.1/",
        ],
        ids=["aws-metadata", "aws-metadata-path", "link-local"],
    )
    def test_link_local_metadata(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://192.168.1.1/",
            "http://192.168.0.0/",
            "https://192.168.100.200/",
        ],
        ids=["192.168", "192.168-zero", "192.168-https"],
    )
    def test_private_192_168(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://172.16.0.0/",
        ],
        ids=["172.16", "172.31", "172.16-zero"],
    )
    def test_private_172_16(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://0.0.0.0/",
            "http://0.0.0.1/",
            "http://0.1.2.3/",
        ],
        ids=["0.0.0.0", "0.0.0.1", "0.x"],
    )
    def test_zero_net(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://224.0.0.1/",
            "http://239.255.255.255/",
        ],
        ids=["multicast-low", "multicast-high"],
    )
    def test_multicast_ipv4(self, url: str):
        assert is_safe_url(url) is False


class TestIsSafeUrlBlockedIPv6:
    """Private / reserved IPv6 addresses must be rejected."""

    @pytest.mark.parametrize(
        "url",
        [
            "http://[::1]/",
            "http://[::1]:8080/",
            "https://[::1]/",
        ],
        ids=["loopback", "loopback-port", "loopback-https"],
    )
    def test_loopback_ipv6(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://[fe80::1]/",
            "http://[fe80::abcd:1234]/",
        ],
        ids=["link-local", "link-local-full"],
    )
    def test_link_local_ipv6(self, url: str):
        assert is_safe_url(url) is False

    @pytest.mark.parametrize(
        "url",
        [
            "http://[fc00::1]/",
            "http://[fd00::1]/",
            "http://[fd12:3456:789a::1]/",
        ],
        ids=["unique-local", "fd00", "fd-full"],
    )
    def test_unique_local_ipv6(self, url: str):
        assert is_safe_url(url) is False

    def test_unspecified_ipv6(self):
        assert is_safe_url("http://[::]/") is False

    def test_multicast_ipv6(self):
        assert is_safe_url("http://[ff00::1]/") is False


class TestIsSafeUrlAllowed:
    """Public URLs should pass when no allowlist is active."""

    def test_example_com(self):
        with _patch_settings(approved_domains_enabled=False):
            assert is_safe_url("http://example.com/") is True

    def test_example_com_https(self):
        with _patch_settings(approved_domains_enabled=False):
            assert is_safe_url("https://example.com/") is True

    def test_subdomain(self):
        with _patch_settings(approved_domains_enabled=False):
            assert is_safe_url("https://api.example.com/") is True

    def test_public_ip(self):
        with _patch_settings(approved_domains_enabled=False):
            assert is_safe_url("http://8.8.8.8/") is True

    def test_public_ipv6(self):
        with _patch_settings(approved_domains_enabled=False):
            assert is_safe_url("http://[2607:f8b0:4004:800::200e]/") is True


class TestIsSafeUrlAllowlist:
    """When APPROVED_DOMAINS_ENABLED is True, only listed domains pass."""

    def test_approved_domain_passes(self):
        with _patch_settings(
            approved_domains_enabled=True,
            approved_domains="example.com,api.example.com",
        ):
            assert is_safe_url("https://example.com/") is True

    def test_unapproved_subdomain_blocked(self):
        """Exact match only — subdomains not explicitly listed are blocked."""
        with _patch_settings(
            approved_domains_enabled=True,
            approved_domains="example.com",
        ):
            assert is_safe_url("https://api.example.com/") is False

    def test_unapproved_domain_blocked(self):
        with _patch_settings(
            approved_domains_enabled=True,
            approved_domains="example.com",
        ):
            assert is_safe_url("https://evil.com/") is False

    def test_case_insensitive_match(self):
        with _patch_settings(
            approved_domains_enabled=True,
            approved_domains="Example.COM",
        ):
            assert is_safe_url("https://example.com/") is True

    def test_private_ip_still_blocked_even_if_approved(self):
        """Private IPs must be blocked regardless of allowlist."""
        with _patch_settings(
            approved_domains_enabled=True,
            approved_domains="127.0.0.1",
        ):
            assert is_safe_url("http://127.0.0.1/") is False


class TestIsSafeUrlSchemeRejection:
    """Non-HTTP schemes must be rejected."""

    @pytest.mark.parametrize(
        "url",
        [
            "gopher://evil.com/",
            "file:///etc/passwd",
            "ftp://files.example.com/",
            "javascript:alert(1)",
            "data:text/html,<h1>hi</h1>",
            "",
        ],
        ids=["gopher", "file", "ftp", "javascript", "data", "empty"],
    )
    def test_blocked_schemes(self, url: str):
        assert is_safe_url(url) is False


class TestIsSafeUrlMissingHost:
    """URLs without a hostname must be rejected."""

    def test_no_host(self):
        assert is_safe_url("http://") is False

    def test_scheme_only(self):
        assert is_safe_url("http:///path") is False


class TestIsSafeUrlPurity:
    """is_safe_url must be a pure function — no network calls."""

    def test_no_network_calls(self):
        """Calling is_safe_url many times should not open sockets."""
        with _patch_settings(approved_domains_enabled=False):
            for _ in range(100):
                result = is_safe_url("https://example.com/")
                assert result is True

    def test_returns_bool(self):
        with _patch_settings(approved_domains_enabled=False):
            assert isinstance(is_safe_url("https://example.com/"), bool)
            assert isinstance(is_safe_url("http://127.0.0.1/"), bool)


class TestValidateUrl:
    """validate_url should raise SafeUrlError for unsafe URLs."""

    def test_raises_on_loopback(self):
        with pytest.raises(SafeUrlError, match="blocked by safety policy"):
            validate_url("http://127.0.0.1/")

    def test_raises_on_private(self):
        with pytest.raises(SafeUrlError):
            validate_url("http://10.0.0.1/")

    def test_raises_on_metadata(self):
        with pytest.raises(SafeUrlError):
            validate_url("http://169.254.169.254/")

    def test_raises_on_ipv6_loopback(self):
        with pytest.raises(SafeUrlError):
            validate_url("http://[::1]/")

    def test_raises_on_bad_scheme(self):
        with pytest.raises(SafeUrlError):
            validate_url("file:///etc/passwd")

    def test_passes_on_public(self):
        with _patch_settings(approved_domains_enabled=False):
            validate_url("https://example.com/")

    def test_safe_url_error_is_exception(self):
        assert issubclass(SafeUrlError, Exception)


class TestCheckRedirectAllowed:
    """Redirect validation must re-check the target URL."""

    def test_safe_redirect(self):
        with _patch_settings(approved_domains_enabled=False):
            assert check_redirect_allowed(
                "https://example.com/a",
                "https://example.com/b",
            ) is True

    def test_redirect_to_loopback_blocked(self):
        assert check_redirect_allowed(
            "https://example.com/",
            "http://127.0.0.1/",
        ) is False

    def test_redirect_to_private_blocked(self):
        assert check_redirect_allowed(
            "https://example.com/",
            "http://169.254.169.254/latest/meta-data/",
        ) is False

    def test_relative_redirect_resolved(self):
        with _patch_settings(approved_domains_enabled=False):
            assert check_redirect_allowed(
                "https://example.com/path",
                "/other-path",
            ) is True

    def test_relative_redirect_to_empty(self):
        assert check_redirect_allowed("https://example.com/", "") is False

    def test_redirect_to_ipv6_loopback_blocked(self):
        assert check_redirect_allowed(
            "https://example.com/",
            "http://[::1]/",
        ) is False


class TestSafeGet:
    """safe_get must validate URL before making request."""

    @pytest.mark.asyncio
    async def test_blocks_private_url(self):
        with pytest.raises(SafeUrlError):
            await safe_get("http://127.0.0.1/")

    @pytest.mark.asyncio
    async def test_blocks_bad_scheme(self):
        with pytest.raises(SafeUrlError):
            await safe_get("file:///etc/passwd")

    @pytest.mark.asyncio
    async def test_calls_aiohttp_for_safe_url(self):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_session = AsyncMock()
        mock_session.get.return_value = mock_response

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            response, session = await safe_get("https://example.com/api")
            assert response is mock_response
            assert session is mock_session


class TestSafePost:
    """safe_post must validate URL before making request."""

    @pytest.mark.asyncio
    async def test_blocks_private_url(self):
        with pytest.raises(SafeUrlError):
            await safe_post("http://192.168.1.1/", json={"key": "val"})

    @pytest.mark.asyncio
    async def test_calls_aiohttp_for_safe_url(self):
        mock_response = MagicMock()
        mock_response.status = 201
        mock_session = AsyncMock()
        mock_session.post.return_value = mock_response

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            response, session = await safe_post("https://example.com/api", json={"key": "val"})
            assert response is mock_response
            assert session is mock_session


class TestSafeRequest:
    """safe_request follows redirects safely, re-validating each hop."""

    @pytest.mark.asyncio
    async def test_blocks_initial_private_url(self):
        with pytest.raises(SafeUrlError):
            await safe_request("GET", "http://10.0.0.1/")

    @pytest.mark.asyncio
    async def test_no_redirect_returns_response(self):
        mock_response = MagicMock()
        mock_response.status = 200

        mock_session = AsyncMock()
        mock_session.request.return_value = mock_response

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            response, session = await safe_request("GET", "https://example.com/api")
            assert response is mock_response
            assert session is mock_session

    @pytest.mark.asyncio
    async def test_returned_session_keeps_response_readable(self):
        """Regression: returning the response after the session closed made
        ``response.text()`` fail with ``Connection closed`` once the caller
        tried to read the body.  Verify that after ``safe_request`` returns
        the caller can still read the body — the session must remain open.
        """
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.text = AsyncMock(return_value='{"ok": true}')

        mock_session = AsyncMock()
        mock_session.request.return_value = mock_response
        mock_session.close = AsyncMock()

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            response, session = await safe_request("GET", "https://example.com/api")
            body = await response.text()
            assert body == '{"ok": true}'
            mock_session.close.assert_not_awaited()
            await session.close()
            mock_session.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_blocks_redirect_to_private(self):
        redirect_response = MagicMock()
        redirect_response.status = 302
        redirect_response.headers = {"Location": "http://169.254.169.254/"}
        redirect_response.read = AsyncMock()
        redirect_response.close = MagicMock()

        mock_session = AsyncMock()
        mock_session.request.return_value = redirect_response
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            with pytest.raises(SafeUrlError, match="Redirect to blocked URL"):
                await safe_request("GET", "https://example.com/")

    @pytest.mark.asyncio
    async def test_follows_safe_redirect(self):
        redirect_response = MagicMock()
        redirect_response.status = 302
        redirect_response.headers = {"Location": "https://example.com/final"}
        redirect_response.read = AsyncMock()
        redirect_response.close = MagicMock()

        final_response = MagicMock()
        final_response.status = 200

        call_count = 0

        async def mock_request(method, url, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return redirect_response
            return final_response

        mock_session = AsyncMock()
        mock_session.request = mock_request
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            response, session = await safe_request("GET", "https://example.com/start")
            assert response is final_response
            assert session is mock_session

    @pytest.mark.asyncio
    async def test_too_many_redirects(self):
        redirect_response = MagicMock()
        redirect_response.status = 302
        redirect_response.headers = {"Location": "https://example.com/loop"}
        redirect_response.read = AsyncMock()
        redirect_response.close = MagicMock()

        mock_session = AsyncMock()
        mock_session.request.return_value = redirect_response
        mock_session.close = AsyncMock()

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            with pytest.raises(SafeUrlError, match="Too many redirects"):
                await safe_request("GET", "https://example.com/", max_hops=3)
            mock_session.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_follow_redirects_false_returns_3xx_as_is(self):
        redirect_response = MagicMock()
        redirect_response.status = 302
        redirect_response.headers = {"Location": "https://example.com/final"}

        mock_session = AsyncMock()
        mock_session.request.return_value = redirect_response

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector"),
        ):
            response, session = await safe_request(
                "GET", "https://example.com/start", follow_redirects=False
            )
            assert response is redirect_response
            assert response.status == 302
            mock_session.request.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_ssl_verify_false_passes_false_to_connector(self):
        mock_response = MagicMock()
        mock_response.status = 200

        mock_session = AsyncMock()
        mock_session.request.return_value = mock_response

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector") as mock_connector_cls,
        ):
            await safe_request("GET", "https://example.com/", ssl_verify=False)
            mock_connector_cls.assert_called_once_with(ssl=False)

    @pytest.mark.asyncio
    async def test_ssl_verify_true_passes_default_context(self):
        import ssl as ssl_module

        mock_response = MagicMock()
        mock_response.status = 200

        mock_session = AsyncMock()
        mock_session.request.return_value = mock_response

        with (
            _patch_settings(approved_domains_enabled=False),
            patch("app.services.safe_http.aiohttp.ClientSession", return_value=mock_session),
            patch("app.services.safe_http.aiohttp.TCPConnector") as mock_connector_cls,
        ):
            await safe_request("GET", "https://example.com/", ssl_verify=True)
            call_kwargs = mock_connector_cls.call_args.kwargs
            ssl_arg = call_kwargs.get("ssl")
            assert isinstance(ssl_arg, ssl_module.SSLContext)


class TestBlockedNetworksConfig:
    """Verify the blocked-networks list is correctly configured."""

    def test_contains_loopback(self):
        import ipaddress

        loopback = ipaddress.ip_address("127.0.0.1")
        assert any(loopback in net for net in BLOCKED_NETWORKS)

    def test_contains_metadata(self):
        import ipaddress

        metadata = ipaddress.ip_address("169.254.169.254")
        assert any(metadata in net for net in BLOCKED_NETWORKS)

    def test_contains_ipv6_loopback(self):
        import ipaddress

        lo6 = ipaddress.ip_address("::1")
        assert any(lo6 in net for net in BLOCKED_NETWORKS)

    def test_does_not_block_public_ip(self):
        import ipaddress

        public = ipaddress.ip_address("8.8.8.8")
        assert not any(public in net for net in BLOCKED_NETWORKS)

    def test_max_redirect_hops(self):
        assert MAX_REDIRECT_HOPS == 5
