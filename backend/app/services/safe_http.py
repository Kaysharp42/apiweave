"""
Safe HTTP utility for SSRF prevention.

Provides URL validation and HTTP client wrappers that block requests to
private/internal networks, enforce scheme restrictions, and support an
optional domain allowlist.

All outbound HTTP in APIWeave should go through these wrappers.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import ssl
from typing import Any
from urllib.parse import urlparse

import aiohttp
from aiohttp.abc import AbstractResolver

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_SCHEMES: frozenset[str] = frozenset({"http", "https"})

MAX_REDIRECT_HOPS: int = 5

# Networks that must never be reached by outbound requests.
# Covers RFC1918, loopback, link-local (cloud metadata), multicast, and
# the equivalent IPv6 ranges.
BLOCKED_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    # IPv4
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local / AWS metadata
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("224.0.0.0/4"),  # multicast
    # IPv6
    ipaddress.ip_network("::/128"),  # unspecified
    ipaddress.ip_network("::1/128"),  # loopback
    ipaddress.ip_network("fc00::/7"),  # unique-local
    ipaddress.ip_network("fe80::/10"),  # link-local
    ipaddress.ip_network("ff00::/8"),  # multicast
]

# Loopback subset — surgically opt-in via settings.get_allow_loopback().
# RFC1918, link-local, and metadata stay blocked regardless of this set.
LOOPBACK_NETWORKS: frozenset[ipaddress.IPv4Network | ipaddress.IPv6Network] = frozenset(
    {
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("::1/128"),
    }
)

# Hostnames permitted to resolve into otherwise-blocked (private) space, but
# ONLY when loopback is opted in (single-user dev). host.docker.internal maps a
# containerized backend to its host machine; blocking its private resolution
# would break local self-hosting. Never honored in production.
DEV_ALLOWED_HOSTS: frozenset[str] = frozenset({"host.docker.internal"})

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SafeUrlError(Exception):
    """Raised when a URL fails safety validation."""


# ---------------------------------------------------------------------------
# Pure validation (no I/O)
# ---------------------------------------------------------------------------


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return True if *ip* falls within any blocked network.

    When ``settings.get_allow_loopback()`` is True, addresses in
    :data:`LOOPBACK_NETWORKS` (127.0.0.0/8 and ::1/128) are allowed through.
    RFC1918, link-local (including cloud metadata at 169.254.169.254),
    unique-local IPv6, multicast, and unspecified ranges remain blocked
    regardless of the flag.
    """
    if settings.get_allow_loopback() and any(ip in net for net in LOOPBACK_NETWORKS):
        return False
    return any(ip in net for net in BLOCKED_NETWORKS)


def _is_dev_allowed_host(host: str) -> bool:
    """Return True if *host* is a dev-only host allowed to resolve privately.

    Gated on ``settings.get_allow_loopback()`` so production (loopback off)
    never honors it.
    """
    return settings.get_allow_loopback() and host.lower() in DEV_ALLOWED_HOSTS


def _assert_resolved_ip_allowed(host: str, addr: str) -> None:
    """Raise :class:`SafeUrlError` if resolved *addr* is in a blocked network."""
    try:
        ip = ipaddress.ip_address(addr.split("%", 1)[0])  # strip any zone id
    except ValueError as exc:
        raise SafeUrlError(f"Host {host!r} resolved to unparseable address {addr!r}") from exc
    if _is_blocked_ip(ip):
        raise SafeUrlError(f"Host {host!r} resolves to blocked address {addr}")


class _SafeResolver(AbstractResolver):
    """aiohttp resolver that refuses hosts resolving to blocked networks.

    aiohttp connects to exactly the addresses this returns, so validating them
    here closes the validate-vs-connect gap (DNS rebinding): a hostname that
    resolves to a private/loopback/link-local/metadata IP is refused before any
    socket opens — for the initial request and every redirect hop, since the
    whole chain shares one connector. If *any* resolved address is blocked the
    host is rejected, so a mixed public+private answer cannot be exploited.
    """

    def __init__(self) -> None:
        self._inner = aiohttp.ThreadedResolver()

    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_INET
    ) -> list[Any]:
        infos = await self._inner.resolve(host, port, family)
        if not _is_dev_allowed_host(host):
            for info in infos:
                _assert_resolved_ip_allowed(host, str(info["host"]))
        return infos

    async def close(self) -> None:
        await self._inner.close()


def resolve_and_pin_ip(host: str) -> str | None:
    """Resolve *host*, reject it if any address is blocked, and return one
    approved IP to pin the connection to.

    Returns ``None`` for dev-allowed hosts (skip pinning) and for hosts that
    cannot be resolved (not an SSRF risk — let the caller's client surface the
    connection error). Raises :class:`SafeUrlError` if *any* resolved address
    is in a blocked network, so a mixed public+private DNS answer can't be
    exploited. Callers that connect to the returned IP (instead of re-resolving)
    close the validate-vs-connect gap for non-aiohttp clients (e.g. httpx).
    """
    if not host:
        raise SafeUrlError("Missing host")
    if _is_dev_allowed_host(host):
        return None
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return None
    addresses = [str(info[4][0]) for info in infos]
    for addr in addresses:
        _assert_resolved_ip_allowed(host, addr)
    return addresses[0] if addresses else None


def assert_host_resolves_safe(host: str) -> None:
    """Resolve *host* and raise :class:`SafeUrlError` if any address is blocked.

    Thin wrapper over :func:`resolve_and_pin_ip` for call-sites that only need
    the guard, not the pinned address.
    """
    resolve_and_pin_ip(host)


def _host_in_approved_domains(host: str) -> bool:
    """Return True if *host* is in the configured approved-domains list."""
    approved = settings.get_approved_domains_list()
    if not approved:
        return False
    host_lower = host.lower()
    return any(host_lower == domain.lower() for domain in approved)


def is_safe_url(url: str, *, allow_redirects: bool = True) -> bool:
    """Pure function — returns True if *url* passes all safety checks.

    Checks performed (no network I/O):
    1. Scheme must be ``http`` or ``https``.
    2. Hostname must be present.
    3. If the domain-allowlist flag is on, hostname must be in the list.
    4. If the hostname is a literal IP, it must not be in a blocked network.

    The *allow_redirects* flag is accepted for API symmetry with the HTTP
    wrappers but does not affect the pure validation result — redirect
    safety is enforced by :func:`safe_request` at the HTTP layer.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False

    # 1. Scheme
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False

    # 2. Hostname
    hostname = parsed.hostname
    if not hostname:
        return False

    hostname_lower = hostname.lower()

    # 3. Domain allowlist (only when the feature flag is on)
    if settings.APPROVED_DOMAINS_ENABLED:
        if not _host_in_approved_domains(hostname_lower):
            return False

    # 4. IP-literal block check
    try:
        ip = ipaddress.ip_address(hostname_lower)
        if _is_blocked_ip(ip):
            return False
    except ValueError:
        # Not a literal IP — it's a domain name. This pure check can't resolve
        # it; the connect-time enforcement (_SafeResolver / assert_host_resolves_safe)
        # rejects hostnames that resolve into blocked networks.
        pass

    return True


def validate_url(url: str) -> None:
    """Raise :class:`SafeUrlError` if *url* is not safe.

    Convenience wrapper around :func:`is_safe_url` for call-sites that prefer
    exceptions over boolean returns.
    """
    if not is_safe_url(url):
        raise SafeUrlError(f"URL blocked by safety policy: {url}")


def check_redirect_allowed(current_url: str, next_url: str) -> bool:
    """Return True if a redirect from *current_url* to *next_url* is allowed.

    The *next_url* is run through the same safety checks as a fresh request.
    Relative redirect targets are resolved against *current_url* first.
    """
    if not next_url:
        return False

    # Resolve relative redirects
    parsed_next = urlparse(next_url)
    if not parsed_next.scheme and not parsed_next.netloc:
        parsed_current = urlparse(current_url)
        # Build absolute URL from relative redirect
        next_url = f"{parsed_current.scheme}://{parsed_current.netloc}{next_url}"

    return is_safe_url(next_url)


# ---------------------------------------------------------------------------
# HTTP wrappers (aiohttp-based, fail-closed)
# ---------------------------------------------------------------------------


async def safe_request(
    method: str,
    url: str,
    *,
    max_hops: int = MAX_REDIRECT_HOPS,
    timeout: float = 30.0,
    follow_redirects: bool = True,
    ssl_verify: bool = True,
    **kwargs: Any,
) -> tuple[aiohttp.ClientResponse, aiohttp.ClientSession]:
    """Execute an HTTP request with SSRF protection and safe redirect following.

    * Validates the initial URL.
    * Sets ``allow_redirects=False`` on the underlying client.
    * On 3xx responses, validates the ``Location`` header before following
      (unless *follow_redirects* is False — then the first response is
      returned as-is).
    * Stops after *max_hops* redirects (default 5).
    * Returns a ``(response, session)`` tuple.

    *follow_redirects*: when False, the redirect loop is skipped and the
    first response (including 3xx) is returned to the caller.

    *ssl_verify*: when False, TLS certificate verification is disabled for
    this request. Defaults to True (verified). Do not disable in production
    unless you have a specific, documented reason.

    **Caller responsibilities.** The caller must close *both* the response
    (``response.close()``) and the session (``await session.close()``) — the
    session is kept open across the redirect chain so connection reuse works,
    and the final response remains readable for the lifetime of the session.

    The previous implementation closed the session before returning the
    response, which caused intermittent ``Connection closed`` errors when
    the caller tried to read the body.  Returning the session along with the
    response fixes that race.

    Raises :class:`SafeUrlError` if any URL in the chain is unsafe.
    """
    validate_url(url)

    current_url = url
    client_timeout = aiohttp.ClientTimeout(total=timeout)

    # SSL context: default (verified) or explicit unverified context.
    ssl_context: ssl.SSLContext | bool = ssl.create_default_context() if ssl_verify else False

    # Single session + connector for the whole redirect chain — enables
    # connection reuse across hops and lets the caller read the body of
    # the final response.
    session_cookie_jar = aiohttp.CookieJar(unsafe=False)
    connector = aiohttp.TCPConnector(ssl=ssl_context, resolver=_SafeResolver())
    session = aiohttp.ClientSession(
        connector=connector,
        cookie_jar=session_cookie_jar,
        timeout=client_timeout,
    )

    try:
        for hop in range(max_hops + 1):
            response = await session.request(
                method,
                current_url,
                allow_redirects=False,
                **kwargs,
            )

            # Not a redirect — return the live response and session so the
            # caller can read the body.
            if response.status < 300 or response.status >= 400:
                return response, session

            # Caller opted out of redirect following — return the 3xx as-is.
            if not follow_redirects:
                return response, session

            # --- Redirect handling ---
            location = response.headers.get("Location")
            if not location:
                return response, session

            # Resolve relative Location
            parsed_location = urlparse(location)
            if not parsed_location.scheme:
                parsed_current = urlparse(current_url)
                location = f"{parsed_current.scheme}://{parsed_current.netloc}{location}"

            if not check_redirect_allowed(current_url, location):
                response.close()
                raise SafeUrlError(
                    f"Redirect to blocked URL denied after {hop + 1} hop(s): {location}"
                )

            logger.debug("Following redirect hop %d: %s -> %s", hop + 1, current_url, location)
            current_url = location
            # Consume and close the redirect response before following —
            # releases the connection back to the pool for the next hop.
            await response.read()
            response.close()

        raise SafeUrlError(f"Too many redirects (>{max_hops}) — last URL: {current_url}")
    except BaseException:
        # SafeUrlError, validation errors, or cancellation: release the
        # session before propagating.  We use BaseException so the cleanup
        # also runs on asyncio.CancelledError and KeyboardInterrupt.
        await session.close()
        raise


async def safe_get(url: str, **kwargs: Any) -> tuple[aiohttp.ClientResponse, aiohttp.ClientSession]:
    """Safe ``GET`` — validates URL, does NOT follow redirects.

    Returns a ``(response, session)`` tuple.  The caller must close both.
    """
    validate_url(url)
    kwargs.setdefault("allow_redirects", False)
    timeout = kwargs.pop("timeout", 30.0)
    client_timeout = aiohttp.ClientTimeout(total=timeout)
    connector = aiohttp.TCPConnector(resolver=_SafeResolver())
    session = aiohttp.ClientSession(connector=connector, timeout=client_timeout)
    try:
        response = await session.get(url, **kwargs)
        return response, session
    except BaseException:
        await session.close()
        raise


async def safe_post(
    url: str, **kwargs: Any
) -> tuple[aiohttp.ClientResponse, aiohttp.ClientSession]:
    """Safe ``POST`` — validates URL, does NOT follow redirects.

    Returns a ``(response, session)`` tuple.  The caller must close both.
    """
    validate_url(url)
    kwargs.setdefault("allow_redirects", False)
    timeout = kwargs.pop("timeout", 30.0)
    client_timeout = aiohttp.ClientTimeout(total=timeout)
    connector = aiohttp.TCPConnector(resolver=_SafeResolver())
    session = aiohttp.ClientSession(connector=connector, timeout=client_timeout)
    try:
        response = await session.post(url, **kwargs)
        return response, session
    except BaseException:
        await session.close()
        raise
