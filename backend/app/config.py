import base64
import logging
import os
from typing import Literal
from urllib.parse import urlparse

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    APP_NAME: str = "APIWeave"
    VERSION: str = "0.1.0"
    DEBUG: bool = False
    APP_ENV: str = "development"
    BASE_URL: str
    FRONTEND_URL: str | None = None
    PUBLIC_BASE_URL: str = "http://localhost:3000"

    MONGODB_URL: str
    MONGODB_DB_NAME: str

    ALLOWED_ORIGINS: str
    TRUSTED_HOSTS: str = "localhost,127.0.0.1"

    API_KEY_HEADER: str = "Authorization"

    WORKER_POLL_INTERVAL: int = 5
    WORKER_MAX_RETRIES: int = 3

    ARTIFACTS_PATH: str = "./artifacts"

    SECRET_KEY: str

    SECRET_ENCRYPTION_KEY: str = ""

    OAUTH_LOGIN_ENABLED: bool = False

    GITHUB_CLIENT_ID: str | None = None
    GITHUB_CLIENT_SECRET: str | None = None
    GITLAB_CLIENT_ID: str | None = None
    GITLAB_CLIENT_SECRET: str | None = None
    MICROSOFT_CLIENT_ID: str | None = None
    MICROSOFT_CLIENT_SECRET: str | None = None
    MICROSOFT_TENANT: str = "common"
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None

    SESSION_SECRET_KEY: str | None = None
    SESSION_MAX_IDLE_MINUTES: int = 720
    SESSION_MAX_ABSOLUTE_MINUTES: int = 10080
    SESSION_COOKIE_SECURE: bool = True
    SESSION_COOKIE_SAMESITE: str = "lax"
    CSRF_ENABLED: bool = True

    WEBHOOK_REQUIRE_HMAC: bool = False
    APPROVED_DOMAINS_ENABLED: bool = False
    APPROVED_DOMAINS: str = ""
    SETUP_MODE_ENABLED: bool = True

    # Passwordless email magic-link sign-in (multi_tenant only). Requires SMTP.
    EMAIL_LOGIN_ENABLED: bool = False
    # Who may obtain a new account. "invite_only": existing users + pending
    # invites only (self-host default). "open": anyone whose email passes the
    # approved-domains policy may sign up (e.g. public hosted with approved
    # domains set). Approved-domains is always enforced when enabled, in both
    # modes. Magic-link TTL in minutes.
    REGISTRATION_MODE: Literal["invite_only", "open"] = "invite_only"
    EMAIL_LOGIN_TOKEN_TTL_MINUTES: int = 15

    # Deployment mode:
    #   - "single_user":  self-hosted, no OAuth. A synthetic owner User is
    #     auto-created on first request and used for every API call. No
    #     sessions, no CSRF, no invites, no orgs UI. Designed so a single
    #     user can run the app without configuring any provider.
    #   - "multi_tenant": hosted SaaS / team install. OAuth SSO + sessions +
    #     CSRF + invites + orgs are all active. This is the historical
    #     behavior and the default.
    DEPLOYMENT_MODE: Literal["single_user", "multi_tenant"] = "multi_tenant"

    # Security
    BLOCK_PRIVATE_NETWORKS: bool = True
    # Surgical opt-in for loopback (127.0.0.0/8 and ::1) only. Does NOT
    # allow RFC1918, link-local, or cloud metadata ranges. Auto-enabled
    # when DEPLOYMENT_MODE=single_user and APP_ENV=development so a normal
    # laptop user can hit local services without flipping the global SSRF
    # switch. Production refuses to boot with this set to True.
    ALLOW_LOOPBACK: bool = False
    MAX_WEBHOOK_BODY_SIZE: int = 65536
    UPLOADS_BASE_DIR: str = "uploads"
    RATE_LIMITER_BACKEND: Literal["memory", "mongodb"] = "memory"

    MCP_ENABLED: bool = False
    MCP_HTTP_ENABLED: bool = False
    MCP_API_KEY: str | None = None
    MCP_ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Optional override for MCP DNS-rebinding Host header allowlist. By default,
    # the allowlist is derived automatically from MCP_ALLOWED_ORIGINS (scheme is
    # stripped and the port is wildcarded). Set this only if your backend is
    # served on a host that doesn't appear in MCP_ALLOWED_ORIGINS (e.g. split
    # frontend/backend domains behind a reverse proxy). Supports the MCP SDK's
    # "host:*" wildcard syntax to match any port.
    MCP_ALLOWED_HOSTS: str = ""
    MCP_REQUIRE_API_KEY: bool = True
    MCP_ALLOW_SECRET_WRITES: bool = False

    # SMTP (invite email delivery) — all optional; if any are missing, email is skipped
    SMTP_ENABLED: bool = False
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_ADDRESS: str | None = None
    SMTP_TLS: bool = True
    SMTP_USE_SSL: bool = False
    SMTP_TLS_VERIFY: bool = True

    def get_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    def get_trusted_hosts_list(self) -> list[str]:
        return [host.strip() for host in self.TRUSTED_HOSTS.split(",") if host.strip()]

    def get_rate_limiter_backend(self) -> str:
        return self.RATE_LIMITER_BACKEND

    def get_mcp_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.MCP_ALLOWED_ORIGINS.split(",") if origin.strip()]

    def get_mcp_allowed_hosts_list(self) -> list[str]:
        """Return MCP DNS-rebinding allowlist.

        If ``MCP_ALLOWED_HOSTS`` is set, use it verbatim. Otherwise derive from
        every ``MCP_ALLOWED_ORIGINS`` entry: each origin's hostname becomes a
        ``host:*`` token so any port on that host is accepted. Loopback
        defaults (127.0.0.1, localhost, [::1]) are always merged in so the
        backend stays reachable on standard loopback aliases even when the
        origin list does not mention them.
        """
        explicit = [host.strip() for host in self.MCP_ALLOWED_HOSTS.split(",") if host.strip()]
        if explicit:
            return explicit

        derived: set[str] = set()
        for origin in self.get_mcp_allowed_origins_list():
            parsed = urlparse(origin)
            host = parsed.hostname or ""
            if not host:
                continue
            # IPv6 literals must be bracketed for the MCP SDK host check.
            host_token = f"[{host}]" if ":" in host else host
            derived.add(f"{host_token}:*")
        defaults = {"127.0.0.1:*", "localhost:*", "[::1]:*"}
        return sorted(defaults | derived)

    def is_smtp_configured(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_FROM_ADDRESS)

    def get_approved_domains_list(self) -> list[str]:
        return [domain.strip() for domain in self.APPROVED_DOMAINS.split(",") if domain.strip()]

    def get_allow_loopback(self) -> bool:
        """Allow loopback (127.0.0.0/8 + ::1) for outbound HTTP requests.

        Returns True when either:
        - ``ALLOW_LOOPBACK`` is explicitly set to True, OR
        - ``DEPLOYMENT_MODE=single_user`` AND ``APP_ENV=development`` — the
          laptop-developer case where hitting localhost services is the
          dominant workflow.

        RFC1918, link-local, and metadata ranges are never affected by this
        flag; only 127.0.0.0/8 and ::1/128 become reachable.
        """
        if self.ALLOW_LOOPBACK:
            return True
        return self.DEPLOYMENT_MODE == "single_user" and self.APP_ENV.lower() == "development"

    def get_session_cookie_secure(self) -> bool:
        if self.APP_ENV.lower() == "development":
            return False
        return self.SESSION_COOKIE_SECURE

    def get_session_cookie_samesite(self) -> str:
        return self.SESSION_COOKIE_SAMESITE

    @model_validator(mode="after")
    def validate_auth_configuration(self) -> "Settings":
        is_prod = self.APP_ENV.lower() in {"production", "prod"}

        if not self.SECRET_ENCRYPTION_KEY:
            if is_prod:
                raise ValueError(
                    "SECRET_ENCRYPTION_KEY is required in production "
                    '(32 bytes base64: python -c "import secrets; print(secrets.token_urlsafe(32))")'
                )
            self.SECRET_ENCRYPTION_KEY = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
            logger.warning(
                "SECRET_ENCRYPTION_KEY not set; generated ephemeral key. "
                "Set it in .env for persistent secret encryption."
            )

        if is_prod:
            if self.SETUP_MODE_ENABLED:
                raise ValueError(
                    "SETUP_MODE_ENABLED must be False in production after initial admin is created"
                )

            allowed_origins = self.ALLOWED_ORIGINS.strip()
            if allowed_origins == "*":
                raise ValueError("ALLOWED_ORIGINS=* is not allowed in production")

            if not self.WEBHOOK_REQUIRE_HMAC:
                raise ValueError("WEBHOOK_REQUIRE_HMAC must be True in production")

            if not self.BLOCK_PRIVATE_NETWORKS:
                raise ValueError("BLOCK_PRIVATE_NETWORKS must be True in production")

            if self.ALLOW_LOOPBACK:
                raise ValueError(
                    "ALLOW_LOOPBACK must be False in production. "
                    "Use APPROVED_DOMAINS for any host the server needs to reach."
                )

            if self.MAX_WEBHOOK_BODY_SIZE > 1_048_576:
                raise ValueError(
                    "MAX_WEBHOOK_BODY_SIZE must not exceed 1MB (1048576 bytes) in production"
                )

            if not self.SESSION_SECRET_KEY:
                raise ValueError("SESSION_SECRET_KEY is required in production")

            if not self.get_session_cookie_secure():
                raise ValueError("SESSION_COOKIE_SECURE must remain enabled in production")

            if not self.SETUP_MODE_ENABLED:
                missing_provider_secrets = []

                provider_pairs = (
                    (
                        "GITHUB_CLIENT_ID",
                        self.GITHUB_CLIENT_ID,
                        "GITHUB_CLIENT_SECRET",
                        self.GITHUB_CLIENT_SECRET,
                    ),
                    (
                        "GITLAB_CLIENT_ID",
                        self.GITLAB_CLIENT_ID,
                        "GITLAB_CLIENT_SECRET",
                        self.GITLAB_CLIENT_SECRET,
                    ),
                    (
                        "MICROSOFT_CLIENT_ID",
                        self.MICROSOFT_CLIENT_ID,
                        "MICROSOFT_CLIENT_SECRET",
                        self.MICROSOFT_CLIENT_SECRET,
                    ),
                    (
                        "GOOGLE_CLIENT_ID",
                        self.GOOGLE_CLIENT_ID,
                        "GOOGLE_CLIENT_SECRET",
                        self.GOOGLE_CLIENT_SECRET,
                    ),
                )

                for client_name, client_id, secret_name, secret in provider_pairs:
                    if client_id and not secret:
                        missing_provider_secrets.append(secret_name)

                if missing_provider_secrets:
                    raise ValueError(
                        "Missing OAuth provider secrets in production: "
                        + ", ".join(missing_provider_secrets)
                    )

        return self

    @model_validator(mode="after")
    def validate_oauth_login_enabled(self) -> "Settings":
        if not self.OAUTH_LOGIN_ENABLED:
            return self

        provider_client_ids: dict[str, str | None] = {
            "github": self.GITHUB_CLIENT_ID,
            "gitlab": self.GITLAB_CLIENT_ID,
            "google": self.GOOGLE_CLIENT_ID,
            "microsoft": self.MICROSOFT_CLIENT_ID,
        }

        provider_client_secrets: dict[str, str | None] = {
            "github": self.GITHUB_CLIENT_SECRET,
            "gitlab": self.GITLAB_CLIENT_SECRET,
            "google": self.GOOGLE_CLIENT_SECRET,
            "microsoft": self.MICROSOFT_CLIENT_SECRET,
        }

        missing = [name for name, client_id in provider_client_ids.items() if not client_id]
        if missing:
            logger.warning(
                "OAUTH_LOGIN_ENABLED=true but the following OAuth providers are missing "
                "a client ID and will be unavailable: %s",
                ", ".join(sorted(missing)),
            )

        # Check for mismatched pairs (ID set but secret missing, or vice versa)
        mismatched = []
        for name in provider_client_ids.keys():
            client_id = provider_client_ids[name]
            client_secret = provider_client_secrets[name]
            if bool(client_id) != bool(client_secret):
                mismatched.append(name)

        if mismatched:
            logger.warning(
                "OAUTH_LOGIN_ENABLED=true but the following OAuth providers have "
                "mismatched client ID/secret configuration and will be unavailable: %s",
                ", ".join(sorted(mismatched)),
            )

        return self

    @model_validator(mode="after")
    def validate_smtp_configuration(self) -> "Settings":
        if self.SMTP_ENABLED and not self.is_smtp_configured():
            logger.warning(
                "SMTP_ENABLED=true but required SMTP variables are missing "
                "(SMTP_HOST, SMTP_FROM_ADDRESS). Invite emails will not be sent. "
                "Set the missing variables or set SMTP_ENABLED=false."
            )
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


settings = Settings()
