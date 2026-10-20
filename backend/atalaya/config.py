"""ATALAYA configuration and environment settings."""

from __future__ import annotations

from dataclasses import dataclass, field
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

    search_urls: list[str] = field(default_factory=list)
    search_username: str = ""
    search_password: str = ""
    search_verify_certs: bool = True
    search_ca_certs: str = ""
    search_timeout_s: float = 30.0
    search_replicas: int | None = None
    index_prefix: str = "atalaya-"
    store_mode: str = "auto"
    maas_base_url: str = ""
    maas_api_key: str = ""
    maas_model: str = "glm-5.2"
    llm_enabled: bool = True
    target_year: int = 2027
    admin_token: str = ""
    chat_rate_per_min: int = 8
    chat_rate_per_day: int = 200

    def __repr__(self) -> str:
        masked_pwd = "***" if self.search_password else ""
        masked_key = "***" if self.maas_api_key else ""
        masked_tok = "***" if self.admin_token else ""
        return (
            f"Settings(search_urls={self.search_urls!r}, search_username={self.search_username!r}, "
            f"search_password={masked_pwd!r}, search_verify_certs={self.search_verify_certs!r}, "
            f"search_ca_certs={self.search_ca_certs!r}, search_timeout_s={self.search_timeout_s!r}, "
            f"search_replicas={self.search_replicas!r}, index_prefix={self.index_prefix!r}, "
            f"store_mode={self.store_mode!r}, maas_base_url={self.maas_base_url!r}, "
            f"maas_api_key={masked_key!r}, maas_model={self.maas_model!r}, "
            f"llm_enabled={self.llm_enabled!r}, target_year={self.target_year!r}, "
            f"admin_token={masked_tok!r}, chat_rate_per_min={self.chat_rate_per_min!r}, "
            f"chat_rate_per_day={self.chat_rate_per_day!r})"
        )


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Retrieve cached application settings."""
    raw_search_urls = os.getenv("OPENSEARCH_URL")
    if raw_search_urls is None or raw_search_urls.strip() == "":
        raw_search_urls = os.getenv("ES_URL", "")
    search_urls = [u.strip() for u in raw_search_urls.split(",") if u.strip()]

    raw_user = os.getenv("OPENSEARCH_USERNAME")
    search_username = raw_user if (raw_user is not None and raw_user != "") else os.getenv("ES_USERNAME", "")

    raw_pw = os.getenv("OPENSEARCH_PASSWORD")
    search_password = raw_pw if (raw_pw is not None and raw_pw != "") else os.getenv("ES_PASSWORD", "")

    raw_verify = os.getenv("OPENSEARCH_VERIFY_CERTS")
    if raw_verify is not None and raw_verify.strip() != "":
        search_verify_certs = raw_verify.strip().lower() not in ("false", "0", "no")
    elif "ES_INSECURE" in os.environ and os.getenv("ES_INSECURE", "").strip() != "":
        search_verify_certs = os.getenv("ES_INSECURE", "").strip().lower() not in ("true", "1", "yes")
    else:
        search_verify_certs = True

    search_ca_certs = os.getenv("OPENSEARCH_CA_CERTS", "")

    raw_timeout = os.getenv("OPENSEARCH_TIMEOUT_S")
    if raw_timeout is None or raw_timeout.strip() == "":
        raw_timeout = os.getenv("ES_TIMEOUT_S", "30.0")
    try:
        search_timeout_s = float(raw_timeout)
    except ValueError:
        search_timeout_s = 30.0

    raw_replicas = os.getenv("OPENSEARCH_REPLICAS")
    search_replicas: int | None = None
    if raw_replicas is not None and raw_replicas.strip() != "":
        try:
            val = int(raw_replicas.strip())
            if val >= 0:
                search_replicas = val
        except ValueError:
            search_replicas = None

    index_prefix = os.getenv("ATALAYA_INDEX_PREFIX", "atalaya-")

    raw_store = os.getenv("ATALAYA_STORE", "auto").strip().lower()
    if raw_store == "es":
        store_mode = "opensearch"
    elif raw_store in ("auto", "opensearch", "memory"):
        store_mode = raw_store
    else:
        store_mode = "auto"

    maas_base_url = os.getenv("MAAS_BASE_URL", "")
    maas_api_key = os.getenv("MAAS_API_KEY", "")
    maas_model = os.getenv("MAAS_MODEL", "glm-5.2")
    llm_enabled = os.getenv("ATALAYA_LLM_ENABLED", "1").lower() not in ("false", "0", "no")

    try:
        target_year = int(os.getenv("ATALAYA_TARGET_YEAR", "2027"))
    except ValueError:
        target_year = 2027

    admin_token = os.getenv("ATALAYA_ADMIN_TOKEN", "").strip()

    raw_chat_min = os.getenv("ATALAYA_CHAT_RATE_PER_MIN")
    if raw_chat_min is not None and raw_chat_min.strip():
        try:
            chat_rate_per_min = max(1, int(raw_chat_min.strip()))
        except ValueError:
            chat_rate_per_min = 8
    else:
        chat_rate_per_min = 8

    raw_chat_day = os.getenv("ATALAYA_CHAT_RATE_PER_DAY")
    if raw_chat_day is not None and raw_chat_day.strip():
        try:
            chat_rate_per_day = max(1, int(raw_chat_day.strip()))
        except ValueError:
            chat_rate_per_day = 200
    else:
        chat_rate_per_day = 200

    return Settings(
        search_urls=search_urls,
        search_username=search_username,
        search_password=search_password,
        search_verify_certs=search_verify_certs,
        search_ca_certs=search_ca_certs,
        search_timeout_s=search_timeout_s,
        search_replicas=search_replicas,
        index_prefix=index_prefix,
        store_mode=store_mode,
        maas_base_url=maas_base_url,
        maas_api_key=maas_api_key,
        maas_model=maas_model,
        llm_enabled=llm_enabled,
        target_year=target_year,
        admin_token=admin_token,
        chat_rate_per_min=chat_rate_per_min,
        chat_rate_per_day=chat_rate_per_day,
    )


def index_name(kind: str) -> str:
    """Generate index name with configured prefix."""
    return f"{get_settings().index_prefix}{kind}"


def reload_env() -> None:
    """Reload backend/.env overriding existing environment variables and clear cached settings."""
    load_dotenv(BACKEND_DIR / ".env", override=True)
    get_settings.cache_clear()

