"""Smoke test for Huawei ModelArts MaaS LLM connectivity, reasoning effort and token headroom."""

from __future__ import annotations

import sys
import time

from atalaya.config import get_settings
from atalaya.llm import chat, describe, is_enabled


def _get_reasoning_tokens(meta: dict) -> int | str:
    usage = meta.get("usage") or {}
    details = usage.get("completion_tokens_details") or {}
    if "reasoning_tokens" in details:
        return details.get("reasoning_tokens")
    if "reasoning_tokens" in usage:
        return usage.get("reasoning_tokens")
    return "n/a"


def main() -> None:
    settings = get_settings()
    info = describe()
    print("=== ModelArts MaaS LLM Smoke Test ===")
    print(f"Model: {info['model']}")
    print(f"Reasoning effort: {info['reasoning_effort']}")
    print(f"Extra body mode: {info['extra_body_mode']}")
    print(f"Enabled: {is_enabled()}")

    if not is_enabled():
        print("LLM is disabled or MAAS_API_KEY is missing. Skipping smoke test.")
        sys.exit(0)

    # 1. Planner-like call
    print("\n--- 1. Planner-like call ---")
    t0 = time.perf_counter()
    meta1 = {}
    resp1 = chat(
        [
            {"role": "system", "content": "Eres un planificador de campañas de educación cívica del INE."},
            {"role": "user", "content": "Propón 2 acciones prioritarias para aumentar la participación electoral en zonas rurales."},
        ],
        max_tokens=300,
        meta=meta1,
    )
    dt1 = (time.perf_counter() - t0) * 1000
    rt1 = _get_reasoning_tokens(meta1)
    print(f"Response: {resp1[:160]}...")
    print(f"Latency: {dt1:.1f} ms | Reasoning tokens: {rt1} | Usage: {meta1.get('usage')}")

    # 2. Writer-like call
    print("\n--- 2. Writer-like call ---")
    t0 = time.perf_counter()
    meta2 = {}
    resp2 = chat(
        [
            {"role": "system", "content": "Eres un redactor institucional del INE neutro e imparcial."},
            {"role": "user", "content": "Escribe un aviso breve de 2 oraciones recordando renovar la credencial para votar."},
        ],
        max_tokens=200,
        meta=meta2,
    )
    dt2 = (time.perf_counter() - t0) * 1000
    rt2 = _get_reasoning_tokens(meta2)
    print(f"Response: {resp2.strip()}")
    print(f"Latency: {dt2:.1f} ms | Reasoning tokens: {rt2} | Usage: {meta2.get('usage')}")

    # 3. Topic guardrail gate call (max_tokens=5, testing reasoning headroom)
    print("\n--- 3. Topic guardrail gate call (max_tokens=5) ---")
    t0 = time.perf_counter()
    meta3 = {}
    resp3 = chat(
        [
            {
                "role": "system",
                "content": "Responde ÚNICAMENTE con la palabra VALID si la consulta es sobre elecciones o el INE, o REJECT si no lo es.",
            },
            {"role": "user", "content": "¿Cómo tramito mi credencial para votar?"},
        ],
        max_tokens=5,
        meta=meta3,
    )
    dt3 = (time.perf_counter() - t0) * 1000
    rt3 = _get_reasoning_tokens(meta3)
    gate_output = resp3.strip()
    print(f"Gate output: {gate_output!r}")
    print(f"Latency: {dt3:.1f} ms | Reasoning tokens: {rt3} | Usage: {meta3.get('usage')}")

    if not gate_output:
        print("WARNING: Gate output is empty! Reasoning may have consumed token budget.")
    elif "VALID" in gate_output.upper() or "REJECT" in gate_output.upper():
        print("SUCCESS: Gate returned non-empty VALID/REJECT classification.")


if __name__ == "__main__":
    main()
