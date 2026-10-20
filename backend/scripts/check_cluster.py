"""Check connectivity and inspect templates, aliases, and indices on OpenSearch."""

from __future__ import annotations

import os
from pathlib import Path
import sys
import urllib.parse

# Ensure backend root is on sys.path
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from opensearchpy.exceptions import AuthenticationException, NotFoundError
from atalaya.config import get_settings
from atalaya.search_client import get_client


def _format_clean_urls(urls: list[str]) -> list[str]:
    clean = []
    for u in urls:
        parsed = urllib.parse.urlparse(u)
        host = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 9200)
        clean.append(f"{host}:{port}")
    return clean


def main() -> None:
    settings = get_settings()
    prefix = settings.index_prefix

    if not settings.search_urls:
        print("Diagnostic: No OpenSearch URL configured (OPENSEARCH_URL / ES_URL is empty).")
        sys.exit(2)

    clean_urls = _format_clean_urls(settings.search_urls)
    print(f"Checking OpenSearch cluster at {', '.join(clean_urls)} with prefix='{prefix}'...")

    client = get_client()
    if client is None:
        print("Diagnostic: Could not initialize OpenSearch client.")
        sys.exit(2)

    try:
        info = client.info(request_timeout=5.0)
    except AuthenticationException:
        print("Diagnostic: Authentication failed (401 Unauthorized - invalid or missing credentials).")
        sys.exit(2)
    except Exception as exc:
        print(f"Diagnostic: Cluster unreachable ({type(exc).__name__}).")
        sys.exit(2)

    version_data = info.get("version", {})
    distribution = version_data.get("distribution") or ("elasticsearch" if "number" in version_data else "opensearch")
    version_num = version_data.get("number", "unknown")
    print(f"Distribution: {distribution}")
    print(f"Version: {version_num}")

    try:
        health = client.cluster.health(request_timeout=5.0)
        print(f"Cluster status: {health.get('status')} (nodes: {health.get('number_of_nodes')})")
    except Exception as exc:
        print(f"Could not retrieve cluster health: {type(exc).__name__}")

    # Inspect composite index templates
    print(f"\nIndex templates matching '{prefix}*':")
    try:
        res = client.indices.get_index_template(name=f"{prefix}*")
        templates = res.get("index_templates", [])
        if not templates:
            print("  (None found)")
        for item in templates:
            t_name = item.get("name")
            patterns = item.get("index_template", {}).get("index_patterns", [])
            print(f"  - {t_name} (patterns: {patterns})")
    except NotFoundError:
        print("  (None found - 404)")
    except Exception as exc:
        print(f"  Error querying templates: {type(exc).__name__}")

    # Inspect aliases
    print(f"\nAliases matching '{prefix}*':")
    try:
        aliases_data = client.cat.aliases(name=f"{prefix}*", format="json")
        if not aliases_data:
            print("  (None found)")
        for entry in aliases_data:
            a_name = entry.get("alias")
            idx_name = entry.get("index")
            print(f"  - {a_name} -> {idx_name}")
    except NotFoundError:
        print("  (None found - 404)")
    except Exception as exc:
        print(f"  Error querying aliases: {type(exc).__name__}")

    # Inspect indices
    print(f"\nIndices matching '{prefix}*':")
    try:
        indices = client.cat.indices(index=f"{prefix}*", format="json")
        if not indices:
            print("  (None found)")
        for idx in indices:
            name = idx.get("index")
            docs = idx.get("docs.count")
            status = idx.get("status")
            print(f"  - {name} (status: {status}, docs: {docs})")
    except NotFoundError:
        print("  (None found - 404)")
    except Exception as exc:
        print(f"  Error querying indices: {type(exc).__name__}")

    sys.exit(0)


if __name__ == "__main__":
    main()
