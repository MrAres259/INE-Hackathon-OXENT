"""Check connectivity and list indices on the Elasticsearch cluster."""

from __future__ import annotations

import sys
from atalaya.config import get_settings, index_name
from atalaya.es_client import get_es, ping_es


def main() -> None:
    settings = get_settings()
    prefix = settings.index_prefix
    print(f"Checking cluster connectivity with prefix='{prefix}'...")

    if not ping_es(timeout_s=5.0):
        print("Cluster is UNREACHABLE (ping failed within 5.0s).")
        sys.exit(0)

    es = get_es()
    if es is None:
        print("No ES cluster configured.")
        sys.exit(0)

    try:
        health = es.cluster.health()
        print(f"Cluster status: {health.get('status')} (nodes: {health.get('number_of_nodes')})")
        info = es.info()
        print(f"ES version: {info.get('version', {}).get('number')}")

        indices = es.cat.indices(index=f"{prefix}*", format="json")
        print(f"Found {len(indices)} indices matching '{prefix}*':")
        for idx in indices:
            name = idx.get("index")
            docs = idx.get("docs.count")
            status = idx.get("status")
            print(f"  - {name} (status: {status}, docs: {docs})")
    except Exception as e:
        print(f"Error querying cluster: {e}")


if __name__ == "__main__":
    main()
