"""GET /export/qa — gate et issues (lenient vs strict)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from howimetyourcorpus.api.server import app
from howimetyourcorpus.core.constants import (
    CLEAN_TEXT_FILENAME,
    EPISODES_DIR_NAME,
    RAW_TEXT_FILENAME,
    SEGMENTS_JSONL_FILENAME,
)

client = TestClient(app, raise_server_exceptions=False)


def _set_project(tmp_path: Path) -> None:
    (tmp_path / EPISODES_DIR_NAME).mkdir(parents=True, exist_ok=True)
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)


def _write_index(tmp_path: Path, episode_ids: list[str]) -> None:
    index = {
        "series_title": "Test",
        "series_url": "",
        "episodes": [
            {"episode_id": eid, "season": 1, "episode": i + 1, "title": eid, "url": ""}
            for i, eid in enumerate(episode_ids)
        ],
    }
    (tmp_path / "series_index.json").write_text(json.dumps(index), encoding="utf-8")


@pytest.fixture()
def project(tmp_path: Path):
    _set_project(tmp_path)
    yield tmp_path
    os.environ.pop("HIMYC_PROJECT_PATH", None)


def test_export_qa_lenient_placeholder_episode_is_warning_not_blocking(project: Path) -> None:
    """Catalogue TV : épisode sans fichiers → avertissement en lenient, gate jamais blocking."""
    _write_index(project, ["S01E01"])
    r = client.get("/export/qa?policy=lenient")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["gate"] != "blocking"
    assert data["gate"] == "warnings"
    assert not any(i["level"] == "blocking" for i in data["issues"])


def test_export_qa_strict_placeholder_episode_is_blocking(project: Path) -> None:
    _write_index(project, ["S01E01"])
    r = client.get("/export/qa?policy=strict")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["gate"] == "blocking"
    assert any(i["code"] == "NO_EPISODE_CONTENT" for i in data["issues"])


def test_export_qa_clean_without_raw_is_not_missing_transcript(project: Path) -> None:
    """clean.txt sans raw.txt : non segmenté (warning), pas « transcript manquant »."""
    _write_index(project, ["S01E01"])
    ep_dir = project / EPISODES_DIR_NAME / "S01E01"
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / CLEAN_TEXT_FILENAME).write_text("Hello world.", encoding="utf-8")

    r = client.get("/export/qa?policy=lenient")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = [i["code"] for i in data["issues"]]
    assert "NOT_SEGMENTED" in codes
    assert "NO_EPISODE_CONTENT" not in codes
    assert "NO_TRANSCRIPT" not in codes


def test_export_qa_fully_segmented_ok(project: Path) -> None:
    _write_index(project, ["S01E01"])
    ep_dir = project / EPISODES_DIR_NAME / "S01E01"
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / RAW_TEXT_FILENAME).write_text("x", encoding="utf-8")
    (ep_dir / CLEAN_TEXT_FILENAME).write_text("Hello.", encoding="utf-8")
    (ep_dir / SEGMENTS_JSONL_FILENAME).write_text(
        '{"segment_id":"S01E01:sentence:0","episode_id":"S01E01","kind":"sentence","n":0,'
        '"start_char":0,"end_char":5,"text":"Hello.","speaker_explicit":null,"meta":{}}\n',
        encoding="utf-8",
    )
    r = client.get("/export/qa?policy=lenient")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["gate"] == "ok"
    assert data["issues"] == []
