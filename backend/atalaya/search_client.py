"""OpenSearch client, template management, and bulk ingestion for ATALAYA."""

from __future__ import annotations

import functools
import ipaddress
import logging
from typing import Any, Iterable
import urllib.parse
import urllib3
from urllib3.exceptions import InsecureRequestWarning
from opensearchpy import OpenSearch, helpers

from atalaya.config import get_settings
from atalaya.schema import TEMPLATES, template_body

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def get_client() -> OpenSearch | None:
    """Return a cached OpenSearch client, or None if no URLs configured."""
    settings = get_settings()
    if not settings.search_urls:
        return None

    use_ssl = any(u.lower().startswith("https://") for u in settings.search_urls)

    first_url = settings.search_urls[0]
    parsed = urllib.parse.urlparse(first_url)
    host = parsed.hostname or ""
    is_ip = False
    try:
        ipaddress.ip_address(host)
        is_ip = True
    except ValueError:
        is_ip = False

    if not settings.search_verify_certs:
        urllib3.disable_warnings(InsecureRequestWarning)

    client_kwargs: dict[str, Any] = {
        "hosts": settings.search_urls,
        "use_ssl": use_ssl,
        "verify_certs": settings.search_verify_certs,
        "ca_certs": settings.search_ca_certs or None,
        "ssl_show_warn": False,
        "timeout": settings.search_timeout_s,
        "max_retries": 2,
        "retry_on_timeout": True,
        "http_compress": True,
    }

    if settings.search_username or settings.search_password:
        client_kwargs["http_auth"] = (settings.search_username, settings.search_password)

    if is_ip:
        client_kwargs["ssl_assert_hostname"] = False

    return OpenSearch(**client_kwargs)


def reset_client() -> None:
    """Clear cached OpenSearch client for testing and retries."""
    if hasattr(get_client, "cache_clear"):
        get_client.cache_clear()


def ping(timeout_s: float = 5.0) -> bool:
    """Ping OpenSearch cluster, returning False on any error without raising."""
    try:
        client = get_client()
        if client is None:
            return False
        return bool(client.ping(request_timeout=timeout_s))
    except Exception as exc:
        logger.debug("OpenSearch ping failed: %s", type(exc).__name__)
        return False


def cluster_info(timeout_s: float = 5.0) -> dict[str, Any]:
    """Retrieve cluster health and version metadata without leaking credentials."""
    try:
        client = get_client()
        if client is None:
            return {}
        info = client.info(request_timeout=timeout_s)
        health = client.cluster.health(request_timeout=timeout_s)
        version_data = info.get("version", {})
        distribution = version_data.get("distribution") or ("elasticsearch" if "number" in version_data else "opensearch")
        version = str(version_data.get("number", ""))
        cluster_name = str(info.get("cluster_name", ""))
        status = str(health.get("status", ""))
        nodes = int(health.get("number_of_nodes", 0))
        return {
            "distribution": distribution,
            "version": version,
            "cluster_name": cluster_name,
            "status": status,
            "nodes": nodes,
        }
    except Exception as exc:
        logger.debug("OpenSearch cluster_info failed: %s", type(exc).__name__)
        return {}


def auto_replicas(client: OpenSearch) -> int:
    """Determine replica count automatically based on settings or cluster nodes."""
    settings = get_settings()
    if settings.search_replicas is not None:
        return settings.search_replicas
    try:
        health = client.cluster.health()
        nodes = int(health.get("number_of_nodes", 1))
        return min(1, max(nodes - 1, 0))
    except Exception as exc:
        logger.debug("Failed to query cluster health for auto_replicas: %s", type(exc).__name__)
        return 0


def index_settings(client: OpenSearch, *, replicas: int | None = None) -> dict[str, Any]:
    """Return index settings dictionary with shards, replicas, and intervals."""
    rep = replicas if replicas is not None else auto_replicas(client)
    return {
        "number_of_shards": 1,
        "number_of_replicas": rep,
        "refresh_interval": "1s",
        "max_result_window": 10000,
    }


def ensure_index_templates(client: OpenSearch) -> list[str]:
    """Install or update composite index templates, removing legacy templates."""
    settings = get_settings()
    prefix = settings.index_prefix
    applied: list[str] = []
    idx_settings = index_settings(client)

    for kind in TEMPLATES:
        template_name = f"{prefix}{kind}"
        if not template_name.startswith(prefix) or not prefix:
            raise ValueError(f"Template name '{template_name}' does not start with prefix '{prefix}'")

        try:
            if client.indices.exists_template(name=template_name):
                client.indices.delete_template(name=template_name)
        except Exception as exc:
            logger.debug("Failed checking/deleting legacy template '%s': %s", template_name, type(exc).__name__)

        body = template_body(kind, prefix, idx_settings)
        client.indices.put_index_template(name=template_name, body=body)
        applied.append(template_name)

    return applied


def bulk_index(
    client: OpenSearch,
    index: str,
    docs: Iterable[dict[str, Any]],
    *,
    id_field: str = "id",
    chunk: int = 1000,
    max_retries: int = 3,
) -> tuple[int, list[dict[str, Any]]]:
    """Bulk index documents into OpenSearch.

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

    for ok, result in helpers.streaming_bulk(
        client,
        generate_actions(),
        chunk_size=chunk,
        max_retries=max_retries,
        raise_on_error=False,
        raise_on_exception=False,
    ):
        if ok:
            ok_count += 1
        else:
            if len(errors) < 20:
                errors.append(result)

    return ok_count, errors
