from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    aiser_base_url: str = Field(default="http://localhost:3000", alias="AISER_BASE_URL")
    aiser_api_url: str = Field(default="http://localhost:8000", alias="AISER_API_URL")
    aiser_qa_email: str = Field(default="", alias="AISER_QA_EMAIL")
    aiser_qa_password: str = Field(default="", alias="AISER_QA_PASSWORD")

    typesafe_api_key: str = Field(default="", alias="TYPESAFE_API_KEY")
    text_model_api_key: str = Field(default="", alias="TEXT_MODEL_API_KEY")
    text_model: str = Field(default="inception/mercury-2.5", alias="TEXT_MODEL")
    text_model_base_url: str = Field(
        default="https://openrouter.ai/api/v1", alias="TEXT_MODEL_BASE_URL"
    )

    qa_max_steps: int = Field(default=40, alias="QA_MAX_STEPS")
    qa_timeout_s: int = Field(default=180, alias="QA_TIMEOUT_S")
    qa_headless: int = Field(default=0, alias="QA_HEADLESS")
    qa_report_dir: str = Field(default="reports/runs", alias="QA_REPORT_DIR")

    def report_dir(self) -> Path:
        p = Path(self.qa_report_dir)
        return p if p.is_absolute() else ROOT / p


@lru_cache
def load_settings() -> Settings:
    return Settings()
