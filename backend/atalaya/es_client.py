"""Elasticsearch client, template management, and bulk ingestion for ATALAYA."""

from __future__ import annotations

import functools
import logging
from typing import Any, Iterable
import warnings
import urllib3
from urllib3.exceptions import InsecureRequestWarning
from elasticsearch import Elasticsearch
from elasticsearch.helpers import streaming_bulk

from atalaya.config import get_settings
from atalaya.schema import TEMPLATES

logger = logging.getLogger(__name__)

# Suppress urllib3 and elasticsearch insecure SSL warnings to avoid printing internal IPs/warnings
urllib3.disable_warnings(InsecureRequestWarning)
warnings.filterwarnings("ignore", message=".*verify_certs=False is insecure.*")


@functools.lru_cache(maxsize=1)
def get_es() -> Elasticsearch | None:
    """Return a cached Elasticsearch client, or None if no URLs configured."""
    settings = get_settings()
    if not settings.es_urls:
        return None

    if settings.es_insecure:
        urllib3.disable_warnings(InsecureRequestWarning)

    http_auth = None
    if settings.es_username or settings.es_password:
        http_auth = (settings.es_username, settings.es_password)

    return Elasticsearch(
        hosts=settings.es_urls,
        http_auth=http_auth,
        verify_certs=not settings.es_insecure,
        request_timeout=settings.es_timeout_s,
    )


def ping_es(timeout_s: float = 5.0) -> bool:
    """Ping Elasticsearch cluster, returning False on any error."""
    try:
        es = get_es()
        if es is None:
            return False
        return bool(es.ping(request_timeout=timeout_s))
    except Exception as e:
        logger.debug("ES ping failed: %s", e)
        return False


def ensure_templates(es: Elasticsearch) -> None:
    """Install legacy index templates for units, participation, and catalog."""
    settings = get_settings()
    prefix = settings.index_prefix

    for kind, mapping in TEMPLATES.items():
        template_name = f"{prefix}{kind}"
        body = {
            "index_patterns": [f"{prefix}{kind}*"],
            "settings": {
                "number_of_shards": 1,
                "number_of_replicas": 1,
                "refresh_interval": "5s",
            },
            "mappings": mapping,
        }
        es.indices.put_template(name=template_name, body=body)


def bulk_index(
    es: Elasticsearch,
    index: str,
    docs: Iterable[dict[str, Any]],
    id_field: str = "id",
    chunk: int = 2000,
) -> tuple[int, list[dict[str, Any]]]:
    """Bulk index documents into Elasticsearch.
    
    Returns (ok_count, sample_errors).
    """
    def generate_actions() -> Iterable[dict[str, Any]]:
        for doc in docs:
            action: dict[str, Any] = {
                "_index": index,
                "_source": doc,
            }
            if id_field in doc and doc[id_field] is not None:
                action["_id"] = str(doc[id_field])
            yield action

    ok_count = 0
    errors: list[dict[str, Any]] = []

    for ok, result in streaming_bulk(
        es,
        generate_actions(),
        chunk_size=chunk,
        raise_on_error=False,
    ):
        if ok:
            ok_count += 1
        else:
            if len(errors) < 20:
                errors.append(result)

    return ok_count, errors
