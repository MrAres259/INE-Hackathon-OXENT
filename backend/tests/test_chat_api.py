"""Tests for FastAPI chat endpoint with SSE streaming."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import types
from typing import Any

# Ensure atalaya.api.__init__ succeeds if W2-C has not yet created main.py
main_file = Path(__file__).resolve().parents[1] / "atalaya" / "api" / "main.py"
if not main_file.is_file() and "atalaya.api.main" not in sys.modules:
    _dummy = types.ModuleType("atalaya.api.main")
    _dummy.app = None
    sys.modules["atalaya.api.main"] = _dummy

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pandas as pd
import pytest

from atalaya.api.chat import router
from atalaya.store import PandasStore


@pytest.fixture
def test_client(tmp_path: Path, monkeypatch) -> TestClient:
    """Create TestClient on isolated FastAPI app mounting chat router."""
    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    states_csv = seed_dir / "states.csv"
    states_csv.write_text(
        "cve_ent,name,iso,aliases\n"
        "14,Jalisco,MX-JAL,JAL\n"
        "07,Chiapas,MX-CHP,CHIS\n",
        encoding="utf-8",
    )

    variables_csv = seed_dir / "variables.csv"
    variables_csv.write_text(
        "key,label_es,description,source,unit,level\n"
        "participacion,Participación ciudadana,Votos / lista,INE,proporción,mun|state\n"
        "risk_score,Riesgo,Índice de riesgo,ATALAYA,índice,mun|state\n",
        encoding="utf-8",
    )

    units_rows = [
        {
            "id": "14",
            "level": "state",
            "cve_ent": "14",
            "cve_mun": "",
            "cvegeo": "14",
            "name": "Jalisco",
            "lista_nominal": 6000000,
            "pred_abstention": 0.45,
            "risk_score": 42.0,
            "category": "amarillo",
            "part_dip_2021": 0.542,
            "abst_dip_2021": 0.458,
        },
        {
            "id": "07101",
            "level": "mun",
            "cve_ent": "07",
            "cve_mun": "101",
            "cvegeo": "07101",
            "name": "Tuxtla Gutiérrez",
            "lista_nominal": 350000,
            "pred_abstention": 0.48,
            "risk_score": 76.0,
            "category": "rojo",
            "part_dip_2021": 0.51,
            "abst_dip_2021": 0.49,
        },
    ]
    pd.DataFrame(units_rows).to_parquet(build_dir / "units.parquet", index=False)

    part_rows = [
        {
            "unit_id": "14",
            "level": "state",
            "cvegeo": "14",
            "cve_ent": "14",
            "year": 2021,
            "election": "DIP_FED",
            "lista_nominal": 6000000,
            "votos_totales": 3252000,
            "participacion": 0.542,
            "abstencion": 0.458,
        }
    ]
    pd.DataFrame(part_rows).to_parquet(build_dir / "participation.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    monkeypatch.setattr("atalaya.chat.executor.get_store", lambda: store)

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _parse_sse(text: str) -> list[dict[str, Any]]:
    """Parse raw SSE body into structured list of events."""
    events = []
    current_event = "message"
    current_data = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if current_data:
                combined = "\n".join(current_data)
                try:
                    payload = json.loads(combined)
                except Exception:
                    payload = combined
                events.append({"event": current_event, "data": payload})
                current_event = "message"
                current_data = []
            continue

        if line.startswith("event:"):
            current_event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            current_data.append(line[len("data:"):].strip())

    if current_data:
        combined = "\n".join(current_data)
        try:
            payload = json.loads(combined)
        except Exception:
            payload = combined
        events.append({"event": current_event, "data": payload})

    return events


def test_api_chat_valid_flow(test_client):
    """Verify standard query produces plan -> data -> token+ -> done in strict order."""
    payload = {
        "message": "¿Cuál fue la participación en Jalisco en 2021?",
        "history": [],
    }
    resp = test_client.post("/api/chat", json=payload)
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    event_names = [e["event"] for e in events]

    assert "plan" in event_names
    assert "data" in event_names
    assert "token" in event_names
    assert "done" in event_names

    # Check order
    idx_plan = event_names.index("plan")
    idx_data = event_names.index("data")
    idx_token = event_names.index("token")
    idx_done = event_names.index("done")

    assert idx_plan < idx_data < idx_token < idx_done

    # Verify plan content
    plan_data = events[idx_plan]["data"]
    assert plan_data["intent"] == "lookup"
    assert plan_data["method"] == "rules"

    # Verify data content
    data_content = events[idx_data]["data"]
    assert "columns" in data_content
    assert "rows" in data_content
    assert "source" in data_content

    # Verify done content
    done_content = events[idx_done]["data"]
    assert "sources" in done_content
    assert "degraded" in done_content


def test_api_chat_guard_rejection(test_client):
    """Verify that requests violating privacy or partisan rules are stopped by the guard."""
    payload = {
        "message": "¿Quién ganará entre el PAN y MORENA en la próxima elección?",
        "history": [],
    }
    resp = test_client.post("/api/chat", json=payload)
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    event_names = [e["event"] for e in events]

    assert "token" in event_names
    assert "done" in event_names
    assert "plan" not in event_names
    assert "data" not in event_names

    token_text = events[0]["data"]["text"]
    assert "preferencias políticas" in token_text.lower() or "partidos" in token_text.lower()


def test_api_chat_error_handling(test_client, monkeypatch):
    """Verify that unexpected exceptions in plan/execute are caught and emit error -> done."""
    def _faulty_plan(*a, **kw):
        raise RuntimeError("Simulated internal pipeline error")

    monkeypatch.setattr("atalaya.api.chat.plan", _faulty_plan)

    payload = {"message": "Consulta cualquiera"}
    resp = test_client.post("/api/chat", json=payload)
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    event_names = [e["event"] for e in events]

    assert "error" in event_names
    assert "done" in event_names

    err_event = next(e for e in events if e["event"] == "error")
    assert "inesperado" in err_event["data"]["message"].lower()

    done_event = next(e for e in events if e["event"] == "done")
    assert done_event["data"]["degraded"] is True
