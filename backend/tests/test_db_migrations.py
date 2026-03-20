"""Tests des migrations DB : v1 → application des migrations jusqu'à la version courante."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from howimetyourcorpus.core.storage.db import CorpusDB, SCHEMA_SQL


@pytest.fixture
def db_path_v1_only(tmp_path: Path) -> Path:
    """Base de données avec schéma v1 uniquement (schema.sql, sans migrations)."""
    db_path = tmp_path / "corpus_v1.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    return db_path


def test_migrate_v1_to_latest_creates_segments_subtitle_tracks_align_runs(db_path_v1_only: Path) -> None:
    """
    À partir d'une DB avec schéma v1 uniquement, ensure_migrated() applique les migrations
    et crée les tables segments, subtitle_tracks, align_runs. Vérification via API publique.
    """
    db = CorpusDB(db_path_v1_only)
    db.ensure_migrated()

    assert db.get_schema_version() == 5, "schema_version doit être 5 après toutes les migrations"
    # Tables segments, subtitle_tracks, align_runs sont requêtables (pas d'exception)
    assert db.get_segments_for_episode("S01E01") == []
    assert db.get_tracks_for_episode("S01E01") == []
    assert db.get_align_runs_for_episode("S01E01") == []
