"""Smoke test for Google Gemini grounded search and JSON extraction."""

from __future__ import annotations

import sys
import time

from atalaya.config import get_settings
from atalaya.gemini import grounded_json, is_enabled, resolve_source_url


def main() -> None:
    settings = get_settings()
    if not is_enabled():
        print("GEMINI_API_KEY no configurada")
        sys.exit(0)

    print("=== Gemini Grounded Search Smoke Test ===")
    print(f"Model: {settings.gemini_model}")
    print(f"Base URL: {settings.gemini_base_url}")
    print(f"Thinking level: {settings.gemini_thinking_level}")

    prompt = (
        "Lista en formato JSON exactamente 3 noticias recientes sobre el Instituto Nacional Electoral (INE). "
        "Devuelve un objeto con la clave 'noticias', donde cada elemento tenga 'titulo' y 'url'."
    )

    t0 = time.perf_counter()
    try:
        parsed_json, result = grounded_json(
            prompt,
            system="Eres un asistente de investigación electoral. Devuelve únicamente el JSON solicitado.",
        )
        dt = (time.perf_counter() - t0) * 1000

        print(f"\nLlamada completada en {dt:.1f} ms (latencia reportada: {result.latency_ms} ms)")
        print(f"Número de groundingChunks/fuentes: {len(result.sources)}")
        print(f"Número de consultas de búsqueda web: {len(result.queries)}")
        print(f"Consultas: {result.queries}")

        # Resolve up to 3 domains
        resolved_domains = []
        for s in result.sources[:3]:
            resolved = resolve_source_url(s.url)
            resolved_domains.append(f"{s.domain} (url: {resolved[:80]}...)")
        print("Primeros 3 dominios resueltos:")
        for rd in resolved_domains:
            print(f"  - {rd}")

        print(f"\n¿El JSON parseó con éxito?: {parsed_json is not None}")
        print(f"Contenido del JSON parseado: {parsed_json}")

    except Exception as exc:
        print(f"Error durante la prueba de Gemini: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
