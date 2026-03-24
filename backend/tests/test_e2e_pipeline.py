"""E2E pipeline : normalize → segment → export via l'API HTTP.

Couvre :
- POST /episodes/{id}/sources/transcript   → import texte brut
- POST /jobs normalize_transcript          → normalisation
- POST /jobs segment_transcript            → segmentation
- GET  /jobs/{id}                          → polling statut
- POST /export                             → export segments txt/csv
- GET  /episodes/{id}/sources/transcript   → lecture source normalisée
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from howimetyourcorpus.api.server import app

client = TestClient(app, raise_server_exceptions=False)

TRANSCRIPT = """\
Ted Mosby: Kids, I'm going to tell you an incredible story.
Marshall Eriksen: The story of how you met your mother?
Ted Mosby: Exactly. It all started in 2005.
Lily Aldrin: But first, let's set the scene.
Barney Stinson: Suit up!
Ted Mosby: In New York City, in the year 2030...
Marshall Eriksen: This is going to take a while.
Lily Aldrin: I'll get the popcorn.
Ted Mosby: Where was I? Right. It started with Robin.
Barney Stinson: Legendary. Wait for it.
"""

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _setup_project(tmp_path: Path) -> None:
    """Initialise un projet minimal avec series_index.json."""
    index = {
        "series_title": "How I Met Your Mother",
        "series_url": "",
        "episodes": [
            {"episode_id": "S01E01", "season": 1, "episode": 1, "title": "Pilot", "url": ""},
        ],
    }
    (tmp_path / "series_index.json").write_text(json.dumps(index), encoding="utf-8")
    (tmp_path / "episodes" / "S01E01").mkdir(parents=True, exist_ok=True)
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)


def _poll_job(job_id: str, timeout: float = 30.0) -> dict:
    """Poll GET /jobs/{id} jusqu'à statut terminal ou timeout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/jobs/{job_id}")
        assert r.status_code == 200, f"GET /jobs/{job_id} → {r.status_code}: {r.text}"
        job = r.json()
        if job["status"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.15)
    raise TimeoutError(f"Job {job_id} still running after {timeout}s")


# ─── Fixture ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def project(tmp_path: Path):
    """Projet HIMYC minimal disponible via HIMYC_PROJECT_PATH."""
    _setup_project(tmp_path)
    yield tmp_path
    os.environ.pop("HIMYC_PROJECT_PATH", None)


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestImportTranscript:
    """POST /episodes/{id}/sources/transcript"""

    def test_import_creates_raw_file(self, project: Path) -> None:
        r = client.post(
            "/episodes/S01E01/sources/transcript",
            json={"content": TRANSCRIPT},
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["episode_id"] == "S01E01"
        assert data["source_key"] == "transcript"
        assert data["state"] == "raw"
        assert (project / "episodes" / "S01E01" / "raw.txt").exists()

    def test_import_roundtrip_readable(self, project: Path) -> None:
        client.post("/episodes/S01E01/sources/transcript", json={"content": TRANSCRIPT})
        r = client.get("/episodes/S01E01/sources/transcript")
        assert r.status_code == 200
        assert r.json()["raw"] == TRANSCRIPT


class TestNormalizeJob:
    """POST /jobs normalize_transcript → normalisation du texte."""

    def test_normalize_produces_clean_text(self, project: Path) -> None:
        client.post("/episodes/S01E01/sources/transcript", json={"content": TRANSCRIPT})

        r = client.post("/jobs", json={
            "job_type": "normalize_transcript",
            "episode_id": "S01E01",
            "source_key": "transcript",
        })
        assert r.status_code in (200, 201), r.text
        job_id = r.json()["job_id"]

        job = _poll_job(job_id)
        assert job["status"] == "done", f"Job failed: {job.get('result')}"

        clean_path = project / "episodes" / "S01E01" / "clean.txt"
        assert clean_path.exists(), "clean.txt non créé après normalisation"
        clean_text = clean_path.read_text(encoding="utf-8")
        assert len(clean_text) > 0
        # Le texte normalisé contient les répliques sans artefacts de parsing
        assert "Ted Mosby" in clean_text or "Barney" in clean_text

    def test_normalize_updates_state(self, project: Path) -> None:
        client.post("/episodes/S01E01/sources/transcript", json={"content": TRANSCRIPT})
        r = client.post("/jobs", json={
            "job_type": "normalize_transcript",
            "episode_id": "S01E01",
            "source_key": "transcript",
        })
        _poll_job(r.json()["job_id"])

        r2 = client.get("/episodes")
        eps = r2.json()["episodes"]
        ep = next((e for e in eps if e["episode_id"] == "S01E01"), {})
        sources = ep.get("sources", [])
        transcript = next((s for s in sources if s.get("source_key") == "transcript"), {})
        state = transcript.get("state", "")
        assert state in ("normalized", "segmented"), \
            f"État attendu 'normalized' ou 'segmented', obtenu {state!r}"


class TestSegmentJob:
    """POST /jobs segment_transcript → segmentation des phrases."""

    def _prepare_clean(self, project: Path) -> None:
        client.post("/episodes/S01E01/sources/transcript", json={"content": TRANSCRIPT})
        r = client.post("/jobs", json={
            "job_type": "normalize_transcript",
            "episode_id": "S01E01",
            "source_key": "transcript",
        })
        _poll_job(r.json()["job_id"])

    def test_segment_produces_jsonl(self, project: Path) -> None:
        self._prepare_clean(project)

        r = client.post("/jobs", json={
            "job_type": "segment_transcript",
            "episode_id": "S01E01",
        })
        assert r.status_code in (200, 201), r.text
        job = _poll_job(r.json()["job_id"])
        assert job["status"] == "done", f"Segmentation échouée: {job.get('result')}"

        seg_path = project / "episodes" / "S01E01" / "segments.jsonl"
        assert seg_path.exists(), "segments.jsonl non créé"
        lines = seg_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) >= 5, f"Trop peu de segments : {len(lines)}"

    def test_segment_indexes_db(self, project: Path) -> None:
        self._prepare_clean(project)
        r = client.post("/jobs", json={
            "job_type": "segment_transcript",
            "episode_id": "S01E01",
        })
        _poll_job(r.json()["job_id"])

        r2 = client.get("/episodes")
        eps = {e["episode_id"]: e for e in r2.json()["episodes"]}
        ep = eps.get("S01E01", {})
        # L'épisode doit être marqué "segmented" dans l'état de la source
        sources = ep.get("sources", [])
        transcript = next((s for s in sources if s.get("source_key") == "transcript"), {})
        assert transcript.get("state") == "segmented", \
            f"État attendu 'segmented', obtenu {transcript.get('state')!r}"

    def test_segment_job_writes_sqlite_for_kwic(self, project: Path) -> None:
        """Le job segment_transcript doit remplir ``segments`` (+ FTS) pour le concordancier."""
        self._prepare_clean(project)
        r = client.post("/jobs", json={
            "job_type": "segment_transcript",
            "episode_id": "S01E01",
        })
        assert r.status_code in (200, 201), r.text
        _poll_job(r.json()["job_id"])

        assert (project / "corpus.db").exists(), "corpus.db doit être créé à la segmentation"
        rq = client.post("/query", json={"term": "Robin", "scope": "segments"})
        assert rq.status_code == 200, rq.text
        data = rq.json()
        assert data.get("total", 0) >= 1, f"Aucun hit KWIC alors que le transcript contient « Robin » : {data}"


class TestExport:
    """POST /export → export du corpus segmenté."""

    def _prepare_segmented(self, project: Path) -> None:
        client.post("/episodes/S01E01/sources/transcript", json={"content": TRANSCRIPT})
        r1 = client.post("/jobs", json={
            "job_type": "normalize_transcript",
            "episode_id": "S01E01",
            "source_key": "transcript",
        })
        _poll_job(r1.json()["job_id"])
        r2 = client.post("/jobs", json={
            "job_type": "segment_transcript",
            "episode_id": "S01E01",
        })
        _poll_job(r2.json()["job_id"])

    def test_export_txt(self, project: Path) -> None:
        self._prepare_segmented(project)
        r = client.post("/export", json={"scope": "segments", "fmt": "txt", "use_clean": True})
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert data["scope"] == "segments"
        assert data["fmt"] == "txt"
        out_path = Path(data["path"])
        assert out_path.exists(), f"Fichier export introuvable : {out_path}"
        content = out_path.read_text(encoding="utf-8")
        assert len(content) > 0

    def test_export_csv(self, project: Path) -> None:
        self._prepare_segmented(project)
        r = client.post("/export", json={"scope": "segments", "fmt": "csv", "use_clean": True})
        assert r.status_code in (200, 201), r.text
        out_path = Path(r.json()["path"])
        lines = out_path.read_text(encoding="utf-8").strip().splitlines()
        assert lines[0].startswith("episode_id") or "," in lines[0], \
            f"En-tête CSV inattendu : {lines[0]!r}"
        assert len(lines) >= 6, f"CSV trop court ({len(lines)} lignes)"

    def test_export_requires_segmented_corpus(self, project: Path) -> None:
        """Export échoue proprement si aucun segment disponible."""
        r = client.post("/export", json={"scope": "segments", "fmt": "txt", "use_clean": True})
        # Soit 200 avec fichier vide, soit 4xx — pas de 500
        assert r.status_code < 500, f"Erreur serveur inattendue : {r.text}"


class TestImportCharactersFromSegments:
    """POST /characters/import_from_segments — parité PyQt (locuteurs → catalogue)."""

    def _prepare_segmented(self, project: Path) -> None:
        client.post("/episodes/S01E01/sources/transcript", json={"content": TRANSCRIPT})
        r1 = client.post("/jobs", json={
            "job_type": "normalize_transcript",
            "episode_id": "S01E01",
            "source_key": "transcript",
        })
        _poll_job(r1.json()["job_id"])
        r2 = client.post("/jobs", json={
            "job_type": "segment_transcript",
            "episode_id": "S01E01",
        })
        _poll_job(r2.json()["job_id"])

    def test_import_adds_entries_from_segment_speakers(self, project: Path) -> None:
        self._prepare_segmented(project)
        r = client.post("/characters/import_from_segments", json={})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["distinct_speakers_found"] >= 1
        assert data["added"] >= 1
        r2 = client.get("/characters")
        assert r2.status_code == 200
        chars = r2.json()["characters"]
        assert len(chars) >= 1
        assert any((c.get("canonical") or "").strip() for c in chars)
