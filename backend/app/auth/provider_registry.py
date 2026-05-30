from __future__ import annotations

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from authlib.integrations.httpx_client import AsyncOAuth2Client
from authlib.oauth2.auth import OAuth2Token
from httpx import AsyncClient

from app.config import settings


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    userinfo_url: str | None
    oidc: bool
    scopes: tuple[str, ...]


@dataclass(frozen=True)
class ProviderUserInfo:
    provider: str
    subject: str
    email: str | None
    email_verified: bool
    name: str | None
    avatar_url: str | None
    claims: dict[str, Any] | None = None


def _required(value: str | None, provider: str, setting_name: str) -> str:
    if not value:
        raise ValueError(f"OAuth provider {provider!r} is missing {setting_name}")
    return value


_KNOWN_PROVIDERS = ("github", "gitlab", "google", "microsoft")


def _build_provider_config(name: str) -> ProviderConfig:
    """Build and validate the config for a single provider."""
    microsoft_tenant = settings.MICROSOFT_TENANT or "common"
    if name == "github":
        return ProviderConfig(
            name="github",
            client_id=_required(settings.GITHUB_CLIENT_ID, "github", "GITHUB_CLIENT_ID"),
            client_secret=_required(
                settings.GITHUB_CLIENT_SECRET, "github", "GITHUB_CLIENT_SECRET"
            ),
            authorize_url="https://github.com/login/oauth/authorize",
            token_url="https://github.com/login/oauth/access_token",
            userinfo_url="https://api.github.com/user",
            oidc=False,
            scopes=("read:user", "user:email"),
        )
    if name == "gitlab":
        return ProviderConfig(
            name="gitlab",
            client_id=_required(settings.GITLAB_CLIENT_ID, "gitlab", "GITLAB_CLIENT_ID"),
            client_secret=_required(
                settings.GITLAB_CLIENT_SECRET, "gitlab", "GITLAB_CLIENT_SECRET"
            ),
            authorize_url="https://gitlab.com/oauth/authorize",
            token_url="https://gitlab.com/oauth/token",
            userinfo_url="https://gitlab.com/api/v4/user",
            oidc=False,
            scopes=("read_user",),
        )
    if name == "microsoft":
        return ProviderConfig(
            name="microsoft",
            client_id=_required(
                settings.MICROSOFT_CLIENT_ID, "microsoft", "MICROSOFT_CLIENT_ID"
            ),
            client_secret=_required(
                settings.MICROSOFT_CLIENT_SECRET, "microsoft", "MICROSOFT_CLIENT_SECRET"
            ),
            authorize_url=(
                f"https://login.microsoftonline.com/{microsoft_tenant}/oauth2/v2.0/authorize"
            ),
            token_url=(
                f"https://login.microsoftonline.com/{microsoft_tenant}/oauth2/v2.0/token"
            ),
            userinfo_url="https://graph.microsoft.com/v1.0/me",
            oidc=True,
            scopes=("openid", "profile", "email", "User.Read"),
        )
    if name == "google":
        return ProviderConfig(
            name="google",
            client_id=_required(settings.GOOGLE_CLIENT_ID, "google", "GOOGLE_CLIENT_ID"),
            client_secret=_required(
                settings.GOOGLE_CLIENT_SECRET, "google", "GOOGLE_CLIENT_SECRET"
            ),
            authorize_url="https://accounts.google.com/o/oauth2/auth",
            token_url="https://accounts.google.com/o/oauth2/token",
            userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
            oidc=True,
            scopes=("openid", "profile", "email"),
        )
    raise ValueError(f"Unsupported OAuth provider: {name}")


def _check_provider_enabled(name: str) -> bool:
    """Return True only if BOTH client_id and client_secret are set and non-empty."""
    if name == "github":
        return bool(settings.GITHUB_CLIENT_ID and settings.GITHUB_CLIENT_SECRET)
    if name == "gitlab":
        return bool(settings.GITLAB_CLIENT_ID and settings.GITLAB_CLIENT_SECRET)
    if name == "microsoft":
        return bool(settings.MICROSOFT_CLIENT_ID and settings.MICROSOFT_CLIENT_SECRET)
    if name == "google":
        return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    return False


def get_configured_providers() -> list[dict[str, Any]]:
    """Return enabled status for all known providers. Safe — no secrets exposed."""
    return [{"id": name, "enabled": _check_provider_enabled(name)} for name in _KNOWN_PROVIDERS]


def get_provider_config(name: str) -> ProviderConfig:
    provider = name.lower()
    if provider not in _KNOWN_PROVIDERS:
        raise ValueError(f"Unsupported OAuth provider: {name}")
    try:
        return _build_provider_config(provider)
    except ValueError as exc:
        raise ValueError(
            f"OAuth provider {provider!r} is not available or not configured"
        ) from exc


def generate_pkce_pair() -> tuple[str, str]:
    code_verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return code_verifier, code_challenge


def generate_nonce() -> str:
    return secrets.token_urlsafe(32)


def create_login_url(
    provider_config: ProviderConfig,
    state: str,
    nonce: str,
    code_challenge: str,
    redirect_uri: str | None = None,
) -> str:
    params = {
        "client_id": provider_config.client_id,
        "response_type": "code",
        "scope": " ".join(provider_config.scopes),
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if redirect_uri:
        params["redirect_uri"] = redirect_uri
    if provider_config.oidc:
        params["nonce"] = nonce
    return f"{provider_config.authorize_url}?{urlencode(params)}"


async def exchange_code_for_token(
    provider_config: ProviderConfig,
    code: str,
    redirect_uri: str,
    code_verifier: str,
) -> OAuth2Token:
    async with AsyncOAuth2Client(
        provider_config.client_id,
        provider_config.client_secret,
        scope=" ".join(provider_config.scopes),
        redirect_uri=redirect_uri,
    ) as client:
        token = await client.fetch_token(
            provider_config.token_url,
            code=code,
            grant_type="authorization_code",
            redirect_uri=redirect_uri,
            code_verifier=code_verifier,
        )
    return OAuth2Token(token)


def decode_id_token_claims(id_token: str) -> dict[str, Any]:
    parts = id_token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
        data = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


async def fetch_userinfo(
    provider: ProviderConfig,
    token_response: OAuth2Token | dict[str, Any],
    code_verifier: str,
) -> ProviderUserInfo:
    del code_verifier
    access_token = token_response.get("access_token")
    headers = {"Authorization": f"Bearer {access_token}"} if access_token else {}

    if provider.name == "github":
        async with AsyncClient() as client:
            user_response = await client.get(
                "https://api.github.com/user",
                headers=headers,
            )
            user_response.raise_for_status()
            emails_response = await client.get(
                "https://api.github.com/user/emails",
                headers=headers,
            )
            emails_response.raise_for_status()
        user = user_response.json()
        emails = emails_response.json()
        primary = next(
            (item for item in emails if item.get("primary") and item.get("verified")),
            None,
        )
        email = primary.get("email") if primary else None
        return ProviderUserInfo(
            provider="github",
            subject=str(user.get("id")),
            email=email,
            email_verified=email is not None,
            name=user.get("name") or user.get("login"),
            avatar_url=user.get("avatar_url"),
            claims=None,
        )

    if provider.name == "gitlab":
        async with AsyncClient() as client:
            response = await client.get("https://gitlab.com/api/v4/user", headers=headers)
            response.raise_for_status()
        user = response.json()
        verified = bool(user.get("confirmed_at"))
        return ProviderUserInfo(
            provider="gitlab",
            subject=str(user.get("id")),
            email=user.get("email") if verified else None,
            email_verified=verified,
            name=user.get("name") or user.get("username"),
            avatar_url=user.get("avatar_url"),
            claims=None,
        )

    if provider.name == "google":
        claims = decode_id_token_claims(str(token_response.get("id_token", "")))
        return ProviderUserInfo(
            provider="google",
            subject=str(claims.get("sub") or ""),
            email=claims.get("email"),
            email_verified=claims.get("email_verified") is True,
            name=claims.get("name"),
            avatar_url=claims.get("picture"),
            claims=claims,
        )

    if provider.name == "microsoft":
        claims = decode_id_token_claims(str(token_response.get("id_token", "")))
        email = claims.get("email") or claims.get("preferred_username")
        name = claims.get("name")
        if not email:
            async with AsyncClient() as client:
                response = await client.get("https://graph.microsoft.com/v1.0/me", headers=headers)
                response.raise_for_status()
            profile = response.json()
            email = profile.get("mail") or profile.get("userPrincipalName")
            name = name or profile.get("displayName")
        return ProviderUserInfo(
            provider="microsoft",
            subject=str(claims.get("sub") or claims.get("oid") or ""),
            email=email,
            email_verified=bool(email),
            name=name,
            avatar_url=None,
            claims=claims,
        )

    raise ValueError(f"Unsupported OAuth provider: {provider.name}")
