from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "APIWeave"
    VERSION: str = "0.1.0"
    DEBUG: bool = False
    APP_ENV: str = "development"
    BASE_URL: str

    MONGODB_URL: str
    MONGODB_DB_NAME: str

    ALLOWED_ORIGINS: str

    API_KEY_HEADER: str = "Authorization"
    APIWEAVE_ADMIN_KEY: str | None = None

    WORKER_POLL_INTERVAL: int = 5
    WORKER_MAX_RETRIES: int = 3

    ARTIFACTS_PATH: str = "./artifacts"

    SECRET_KEY: str

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

    MCP_ENABLED: bool = False
    MCP_HTTP_ENABLED: bool = False
    MCP_API_KEY: str | None = None
    MCP_ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    MCP_REQUIRE_API_KEY: bool = True
    MCP_ALLOW_SECRET_WRITES: bool = False

    def get_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    def get_mcp_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.MCP_ALLOWED_ORIGINS.split(",") if origin.strip()]

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
        if self.APP_ENV.lower() in {"production", "prod"}:
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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


settings = Settings()
