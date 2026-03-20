"""Tests des statuts de préparation par fichier (Phase 3)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from howimetyourcorpus.core.models import ProjectConfig
from howimetyourcorpus.core.storage.project_store import ProjectStore


def _make_store(tmp_path: Path) -> ProjectStore:
    root = tmp_path / "project"
    config = ProjectConfig(
        project_name="prep_status_test",
        root_dir=root,
        source_id="subslikescript",
        series_url="https://example.invalid/series",
    )
    ProjectStore.init_project(config)
    return ProjectStore(root)


def test_project_store_set_get_episode_prep_status(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    assert store.get_episode_prep_status("S01E01", "transcript") == "raw"
    store.set_episode_prep_status("S01E01", "transcript", "edited")
    assert store.get_episode_prep_status("S01E01", "transcript") == "edited"
    # Persistance disque
    store2 = ProjectStore(store.root_dir)
    assert store2.get_episode_prep_status("S01E01", "transcript") == "edited"


def test_project_store_save_episode_prep_status_filters_invalid_values(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    store.save_episode_prep_status(
        {
            "S01E01": {"transcript": "verified", "srt_en": "invalid_status"},
            "S01E02": {"transcript": "to_review"},
        }
    )
    statuses = store.load_episode_prep_status()
    assert statuses["S01E01"]["transcript"] == "verified"
    assert "srt_en" not in statuses["S01E01"]
    assert statuses["S01E02"]["transcript"] == "to_review"


def test_project_store_set_episode_prep_status_rejects_invalid_status(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    with pytest.raises(ValueError):
        store.set_episode_prep_status("S01E01", "transcript", "bad")


def test_project_store_load_episode_prep_status_accepts_legacy_dict_schema(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    legacy_path = store.root_dir / store.EPISODE_PREP_STATUS_JSON
    legacy_path.write_text(
        json.dumps({"S01E01": {"transcript": "VERIFIED", "srt_en": "to_review"}}),
        encoding="utf-8",
    )

    statuses = store.load_episode_prep_status()
    assert statuses["S01E01"]["transcript"] == "verified"
    assert statuses["S01E01"]["srt_en"] == "to_review"
