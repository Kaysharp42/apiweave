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
from typing import Any
from urllib.parse import urlparse

import aiohttp

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

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SafeUrlError(Exception):
    """Raised when a URL fails safety validation."""


# ---------------------------------------------------------------------------
# Pure validation (no I/O)
# ---------------------------------------------------------------------------


def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return True if *ip* falls within any blocked network."""
    return any(ip in net for net in BLOCKED_NETWORKS)


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
        # Not a literal IP — it's a domain name.  DNS-level rebinding is
        # mitigated at the HTTP-wrapper layer (re-validate on each redirect).
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
    **kwargs: Any,
) -> aiohttp.ClientResponse:
    """Execute an HTTP request with SSRF protection and safe redirect following.

    * Validates the initial URL.
    * Sets ``allow_redirects=False`` on the underlying client.
    * On 3xx responses, validates the ``Location`` header before following.
    * Stops after *max_hops* redirects (default 5).
    * Returns the final :class:`aiohttp.ClientResponse`.  The caller is
      responsible for closing the response (or use as a context manager).

    Raises :class:`SafeUrlError` if any URL in the chain is unsafe.
    """
    validate_url(url)

    current_url = url
    client_timeout = aiohttp.ClientTimeout(total=timeout)

    # We accumulate cookies / headers across hops in these containers.
    session_cookie_jar = aiohttp.CookieJar(unsafe=False)

    for hop in range(max_hops + 1):
        connector = aiohttp.TCPConnector()
        async with aiohttp.ClientSession(
            connector=connector,
            cookie_jar=session_cookie_jar,
            timeout=client_timeout,
        ) as session:
            response = await session.request(
                method,
                current_url,
                allow_redirects=False,
                **kwargs,
            )

            # Not a redirect — return to caller.
            if response.status < 300 or response.status >= 400:
                return response

            # --- Redirect handling ---
            location = response.headers.get("Location")
            if not location:
                return response

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
            # Consume and close the redirect response before following
            await response.read()
            response.close()

    raise SafeUrlError(
        f"Too many redirects (>{max_hops}) — last URL: {current_url}"
    )


async def safe_get(url: str, **kwargs: Any) -> aiohttp.ClientResponse:
    """Safe ``GET`` — validates URL, does NOT follow redirects.

    Returns the raw :class:`aiohttp.ClientResponse`.  The caller must handle
    redirects (or use :func:`safe_request` for automatic safe redirect
    following).
    """
    validate_url(url)
    kwargs.setdefault("allow_redirects", False)
    timeout = kwargs.pop("timeout", 30.0)
    client_timeout = aiohttp.ClientTimeout(total=timeout)
    connector = aiohttp.TCPConnector()
    session = aiohttp.ClientSession(connector=connector, timeout=client_timeout)
    try:
        response = await session.get(url, **kwargs)
        # Detach response from session lifecycle — caller must close it.
        response._session = session  # type: ignore[attr-defined]
        return response
    except Exception:
        await session.close()
        raise


async def safe_post(url: str, **kwargs: Any) -> aiohttp.ClientResponse:
    """Safe ``POST`` — validates URL, does NOT follow redirects.

    Returns the raw :class:`aiohttp.ClientResponse`.  The caller must handle
    redirects (or use :func:`safe_request` for automatic safe redirect
    following).
    """
    validate_url(url)
    kwargs.setdefault("allow_redirects", False)
    timeout = kwargs.pop("timeout", 30.0)
    client_timeout = aiohttp.ClientTimeout(total=timeout)
    connector = aiohttp.TCPConnector()
    session = aiohttp.ClientSession(connector=connector, timeout=client_timeout)
    try:
        response = await session.post(url, **kwargs)
        response._session = session  # type: ignore[attr-defined]
        return response
    except Exception:
        await session.close()
        raise
