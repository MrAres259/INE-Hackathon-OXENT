"""ATALAYA configuration and environment settings."""

from __future__ import annotations

from dataclasses import dataclass
import functools
import os
from pathlib import Path
from dotenv import load_dotenv

# Directory paths
REPO_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_DIR / "backend"
DATA_DIR = REPO_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
BUILD_DIR = DATA_DIR / "build"
CACHE_DIR = DATA_DIR / "cache"
SEED_DIR = DATA_DIR / "seed"

# Load backend/.env without overriding already exported environment variables
load_dotenv(BACKEND_DIR / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    """Application settings loaded from environment."""

    es_urls: list[str]
    es_username: str
    es_password: str
    es_insecure: bool
    index_prefix: str = "atalaya-"
    store_mode: str = "auto"
    maas_base_url: str = ""
    maas_api_key: str = ""
    maas_model: str = "glm-5.2"
    llm_enabled: bool = True
    es_timeout_s: float = 30.0
    target_year: int = 2027

    def __repr__(self) -> str:
        masked_pwd = "***" if self.es_password else ""
        masked_key = "***" if self.maas_api_key else ""
        return (
            f"Settings(es_urls={self.es_urls!r}, es_username={self.es_username!r}, "
            f"es_password={masked_pwd!r}, es_insecure={self.es_insecure!r}, "
            f"index_prefix={self.index_prefix!r}, store_mode={self.store_mode!r}, "
            f"maas_base_url={self.maas_base_url!r}, maas_api_key={masked_key!r}, "
            f"maas_model={self.maas_model!r}, llm_enabled={self.llm_enabled!r}, "
            f"es_timeout_s={self.es_timeout_s!r}, target_year={self.target_year!r})"
        )


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Retrieve cached application settings."""
    raw_es_urls = os.getenv("ES_URL", "")
    es_urls = [u.strip() for u in raw_es_urls.split(",") if u.strip()]

    es_username = os.getenv("ES_USERNAME", "")
    es_password = os.getenv("ES_PASSWORD", "")
    es_insecure = os.getenv("ES_INSECURE", "false").lower() in ("true", "1", "yes")
    index_prefix = os.getenv("ATALAYA_INDEX_PREFIX", "atalaya-")
    store_mode = os.getenv("ATALAYA_STORE", "auto").lower()

    maas_base_url = os.getenv("MAAS_BASE_URL", "")
    maas_api_key = os.getenv("MAAS_API_KEY", "")
    maas_model = os.getenv("MAAS_MODEL", "glm-5.2")
    llm_enabled = os.getenv("ATALAYA_LLM_ENABLED", "1").lower() not in ("false", "0", "no")

    try:
        es_timeout_s = float(os.getenv("ES_TIMEOUT_S", "30.0"))
    except ValueError:
        es_timeout_s = 30.0

    try:
        target_year = int(os.getenv("ATALAYA_TARGET_YEAR", "2027"))
    except ValueError:
        target_year = 2027

    return Settings(
        es_urls=es_urls,
        es_username=es_username,
        es_password=es_password,
        es_insecure=es_insecure,
        index_prefix=index_prefix,
        store_mode=store_mode,
        maas_base_url=maas_base_url,
        maas_api_key=maas_api_key,
        maas_model=maas_model,
        llm_enabled=llm_enabled,
        es_timeout_s=es_timeout_s,
        target_year=target_year,
    )


def index_name(kind: str) -> str:
    """Generate index name with configured prefix."""
    return f"{get_settings().index_prefix}{kind}"
