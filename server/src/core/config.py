from pydantic_settings import BaseSettings
from typing import Dict, Optional
from functools import lru_cache
import os
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    # API Settings
    APP_HOST: str = "localhost"
    APP_PORT: int = 8000
    APP_NAME: str = (
        "Aiser Chat2Chart Platform EE"
        if os.getenv("AISER_EDITION", "community").strip().lower() in ("enterprise", "ee")
        or os.getenv("AISER_EDITION_LICENSE_KEY", "").strip()
        else "Aiser Chat2Chart Platform Community Edition"
    )
    APP_VERSION: str = "0.0.1"
    APP_CONTACT: Dict[str, str] = {
        "name": "DataTicon Dev Team",
        "email": "support@dataticon.com",
    }

    # Database Settings
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "postgres")
    POSTGRES_SERVER: str = os.getenv("POSTGRES_SERVER", "localhost")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "aiser_world")
    POSTGRES_PORT: int = int(os.getenv("POSTGRES_PORT", "5432"))
    DATABASE_URL: Optional[str] = os.getenv("DATABASE_URL", "")

    # Security Settings
    SECRET_KEY: str = os.getenv(
        "SECRET_KEY", "9e25a2588fcee7d21ea15fb1a63d5135"
    )  # openssl rand -hex 16
    JWT_SECRET: str = os.getenv("JWT_SECRET", "your-jwt-secret-here")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXP_TIME_MINUTES: int = 60
    JWT_REFRESH_EXP_TIME_MINUTES: int = 7 * 24 * 60

    # File Upload Settings
    UPLOAD_TYPE: str = os.getenv("UPLOAD_TYPE", "local")
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "uploads")
    MAX_UPLOAD_SIZE: int = int(
        os.getenv("MAX_UPLOAD_SIZE", str(10485760))  # 10 * 1024 * 1024
    )  # 10MB

    # AWS Settings
    AWS_ACCESS_KEY_ID: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")

    # Azure Blob Storage Settings
    AZURE_STORAGE_ACCOUNT_NAME: str = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")
    AZURE_STORAGE_ACCOUNT_KEY: str = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "")
    AZURE_STORAGE_CONNECTION_STRING: str = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
    AZURE_STORAGE_CONTAINER_NAME: str = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "aiser-data")
    AZURE_STORAGE_ENDPOINT_SUFFIX: str = os.getenv("AZURE_STORAGE_ENDPOINT_SUFFIX", "core.windows.net")

    # Cloud Storage Configuration
    CLOUD_STORAGE_PROVIDER: str = os.getenv("CLOUD_STORAGE_PROVIDER", "local")  # local, s3, azure
    CLOUD_STORAGE_ENABLED: bool = os.getenv("CLOUD_STORAGE_ENABLED", "false").lower() == "true"
    CLOUD_STORAGE_CDN_URL: str = os.getenv("CLOUD_STORAGE_CDN_URL", "")
    CLOUD_STORAGE_RETENTION_DAYS: int = int(os.getenv("CLOUD_STORAGE_RETENTION_DAYS", "365"))

    # OpenAI Settings
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL_ID: str = os.getenv("OPENAI_MODEL_ID", "gpt-4.1-mini")

    # Azure OpenAI Settings
    AZURE_OPENAI_API_KEY: str = os.getenv("AZURE_OPENAI_API_KEY", "")
    AZURE_OPENAI_ENDPOINT: str = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    AZURE_OPENAI_API_VERSION: str = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
    AZURE_OPENAI_DEPLOYMENT_NAME: str = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4.1-mini")

    # Reasoning-tier model (optional; for complex/ambiguous queries when REASONING_MODEL_* set)
    REASONING_MODEL_DEPLOYMENT_NAME: str = os.getenv("REASONING_MODEL_DEPLOYMENT_NAME", "")
    REASONING_MODEL_API_KEY: str = os.getenv("REASONING_MODEL_API_KEY", "")
    REASONING_MODEL_ENDPOINT: str = os.getenv("REASONING_MODEL_ENDPOINT", "")
    REASONING_MODEL_API_VERSION: str = os.getenv("REASONING_MODEL_API_VERSION", "")

    # Cube.js Settings
    CUBE_API_URL: str = os.getenv("CUBE_API_URL", "http://localhost:4000/cubejs-api/v1")
    # CRITICAL SECURITY FIX: No hardcoded secrets in defaults
    CUBE_API_SECRET: Optional[str] = os.getenv("CUBE_API_SECRET")  # MUST be set for production
    CUBEJS_TOKEN: Optional[str] = os.getenv("CUBEJS_TOKEN")  # MUST be set for production

    # Feature Flags
    ENABLE_AI_ANALYSIS: bool = os.getenv("ENABLE_AI_ANALYSIS", "true").lower() == "true"
    ENABLE_CUBE_INTEGRATION: bool = os.getenv("ENABLE_CUBE_INTEGRATION", "true").lower() == "true"
    # Enterprise: prompt caching (Azure/OpenAI) — reduces cost/latency for long system prompts; requires model support
    ENABLE_PROMPT_CACHING: bool = os.getenv("ENABLE_PROMPT_CACHING", "false").lower() == "true"

    # Token/context budget (see TOKEN_AND_CONTEXT_BUDGET.md)
    CONVERSATION_HISTORY_LIMIT: int = int(os.getenv("CONVERSATION_HISTORY_LIMIT", "10"))
    MAX_ASSISTANT_CONTENT_CHARS: int = int(os.getenv("MAX_ASSISTANT_CONTENT_CHARS", "700"))
    NL2SQL_MAX_OUTPUT_TOKENS: int = int(os.getenv("NL2SQL_MAX_OUTPUT_TOKENS", "0"))  # 0 = use dialect default (16384/12288)
    SCHEMA_COLUMN_SAFETY_CAP: int = int(os.getenv("SCHEMA_COLUMN_SAFETY_CAP", "500"))
    # When True, human-in-the-loop only for critical/ambiguous cases; otherwise auto-proceed when schema is unambiguous
    REQUIRE_HUMAN_APPROVAL_CRITICAL_ONLY: bool = os.getenv("REQUIRE_HUMAN_APPROVAL_CRITICAL_ONLY", "false").lower() == "true"
    ENABLE_MCP_CHARTS: bool = os.getenv("ENABLE_MCP_CHARTS", "false").lower() == "true"
    ENABLE_FUNCTION_CALLING: bool = os.getenv("ENABLE_FUNCTION_CALLING", "true").lower() == "true"
    ENABLE_INTELLIGENT_MODELING: bool = os.getenv("ENABLE_INTELLIGENT_MODELING", "true").lower() == "true"

    # CORS Settings
    CORS_ORIGINS: str = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://aiser:3000",
    )

    # Frontend URL (used for invitation accept links)
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # Supabase Settings
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    # Note: For RS256 tokens, we use JWKS (public keys) instead of JWT secret
    # JWKS is fetched from: https://<project-id>.supabase.co/auth/v1/.well-known/jwks.json

    # File Upload Settings (Additional)
    MAX_FILE_SIZE_MB: int = int(os.getenv("MAX_FILE_SIZE_MB", "50"))

    # Knowledge Base: max PDF pages to process per document (0 = no limit). Prevents OOM on huge PDFs.
    KNOWLEDGE_MAX_PAGES_PER_DOCUMENT: int = int(os.getenv("KNOWLEDGE_MAX_PAGES_PER_DOCUMENT", "0") or "0")

    # Redis Settings
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_DB: int = int(os.getenv("REDIS_DB", "0"))
    REDIS_URL: str = os.getenv("REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}")

    # Environment Settings
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

    # Development bypass flags (opt-in via env)
    # ALLOW_UNVERIFIED_JWT_IN_DEV: if true, returns unverified JWT claims in dev when signature verification fails
    ALLOW_UNVERIFIED_JWT_IN_DEV: bool = os.getenv("ALLOW_UNVERIFIED_JWT_IN_DEV", "false").lower() == "true"
    # ALLOW_DEV_AUTH_BYPASS: if true, allow permissive dev auth fallbacks (e.g., missing cookie -> minimal payload)
    ALLOW_DEV_AUTH_BYPASS: bool = os.getenv("ALLOW_DEV_AUTH_BYPASS", "true").lower() == "true"
    # Skip persisting refresh tokens (useful for tests to avoid DB concurrency)
    SKIP_PERSIST_REFRESH: bool = os.getenv("SKIP_PERSIST_REFRESH", "true").lower() == "true"

    # Enterprise Settings (with defaults)
    AISER_DEPLOYMENT_MODE: str = os.getenv("AISER_DEPLOYMENT_MODE", "development")
    AISER_ORG_NAME: str = os.getenv("AISER_ORG_NAME", "Aiser Development")
    AISER_ADMIN_EMAIL: str = os.getenv("AISER_ADMIN_EMAIL", "admin@aiser.dev")
    AUTH_MODE: str = os.getenv("AUTH_MODE", "internal")
    # CRITICAL SECURITY FIX: No hardcoded JWT secrets
    # JWT_SECRET_KEY is required for production (fallback only for local dev)
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY") or (
        "dev-jwt-secret-CHANGE-IN-PRODUCTION" if os.getenv("ENVIRONMENT", "development") == "development" else None
    )
    if not JWT_SECRET_KEY and os.getenv("ENVIRONMENT") != "development":
        raise ValueError("JWT_SECRET_KEY must be set in production environment")
    # REQUIRE_MFA: bool = os.getenv("REQUIRE_MFA", "false").lower() == "true"
    # AUDIT_LOGGING: bool = os.getenv("AUDIT_LOGGING", "true").lower() == "true"
    # DATA_PRIVACY_MODE: bool = os.getenv("DATA_PRIVACY_MODE", "true").lower() == "true"

    # Cube.js Environment Variables (with defaults)
    CUBE_DB_TYPE: str = os.getenv("CUBE_DB_TYPE", "postgres")
    CUBE_DB_HOST: str = os.getenv("CUBE_DB_HOST", "postgres")
    CUBE_DB_PORT: int = int(os.getenv("CUBE_DB_PORT", "5432"))
    CUBE_DB_NAME: str = os.getenv("CUBE_DB_NAME", "aiser_world")
    CUBE_DB_USER: str = os.getenv("CUBE_DB_USER", "aiser")
    CUBE_DB_PASS: str = os.getenv("CUBE_DB_PASS", "aiser_password")
    CUBE_DB_SCHEMA: str = os.getenv("CUBE_DB_SCHEMA", "public")
    CUBE_DB_SSL: bool = os.getenv("CUBE_DB_SSL", "false").lower() == "true"
    CUBE_DB_POOL_MIN: int = int(os.getenv("CUBE_DB_POOL_MIN", "2"))
    CUBE_DB_POOL_MAX: int = int(os.getenv("CUBE_DB_POOL_MAX", "10"))
    CUBE_REDIS_URL: str = os.getenv("CUBE_REDIS_URL", "redis://redis:6379")
    CUBE_DEV_MODE: bool = os.getenv("CUBE_DEV_MODE", "true").lower() == "true"
    CUBE_LOG_LEVEL: str = os.getenv("CUBE_LOG_LEVEL", "info")
    CUBEJS_EXTERNAL_DEFAULT: bool = os.getenv("CUBEJS_EXTERNAL_DEFAULT", "true").lower() == "true"
    CUBEJS_SCHEDULED_REFRESH_DEFAULT: bool = os.getenv("CUBEJS_SCHEDULED_REFRESH_DEFAULT", "true").lower() == "true"
    CUBEJS_SKIP_NATIVE_EXTENSIONS: bool = os.getenv("CUBEJS_SKIP_NATIVE_EXTENSIONS", "true").lower() == "true"

    # Node Environment
    NODE_ENV: str = os.getenv("NODE_ENV", "development")

    # Grafana and Monitoring
    # CRITICAL SECURITY FIX: Remove hardcoded admin passwords
    GRAFANA_ADMIN_PASSWORD: Optional[str] = os.getenv("GRAFANA_ADMIN_PASSWORD")  # MUST be set
    REDIS_PASSWORD: str = os.getenv("REDIS_PASSWORD", "")
    KEYCLOAK_ADMIN: str = os.getenv("KEYCLOAK_ADMIN", "admin")  # Dev default only
    KEYCLOAK_ADMIN_PASSWORD: Optional[str] = os.getenv("KEYCLOAK_ADMIN_PASSWORD")  # MUST be set in production

    # Stripe Settings
    STRIPE_SECRET_KEY: str = os.getenv("STRIPE_SECRET_KEY", "")
    STRIPE_PUBLISHABLE_KEY: str = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    STRIPE_PRICE_PRO_MONTHLY: str = os.getenv("STRIPE_PRICE_PRO_MONTHLY", "")
    STRIPE_PRICE_PRO_YEARLY: str = os.getenv("STRIPE_PRICE_PRO_YEARLY", "")
    STRIPE_PRICE_TEAM_MONTHLY: str = os.getenv("STRIPE_PRICE_TEAM_MONTHLY", "")
    STRIPE_PRICE_TEAM_YEARLY: str = os.getenv("STRIPE_PRICE_TEAM_YEARLY", "")
    STRIPE_ENABLED: bool = os.getenv("STRIPE_ENABLED", "false").lower() == "true"

    # S3-compatible Object Storage (EE — alternative to Azure Blob Storage)
    # Set STORAGE_BACKEND=s3 to activate. Leave S3_ENDPOINT_URL empty for AWS S3.
    STORAGE_BACKEND: str = os.getenv("STORAGE_BACKEND", "")  # "s3" | "azure_blob" | "postgresql"
    S3_PROVIDER: str = os.getenv("S3_PROVIDER", "aws")        # label only: aws | cloudflare_r2 | digitalocean | minio | railway
    S3_ENDPOINT_URL: str = os.getenv("S3_ENDPOINT_URL", "")   # empty = AWS; set for R2/Spaces/MinIO/Railway
    S3_ACCESS_KEY_ID: str = os.getenv("S3_ACCESS_KEY_ID", "")
    S3_SECRET_ACCESS_KEY: str = os.getenv("S3_SECRET_ACCESS_KEY", "")
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "")
    S3_REGION: str = os.getenv("S3_REGION", "us-east-1")

    # Telegram Bot Settings
    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_WEBHOOK_URL: str = os.getenv("TELEGRAM_WEBHOOK_URL", "")
    TELEGRAM_BOT_USERNAME: str = os.getenv("TELEGRAM_BOT_USERNAME", "")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "allow"  # Allow extra environment variables

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        # Always use async driver for the main database URI
        # This ensures SQLAlchemy uses asyncpg instead of auto-detecting psycopg2
        if self.DATABASE_URL and self.DATABASE_URL.strip():
            # Convert sync URL to async URL if needed
            url = self.DATABASE_URL
            if url.startswith("postgresql://") and "+asyncpg" not in url:
                url = url.replace("postgresql://", "postgresql+asyncpg://")
            return url
        # Fall back to individual POSTGRES_* variables with async driver
        return f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
    
    @property
    def SYNC_DATABASE_URI(self) -> str:
        """Get sync database URI for migrations and sync operations"""
        # Convert async URL to sync URL for migrations
        async_url = self.SQLALCHEMY_DATABASE_URI
        if "+asyncpg" in async_url:
            return async_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
        elif "+psycopg2" not in async_url:
            return async_url.replace("postgresql://", "postgresql+psycopg2://")
        return async_url


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
