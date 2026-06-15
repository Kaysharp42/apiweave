from typing import Literal

import base64
import logging
import os

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

    MONGODB_URL: str
    MONGODB_DB_NAME: str

    ALLOWED_ORIGINS: str

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

    # Security
    BLOCK_PRIVATE_NETWORKS: bool = True
    MAX_WEBHOOK_BODY_SIZE: int = 65536
    UPLOADS_BASE_DIR: str = "uploads"
    RATE_LIMITER_BACKEND: Literal["memory", "mongodb"] = "memory"

    MCP_ENABLED: bool = False
    MCP_HTTP_ENABLED: bool = False
    MCP_API_KEY: str | None = None
    MCP_ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    MCP_REQUIRE_API_KEY: bool = True
    MCP_ALLOW_SECRET_WRITES: bool = False

    # SMTP (invite email delivery) — all optional; if any are missing, email is skipped
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_ADDRESS: str | None = None
    SMTP_TLS: bool = True

    def get_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    def get_rate_limiter_backend(self) -> str:
        return self.RATE_LIMITER_BACKEND

    def get_mcp_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.MCP_ALLOWED_ORIGINS.split(",") if origin.strip()]

    def is_smtp_configured(self) -> bool:
        return bool(
            self.SMTP_HOST
            and self.SMTP_FROM_ADDRESS
        )

    def get_approved_domains_list(self) -> list[str]:
        return [domain.strip() for domain in self.APPROVED_DOMAINS.split(",") if domain.strip()]

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
                    "(32 bytes base64: python -c \"import secrets; print(secrets.token_urlsafe(32))\")"
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

        missing = [
            name for name, client_id in provider_client_ids.items() if not client_id
        ]
        if missing:
            logger.warning(
                "OAUTH_LOGIN_ENABLED=true but the following OAuth providers are missing "
                "a client ID and will be unavailable: %s",
                ", ".join(sorted(missing)),
            )

        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


settings = Settings()
