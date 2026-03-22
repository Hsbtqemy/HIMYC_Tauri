"""Tests integration bridge API HIMYC (MX-003).

Valide :
- /health toujours disponible
- Format d erreur standard (happy path + backend indisponible)
- /episodes sans projet configure → 503
- /episodes/{id}/sources/{key} sans projet → 503
- /config sans projet → 503
- /jobs → stub retourne liste vide
"""

from __future__ import annotations

import os
import json
import pytest
from fastapi.testclient import TestClient

from howimetyourcorpus.api.server import app

client = TestClient(app, raise_server_exceptions=False)


# ─── /health ──────────────────────────────────────────────────────────────────

def test_health_always_up():
    """GET /health retourne 200 et {"status": "ok"} meme sans projet configure."""
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "version" in data


# ─── Format d erreur standard ─────────────────────────────────────────────────

def test_error_format_no_project_config():
    """Sans HIMYC_PROJECT_PATH, /config retourne 503 avec format d erreur standard."""
    env_backup = os.environ.pop("HIMYC_PROJECT_PATH", None)
    try:
        r = client.get("/config")
        assert r.status_code == 503
        detail = r.json()["detail"]
        assert "error" in detail
        assert "message" in detail
        assert detail["error"] == "NO_PROJECT"
    finally:
        if env_backup is not None:
            os.environ["HIMYC_PROJECT_PATH"] = env_backup


def test_error_format_no_project_episodes():
    """Sans HIMYC_PROJECT_PATH, /episodes retourne 503 avec format d erreur standard."""
    env_backup = os.environ.pop("HIMYC_PROJECT_PATH", None)
    try:
        r = client.get("/episodes")
        assert r.status_code == 503
        detail = r.json()["detail"]
        assert "error" in detail
        assert detail["error"] == "NO_PROJECT"
    finally:
        if env_backup is not None:
            os.environ["HIMYC_PROJECT_PATH"] = env_backup


def test_error_format_project_not_found():
    """Chemin projet inexistant → 503 PROJECT_NOT_FOUND."""
    os.environ["HIMYC_PROJECT_PATH"] = "/tmp/himyc_nonexistent_test_path_xyz"
    try:
        r = client.get("/episodes")
        assert r.status_code == 503
        detail = r.json()["detail"]
        assert detail["error"] == "PROJECT_NOT_FOUND"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_error_format_invalid_source_key(tmp_path):
    """Cle source invalide → 400 INVALID_SOURCE_KEY."""
    # Projet minimal : dossier vide suffit pour passer la validation chemin
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/episodes/S01E01/sources/invalid_key")
        assert r.status_code == 400
        detail = r.json()["detail"]
        assert detail["error"] == "INVALID_SOURCE_KEY"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_error_format_source_not_found(tmp_path):
    """Transcript absent → 404 SOURCE_NOT_FOUND."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/episodes/S01E01/sources/transcript")
        assert r.status_code == 404
        detail = r.json()["detail"]
        assert detail["error"] == "SOURCE_NOT_FOUND"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


# ─── /episodes happy path (projet minimal) ────────────────────────────────────

def test_episodes_empty_project(tmp_path):
    """Projet sans series_index.json → retourne liste vide sans crash."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/episodes")
        assert r.status_code == 200
        data = r.json()
        assert data["episodes"] == []
        assert data["series_title"] is None
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_episodes_with_series_index(tmp_path):
    """Projet avec series_index.json → retourne les episodes."""
    # Creer un series_index.json minimal
    index = {
        "series_title": "Test Series",
        "series_url": "http://example.com",
        "episodes": [
            {
                "episode_id": "S01E01",
                "season": 1,
                "episode": 1,
                "title": "Pilot",
                "url": "http://example.com/S01E01",
                "source_id": None,
            }
        ],
    }
    (tmp_path / "series_index.json").write_text(json.dumps(index))
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/episodes")
        assert r.status_code == 200
        data = r.json()
        assert data["series_title"] == "Test Series"
        assert len(data["episodes"]) == 1
        ep = data["episodes"][0]
        assert ep["episode_id"] == "S01E01"
        assert ep["title"] == "Pilot"
        # La source transcript doit etre listee
        sources = ep["sources"]
        assert any(s["source_key"] == "transcript" for s in sources)
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_episodes_source_transcript_content(tmp_path):
    """Episode avec raw.txt → /sources/transcript retourne le contenu."""
    ep_dir = tmp_path / "episodes" / "S01E01"
    ep_dir.mkdir(parents=True)
    (ep_dir / "raw.txt").write_text("Hello world raw")
    (ep_dir / "clean.txt").write_text("Hello world clean")
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/episodes/S01E01/sources/transcript")
        assert r.status_code == 200
        data = r.json()
        assert data["source_key"] == "transcript"
        assert "Hello world raw" in data["raw"]
        assert "Hello world clean" in data["clean"]
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


# ─── /config ──────────────────────────────────────────────────────────────────

def test_config_minimal_project(tmp_path):
    """Projet minimal → /config retourne au moins project_name et project_path."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/config")
        assert r.status_code == 200
        data = r.json()
        assert "project_name" in data
        assert "project_path" in data
        assert "languages" in data
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


# ─── /jobs stub ───────────────────────────────────────────────────────────────

def test_jobs_stub_returns_empty_list(tmp_path):
    """GET /jobs retourne une liste vide (stub MX-006)."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/jobs")
        assert r.status_code == 200
        assert r.json()["jobs"] == []
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


# ─── POST /episodes/{id}/sources/transcript (MX-005) ─────────────────────────


def test_import_transcript_creates_raw(tmp_path):
    """POST /episodes/S01E01/sources/transcript → 201, raw.txt créé."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/episodes/S01E01/sources/transcript",
            json={"content": "Hello world transcript"},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["source_key"] == "transcript"
        assert data["state"] == "raw"
        assert (tmp_path / "episodes" / "S01E01" / "raw.txt").read_text() == "Hello world transcript"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_import_transcript_empty_content(tmp_path):
    """Contenu vide → 422 EMPTY_CONTENT."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/episodes/S01E01/sources/transcript",
            json={"content": "   "},
        )
        assert r.status_code == 422
        assert r.json()["detail"]["error"] == "EMPTY_CONTENT"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


# ─── POST /episodes/{id}/sources/srt_{lang} (MX-005) ─────────────────────────


def test_import_srt_creates_file(tmp_path):
    """POST /episodes/S01E01/sources/srt_en → 201, fichier SRT créé."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        srt_content = "1\n00:00:01,000 --> 00:00:02,000\nHello\n"
        r = client.post(
            "/episodes/S01E01/sources/srt_en",
            json={"content": srt_content, "fmt": "srt"},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["source_key"] == "srt_en"
        assert data["language"] == "en"
        assert data["state"] == "raw"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_import_srt_invalid_source_key(tmp_path):
    """source_key invalide → 400 INVALID_SOURCE_KEY."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/episodes/S01E01/sources/invalid_key",
            json={"content": "1\n00:00:01,000 --> 00:00:02,000\nHello\n"},
        )
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "INVALID_SOURCE_KEY"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_import_srt_empty_content(tmp_path):
    """Contenu SRT vide → 422 EMPTY_CONTENT."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/episodes/S01E01/sources/srt_fr",
            json={"content": ""},
        )
        assert r.status_code == 422
        assert r.json()["detail"]["error"] == "EMPTY_CONTENT"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_list_empty(tmp_path):
    """GET /jobs → liste vide sur un projet sans jobs."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/jobs")
        assert r.status_code == 200
        assert r.json()["jobs"] == []
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_create_normalize_transcript(tmp_path):
    """POST /jobs avec type normalize_transcript → 201 + job pending."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/jobs",
            json={"job_type": "normalize_transcript", "episode_id": "S01E01"},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["job_type"] == "normalize_transcript"
        assert data["episode_id"] == "S01E01"
        assert data["status"] in ("pending", "running", "done", "error")
        assert "job_id" in data
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_create_invalid_type(tmp_path):
    """POST /jobs avec type inconnu → 400 INVALID_JOB_TYPE."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/jobs",
            json={"job_type": "unknown_type", "episode_id": "S01E01"},
        )
        assert r.status_code == 400
        assert r.json()["detail"]["error"] == "INVALID_JOB_TYPE"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_get_by_id(tmp_path):
    """GET /jobs/{id} retourne le job créé."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r_create = client.post(
            "/jobs",
            json={"job_type": "normalize_transcript", "episode_id": "S01E02"},
        )
        job_id = r_create.json()["job_id"]
        r = client.get(f"/jobs/{job_id}")
        assert r.status_code == 200
        assert r.json()["job_id"] == job_id
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_get_by_id_not_found(tmp_path):
    """GET /jobs/{id} → 404 JOB_NOT_FOUND pour id inconnu."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/jobs/nonexistent-id")
        assert r.status_code == 404
        assert r.json()["detail"]["error"] == "JOB_NOT_FOUND"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_cancel_pending(tmp_path):
    """DELETE /jobs/{id} annule un job pending."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r_create = client.post(
            "/jobs",
            json={"job_type": "segment_transcript", "episode_id": "S01E03"},
        )
        job_id = r_create.json()["job_id"]
        # Annuler seulement si pending (le worker peut être rapide)
        r_del = client.delete(f"/jobs/{job_id}")
        # 200 (annulé) ou 409 (déjà running/done)
        assert r_del.status_code in (200, 409)
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_create_align(tmp_path):
    """POST /jobs avec type align + params → 201."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.post(
            "/jobs",
            json={
                "job_type": "align",
                "episode_id": "S01E01",
                "params": {"pivot_lang": "en", "target_langs": ["fr"], "segment_kind": "sentence"},
            },
        )
        assert r.status_code == 201
        data = r.json()
        assert data["job_type"] == "align"
        assert data["params"]["pivot_lang"] == "en"
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_alignment_runs_empty(tmp_path):
    """GET /episodes/{id}/alignment_runs → liste vide si aucun run."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        r = client.get("/episodes/S01E01/alignment_runs")
        assert r.status_code == 200
        data = r.json()
        assert data["episode_id"] == "S01E01"
        assert data["runs"] == []
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_jobs_persistence(tmp_path):
    """Les jobs sont persistés dans jobs.json après création."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        client.post(
            "/jobs",
            json={"job_type": "normalize_srt", "episode_id": "S01E01", "source_key": "srt_en"},
        )
        assert (tmp_path / "jobs.json").exists()
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]


def test_init_corpus_db_creates_then_idempotent(tmp_path):
    """POST /project/init_corpus_db crée corpus.db une fois puis created=false."""
    os.environ["HIMYC_PROJECT_PATH"] = str(tmp_path)
    try:
        db_path = tmp_path / "corpus.db"
        assert not db_path.exists()
        r = client.post("/project/init_corpus_db")
        assert r.status_code == 200
        data = r.json()
        assert data["created"] is True
        assert data["path"] == str(db_path)
        assert db_path.is_file()
        r2 = client.post("/project/init_corpus_db")
        assert r2.status_code == 200
        assert r2.json()["created"] is False
    finally:
        del os.environ["HIMYC_PROJECT_PATH"]
