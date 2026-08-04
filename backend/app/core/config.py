"""
Application settings.

Everything here is pulled from environment variables (see .env.example).
Nothing is hardcoded — fail loudly at startup if a required secret is missing
rather than silently falling back to an insecure default in production.
"""
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: str = "development"  # development | staging | production

    # --- Database ---
    DATABASE_URL: str = "postgresql://clauseiq:clauseiq@db:5432/clauseiq"

    # --- Redis (rate limiting, token blacklist, celery broker later) ---
    REDIS_URL: str = "redis://redis:6379/0"

    # --- JWT ---
    JWT_SECRET_KEY: str  # REQUIRED — no default, must come from env
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- CORS ---
    CORS_ORIGINS: str = "http://localhost:3000"

    # --- File storage ---
    STORAGE_BACKEND: str = "local"  # "local" | "s3"
    LOCAL_STORAGE_PATH: str = "/app/storage/uploads"
    MAX_UPLOAD_SIZE_MB: int = 25
    ALLOWED_UPLOAD_EXTENSIONS: str = "pdf,docx,doc,png,jpg,jpeg"

    # --- S3 (only used when STORAGE_BACKEND=s3) ---
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"
    S3_BUCKET_NAME: str = ""

    # --- Email (used for verification + password reset) ---
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@clauseiq.app"
    FRONTEND_URL: str = "http://localhost:3000"

    # --- AI provider ---
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-5"
    # Optional second Anthropic API key (different account/org) used only when
    # the primary key's calls keep failing after retries. Leave blank to disable.
    ANTHROPIC_FALLBACK_API_KEY: str = ""

    # --- Celery ---
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # --- Chat context limits ---
    MAX_CHAT_CONTEXT_CHARS: int = 60000  # ~15k tokens of contract text fed to chat; RAG chunking arrives Phase 3
    MAX_CHAT_HISTORY_MESSAGES: int = 20

    # --- Stripe ---
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    # Stripe Price IDs (from the Stripe dashboard, one per paid plan). Plan
    # names here must match the values used in User.plan / Subscription.plan.
    STRIPE_PRICE_ID_PRO: str = ""
    STRIPE_PRICE_ID_BUSINESS: str = ""
    # Where Stripe Checkout / Billing Portal send the user back to.
    BILLING_SUCCESS_URL: str = ""  # defaults to f"{FRONTEND_URL}/billing?status=success"
    BILLING_CANCEL_URL: str = ""   # defaults to f"{FRONTEND_URL}/billing?status=cancelled"

    # --- RAG / embeddings (Phase 3) ---
    # Local sentence-transformers model: no external API key, no per-call
    # cost or network latency, runs in the Celery worker for indexing and
    # in the API process for query-time embedding. Swap EMBEDDING_MODEL_NAME
    # for a bigger model if quality > latency matters; keep EMBEDDING_DIM in
    # sync (it drives the pgvector column width) — changing it requires a
    # migration + full re-index, not just an env var flip.
    EMBEDDING_MODEL_NAME: str = "all-MiniLM-L6-v2"
    EMBEDDING_DIM: int = 384
    RAG_CHUNK_SIZE: int = 1000          # characters per chunk
    RAG_CHUNK_OVERLAP: int = 150        # characters of overlap between consecutive chunks
    RAG_TOP_K: int = 6                  # chunks retrieved per query
    RAG_MAX_QUERY_CHARS: int = 2000

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def secret_must_not_be_trivial(cls, v: str) -> str:
        if not v or len(v) < 32:
            raise ValueError(
                "JWT_SECRET_KEY must be set and at least 32 characters. "
                "Generate one with: openssl rand -hex 32"
            )
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [e.strip().lower() for e in self.ALLOWED_UPLOAD_EXTENSIONS.split(",") if e.strip()]

    @property
    def billing_success_url(self) -> str:
        return self.BILLING_SUCCESS_URL or f"{self.FRONTEND_URL}/billing?status=success"

    @property
    def billing_cancel_url(self) -> str:
        return self.BILLING_CANCEL_URL or f"{self.FRONTEND_URL}/billing?status=cancelled"

    @property
    def stripe_price_to_plan(self) -> dict:
        """Maps a Stripe Price ID back to our internal plan name. Used when a
        webhook event tells us which price a subscription is on."""
        mapping = {}
        if self.STRIPE_PRICE_ID_PRO:
            mapping[self.STRIPE_PRICE_ID_PRO] = "pro"
        if self.STRIPE_PRICE_ID_BUSINESS:
            mapping[self.STRIPE_PRICE_ID_BUSINESS] = "business"
        return mapping


settings = Settings()
