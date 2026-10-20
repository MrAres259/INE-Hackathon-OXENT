"""ATALAYA OpenSearch Cluster Bootstrap Script.

Prepares a new, empty, or recreated OpenSearch cluster for use by ATALAYA.
Executes connectivity diagnostics, optional purge, full data ingestion,
parity verification against the memory store, and hot-reloads the running API.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
import sys
import time
from typing import Any
import urllib.parse
import urllib.request
import urllib.error

# Ensure backend root is on sys.path
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from opensearchpy.exceptions import AuthenticationException
from atalaya.config import BUILD_DIR, SEED_DIR, get_settings
from atalaya.load import (
    ensure_index_templates,
    load_kind,
    prepare_catalog_docs,
    prepare_participation_docs,
    prepare_profile_docs,
    prepare_units_docs,
    purge_prefixed,
    validate_docs,
)
from atalaya.search_client import (
    auto_replicas,
    cluster_info,
    get_client,
    ping,
)
from atalaya.store import PandasStore


def _format_clean_urls(urls: list[str]) -> list[str]:
    """Return host:port representation of URLs without credentials or paths."""
    clean = []
    for u in urls:
        parsed = urllib.parse.urlparse(u)
        host = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 9200)
        clean.append(f"{host}:{port}")
    return clean


def _reload_api(api_base: str, timeout_s: float = 10.0) -> tuple[bool, str]:
    """Trigger POST /api/admin/reload. Returns (ok, message)."""
    target = f"{api_base.rstrip('/')}/api/admin/reload"
    try:
        req = urllib.request.Request(
            target,
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return True, f"HTTP {resp.status}: {body[:80]}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.reason}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def bootstrap(
    *,
    reset: bool = False,
    skip_parity: bool = False,
    api_url: str = "http://127.0.0.1:8001",
) -> int:
    """Execute all cluster bootstrap steps. Returns exit code (0, 1, or 2)."""
    settings = get_settings()
    summary: list[tuple[str, str, str]] = []

    print("=" * 80)
    print(" ATALAYA · OpenSearch Cluster Bootstrap")
    print("=" * 80)

    # -------------------------------------------------------------------------
    # Paso 1: Configuración
    # -------------------------------------------------------------------------
    print("\n[Paso 1/7] Configuración de OpenSearch")
    clean_urls = _format_clean_urls(settings.search_urls)
    has_user = "sí" if settings.search_username else "no"
    print(f"  Endpoints:    {', '.join(clean_urls) if clean_urls else '(ninguno)'}")
    print(f"  Usuario:      {has_user}")
    print(f"  Verify Certs: {settings.search_verify_certs}")
    print(f"  Prefijo:      {settings.index_prefix}")

    if not settings.search_urls:
        summary.append(("1. Configuración", "FAIL", "Sin URLs configuradas"))
        summary.append(("2. Conectividad", "FAIL", "Sin URLs (OPENSEARCH_URL / ES_URL)"))
        _print_summary(summary)
        print("\nERROR: No hay URL de OpenSearch configurada.", file=sys.stderr)
        return 2

    summary.append(("1. Configuración", "OK", f"{len(clean_urls)} endpoint(s)"))

    # -------------------------------------------------------------------------
    # Paso 2: Conectividad
    # -------------------------------------------------------------------------
    print("\n[Paso 2/7] Conectividad con el clúster")
    client = get_client()
    if client is None:
        print("  Diagnóstico: No se pudo inicializar el cliente OpenSearch.")
        summary.append(("2. Conectividad", "FAIL", "No se pudo inicializar cliente"))
        _print_summary(summary)
        return 2

    connected = False
    max_retries = 5
    retry_delay = 10.0

    for attempt in range(1, max_retries + 1):
        try:
            if ping(timeout_s=5.0):
                connected = True
                print(f"  Conexión exitosa al intento {attempt}/{max_retries}.")
                break
        except Exception:
            pass

        if attempt < max_retries:
            print(f"  Intento {attempt}/{max_retries} no respondió. Esperando {int(retry_delay)}s...")
            time.sleep(retry_delay)

    if not connected:
        diag = "Clúster no alcanzable"
        try:
            client.info(request_timeout=5.0)
        except AuthenticationException:
            diag = "Autenticación fallida (401 Unauthorized - credenciales inválidas o faltantes)"
        except Exception as exc:
            diag = f"Clúster no alcanzable ({type(exc).__name__})"

        print(f"  Diagnóstico: {diag}")
        summary.append(("2. Conectividad", "FAIL", diag))
        _print_summary(summary)
        return 2

    summary.append(("2. Conectividad", "OK", "Conexión establecida"))

    # -------------------------------------------------------------------------
    # Paso 3: Información del clúster y salud
    # -------------------------------------------------------------------------
    print("\n[Paso 3/7] Información del clúster y salud")
    info = cluster_info(timeout_s=5.0)
    dist = info.get("distribution", "opensearch")
    ver = info.get("version", "unknown")
    nodes = info.get("nodes", 1)
    status = info.get("status", "unknown")

    print(f"  Distribución: {dist}")
    print(f"  Versión:      {ver}")
    print(f"  Nodos:        {nodes}")
    print(f"  Estado:       {status}")

    if status == "red":
        print("  Estado 'red'. Esperando hasta 60s a que cambie a yellow/green...")
        deadline = time.time() + 60.0
        while time.time() < deadline:
            time.sleep(5.0)
            try:
                h = client.cluster.health(request_timeout=5.0)
                status = str(h.get("status", "red"))
                if status in ("yellow", "green"):
                    print(f"  Estado actualizado a: {status}")
                    break
            except Exception:
                pass

    summary.append(("3. Salud del clúster", "OK" if status != "red" else "WARN", f"{dist} {ver}, status={status}, nodos={nodes}"))

    # -------------------------------------------------------------------------
    # Paso 4: Purga de recursos existentes (--reset)
    # -------------------------------------------------------------------------
    print("\n[Paso 4/7] Purga de recursos (--reset)")
    if reset:
        print("  Ejecutando purge_prefixed...")
        purged = purge_prefixed(client)
        print(f"  Alias purgados:      {len(purged['aliases'])} ({', '.join(purged['aliases']) or 'ninguno'})")
        print(f"  Índices purgados:    {len(purged['indices'])} ({', '.join(purged['indices']) or 'ninguno'})")
        print(f"  Plantillas purgadas: {len(purged['templates'])} ({', '.join(purged['templates']) or 'ninguno'})")
        summary.append((
            "4. Purga (--reset)",
            "OK",
            f"Purgados: {len(purged['aliases'])} alias, {len(purged['indices'])} índices, {len(purged['templates'])} plantillas",
        ))
    else:
        print("  --reset no especificado. Conservando recursos existentes.")
        summary.append(("4. Purga (--reset)", "OMITIDO", "Conservando recursos"))

    # -------------------------------------------------------------------------
    # Paso 5: Carga completa de datos
    # -------------------------------------------------------------------------
    print("\n[Paso 5/7] Carga completa de datos en proceso")
    store = PandasStore(build_dir=BUILD_DIR, seed_dir=SEED_DIR)
    all_docs = {
        "units": prepare_units_docs(store),
        "participation": prepare_participation_docs(store),
        "catalog": prepare_catalog_docs(store),
        "profile": prepare_profile_docs(store),
    }

    for k, docs in all_docs.items():
        print(f"  - {k}: {len(docs)} documentos preparados")

    val_errors: list[str] = []
    for k, docs in all_docs.items():
        errs = validate_docs(k, docs)
        if errs:
            val_errors.extend(errs[:5])

    load_ok = True
    if val_errors:
        load_ok = False
        print("  ERROR: Fallos en validación de documentos:")
        for err in val_errors:
            print(f"    - {err}")
        summary.append(("5. Carga de índices", "FAIL", f"Errores de validación: {len(val_errors)}"))
    else:
        try:
            print("  Instalando/actualizando plantillas de índice compuestas...")
            ensure_index_templates(client)

            replicas = auto_replicas(client)
            stamp = datetime.now().strftime("%Y%m%d%H%M%S")
            print(f"  Iniciando carga de índices con stamp={stamp}, replicas={replicas}...")

            for kind in ["units", "participation", "catalog", "profile"]:
                docs = all_docs.get(kind, [])
                res = load_kind(client, kind, docs, stamp=stamp, replicas=replicas, keep=1)
                print(f"    [OK] {kind}: {res['ok']}/{len(docs)} docs en {res['index']}")

            summary.append(("5. Carga de índices", "OK", "4/4 índices versionados cargados"))
        except Exception as exc:
            load_ok = False
            print(f"  ERROR durante la carga de índices: {exc}")
            summary.append(("5. Carga de índices", "FAIL", f"Excepción: {type(exc).__name__}"))

    # -------------------------------------------------------------------------
    # Paso 6: Verificación de paridad
    # -------------------------------------------------------------------------
    print("\n[Paso 6/7] Auditoría de paridad OpenSearch vs Memoria")
    parity_ok = True
    if skip_parity:
        print("  --skip-parity especificado. Verificación de paridad omitida.")
        summary.append(("6. Auditoría de paridad", "OMITIDO", "--skip-parity"))
    elif not load_ok:
        print("  Carga falló. Omitiendo auditoría de paridad.")
        summary.append(("6. Auditoría de paridad", "OMITIDO", "Carga previa falló"))
        parity_ok = False
    else:
        try:
            from scripts.os_parity import run_checks
            from atalaya.store import OpenSearchStore

            mem_store = store
            os_store = OpenSearchStore()

            p_checks = run_checks(mem_store, os_store)
            passed_count = sum(1 for _, passed, _ in p_checks)
            total_count = len(p_checks)

            for name, passed, detail in p_checks:
                status_str = "OK" if passed else "FAIL"
                print(f"    [{status_str}] {name}: {detail}")
                if not passed:
                    parity_ok = False

            if parity_ok:
                summary.append(("6. Auditoría de paridad", "OK", f"{passed_count}/{total_count} verificaciones superadas"))
            else:
                summary.append(("6. Auditoría de paridad", "FAIL", f"{passed_count}/{total_count} verificaciones superadas"))
        except Exception as exc:
            parity_ok = False
            print(f"  ERROR ejecutando auditoría de paridad: {exc}")
            summary.append(("6. Auditoría de paridad", "FAIL", f"Excepción: {type(exc).__name__}"))

    # -------------------------------------------------------------------------
    # Paso 7: Recarga de la API
    # -------------------------------------------------------------------------
    print(f"\n[Paso 7/7] Recarga en caliente de la API ({api_url})")
    api_ok, api_msg = _reload_api(api_url)
    if api_ok:
        print(f"  [OK] API recargada exitosamente: {api_msg}")
        summary.append(("7. Recarga de API", "OK", "Recarga exitosa"))
    else:
        print(f"  [AVISO] API no alcanzable en {api_url} ({api_msg}). Si está detenida, iniciará con los datos nuevos.")
        summary.append(("7. Recarga de API", "AVISO", "No alcanzable (no crítico)"))

    # -------------------------------------------------------------------------
    # Resumen y salida
    # -------------------------------------------------------------------------
    _print_summary(summary)

    if not load_ok or (not skip_parity and not parity_ok):
        return 1

    return 0


def _print_summary(rows: list[tuple[str, str, str]]) -> None:
    """Print formatted summary table."""
    col_w_step = 32
    col_w_status = 10
    print("\n" + "=" * 80)
    print(" RESUMEN DE ARRANQUE DEL CLÚSTER")
    print("=" * 80)
    print(f"{'PASO'.ljust(col_w_step)} | {'ESTADO'.ljust(col_w_status)} | DETALLE")
    print("-" * 80)
    for step_name, status, detail in rows:
        print(f"{step_name.ljust(col_w_step)} | {status.ljust(col_w_status)} | {detail}")
    print("=" * 80)


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap ATALAYA OpenSearch cluster")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Purge all existing prefixed indices, aliases, and templates before loading",
    )
    parser.add_argument(
        "--skip-parity",
        action="store_true",
        help="Skip parity validation checks between OpenSearch and memory store",
    )
    parser.add_argument(
        "--api",
        type=str,
        default="http://127.0.0.1:8001",
        help="API base URL to trigger hot reload (default: http://127.0.0.1:8001)",
    )
    args = parser.parse_args()

    exit_code = bootstrap(
        reset=args.reset,
        skip_parity=args.skip_parity,
        api_url=args.api,
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
