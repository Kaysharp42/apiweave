"""
Configuration settings for APIWeave backend
Uses pydantic-settings for environment variable management
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    """Application settings"""
    
    # Application
    APP_NAME: str = "APIWeave"
    VERSION: str = "0.1.0"
    DEBUG: bool = False
    BASE_URL: str  # Base URL for webhook URLs (loaded from .env)
    
    # MongoDB
    MONGODB_URL: str
    MONGODB_DB_NAME: str
    
    # CORS - comma-separated string that gets split into list
    ALLOWED_ORIGINS: str
    
    def get_allowed_origins_list(self) -> List[str]:
        """Parse ALLOWED_ORIGINS from comma-separated string"""
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    def get_mcp_allowed_origins_list(self) -> List[str]:
        """Parse MCP_ALLOWED_ORIGINS from comma-separated string"""
        return [origin.strip() for origin in self.MCP_ALLOWED_ORIGINS.split(",") if origin.strip()]
    
    # API Keys
    API_KEY_HEADER: str = "Authorization"
    
    # Worker
    WORKER_POLL_INTERVAL: int = 5  # seconds
    WORKER_MAX_RETRIES: int = 3
    
    # Artifacts
    ARTIFACTS_PATH: str = "./artifacts"
    
    # Secrets (for encryption)
    SECRET_KEY: str

    # MCP (Model Context Protocol)
    MCP_ENABLED: bool = False
    MCP_HTTP_ENABLED: bool = False
    MCP_API_KEY: str | None = None
    MCP_ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    MCP_REQUIRE_API_KEY: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True
    )


settings = Settings()
