"""Smoke test for Huawei ModelArts MaaS LLM connectivity and JSON extraction."""

from __future__ import annotations

import sys
import time
from pydantic import BaseModel

from atalaya.config import get_settings
from atalaya.llm import chat, chat_json, chat_stream, is_enabled


class LocationExtraction(BaseModel):
    municipio: str
    estado: str


def main() -> None:
    settings = get_settings()
    print("Checking LLM configuration...")
    print(f"Model: {settings.maas_model}")
    print(f"Enabled: {is_enabled()}")

    if not is_enabled():
        print("LLM is disabled or MAAS_API_KEY is missing. Skipping smoke test.")
        sys.exit(0)

    print("\n--- 1. Testing chat() ---")
    t0 = time.perf_counter()
    meta = {}
    resp = chat(
        [{"role": "user", "content": "Di 'Hola ATALAYA' en una sola línea."}],
        max_tokens=30,
        meta=meta,
    )
    dt = (time.perf_counter() - t0) * 1000
    print(f"Response: {resp}")
    print(f"Latency: {dt:.1f} ms | Meta: {meta}")

    print("\n--- 2. Testing chat_stream() ---")
    t0 = time.perf_counter()
    chunks = []
    for token in chat_stream(
        [{"role": "user", "content": "Cuenta de 1 a 5 separando con comas."}],
        max_tokens=30,
    ):
        chunks.append(token)
        sys.stdout.write(token)
        sys.stdout.flush()
    print()
    dt = (time.perf_counter() - t0) * 1000
    print(f"Stream latency: {dt:.1f} ms")

    print("\n--- 3. Testing chat_json() ---")
    t0 = time.perf_counter()
    extracted = chat_json(
        [{"role": "user", "content": "Tuxtla Gutiérrez es la capital de Chiapas."}],
        LocationExtraction,
        max_tokens=100,
    )
    dt = (time.perf_counter() - t0) * 1000
    print(f"Parsed JSON: {extracted}")
    print(f"Extraction latency: {dt:.1f} ms")


if __name__ == "__main__":
    main()
