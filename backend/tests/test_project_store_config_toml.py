"""Tests de robustesse TOML de ProjectStore."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from howimetyourcorpus.core.models import ProjectConfig
from howimetyourcorpus.core.storage.project_store import ProjectStore


def _make_store(tmp_path: Path) -> ProjectStore:
    root = tmp_path / "project"
    config = ProjectConfig(
        project_name="config_test",
        root_dir=root,
        source_id="subslikescript",
        series_url="https://example.invalid/series",
    )
    ProjectStore.init_project(config)
    return ProjectStore(root)


def test_save_config_extra_preserves_toml_bool_syntax(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    store.save_config_extra(
        {
            "opensubtitles_api_key": "abc",
            "feature_enabled": True,
            "feature_disabled": False,
        }
    )

    loaded = store.load_config_extra()
    assert loaded.get("opensubtitles_api_key") == "abc"
    assert loaded.get("feature_enabled") is True
    assert loaded.get("feature_disabled") is False


def test_load_project_languages_logs_warning_on_corrupted_json(
    tmp_path: Path,
    caplog,
) -> None:
    store = _make_store(tmp_path)
    path = store.root_dir / store.LANGUAGES_JSON
    path.write_text("{ not-json", encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="howimetyourcorpus.core.storage.project_store"):
        langs = store.load_project_languages()

    assert langs == store.DEFAULT_LANGUAGES
    assert any("Impossible de charger" in rec.message for rec in caplog.records)


def test_get_episode_text_presence_scans_existing_episode_dirs(tmp_path: Path) -> None:
    store = _make_store(tmp_path)

    ep1 = store.root_dir / "episodes" / "S01E01"
    ep1.mkdir(parents=True, exist_ok=True)
    (ep1 / "raw.txt").write_text("raw", encoding="utf-8")

    ep2 = store.root_dir / "episodes" / "S01E02"
    ep2.mkdir(parents=True, exist_ok=True)
    (ep2 / "clean.txt").write_text("clean", encoding="utf-8")

    raw_ids, clean_ids = store.get_episode_text_presence()
    assert "S01E01" in raw_ids
    assert "S01E01" not in clean_ids
    assert "S01E02" in clean_ids
    assert "S01E02" not in raw_ids


def test_save_character_names_rejects_alias_collisions(tmp_path: Path) -> None:
    store = _make_store(tmp_path)

    with pytest.raises(ValueError, match="Collision d'alias"):
        store.save_character_names(
            [
                {
                    "id": "ted",
                    "canonical": "Ted",
                    "names_by_lang": {"en": "Ted"},
                },
                {
                    "id": "theodore",
                    "canonical": "Theodore",
                    "names_by_lang": {"en": "Ted"},
                },
            ]
        )


def test_save_character_names_rejects_orphan_assignments(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    store.save_character_assignments(
        [
            {
                "episode_id": "S01E01",
                "source_type": "cue",
                "source_id": "S01E01:en:1",
                "character_id": "barney",
            }
        ]
    )

    with pytest.raises(ValueError, match="Assignations invalides"):
        store.save_character_names(
            [
                {
                    "id": "ted",
                    "canonical": "Ted",
                    "names_by_lang": {"en": "Ted"},
                }
            ]
        )


def test_episode_segmentation_options_roundtrip(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    store.set_episode_segmentation_options(
        "S01E01",
        "transcript",
        {
            "speaker_regex": r"^([A-Z]+):\s*(.*)$",
            "enable_dash_rule": False,
            "continuation_markers": "..., --",
            "merge_if_prev_ends_with_marker": False,
            "attach_unmarked_to_previous": True,
        },
    )

    options = store.get_episode_segmentation_options("S01E01", "transcript")
    assert options["speaker_regex"] == r"^([A-Z]+):\s*(.*)$"
    assert options["enable_dash_rule"] is False
    assert options["continuation_markers"] == ["...", "--"]
    assert options["merge_if_prev_ends_with_marker"] is False
    assert options["attach_unmarked_to_previous"] is True


def test_episode_segmentation_options_reject_invalid_regex(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    with pytest.raises(ValueError, match="Regex locuteur invalide"):
        store.set_episode_segmentation_options(
            "S01E01",
            "transcript",
            {"speaker_regex": "["},
        )
