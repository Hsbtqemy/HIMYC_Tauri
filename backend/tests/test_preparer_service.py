"""Tests du service métier Préparer."""

from __future__ import annotations

from pathlib import Path

import pytest

from howimetyourcorpus.core.models import EpisodeRef, ProjectConfig
from howimetyourcorpus.core.preparer import PreparerService
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore
from howimetyourcorpus.core.subtitles import Cue


def _init_project(tmp_path: Path) -> tuple[ProjectStore, CorpusDB]:
    root = tmp_path / "project"
    config = ProjectConfig(
        project_name="prep_service_test",
        root_dir=root,
        source_id="subslikescript",
        series_url="https://example.invalid/series",
    )
    ProjectStore.init_project(config)
    store = ProjectStore(root)
    db = CorpusDB(store.get_db_path())
    db.init()
    db.upsert_episode(
        EpisodeRef(
            episode_id="S01E01",
            season=1,
            episode=1,
            title="Pilot",
            url="https://example.invalid/s01e01",
        )
    )
    return store, db


def test_save_cue_edits_syncs_assignments_and_rewrites_srt(tmp_path: Path) -> None:
    store, db = _init_project(tmp_path)
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=2500,
                text_raw="Hi there",
                text_clean="Hi there",
            )
        ],
    )
    store.save_character_names(
        [{"id": "ted", "canonical": "Ted", "names_by_lang": {"en": "Ted", "fr": "Ted"}}]
    )
    service = PreparerService(store, db)

    service.save_cue_edits(
        "S01E01",
        "en",
        [
            {
                "cue_id": "S01E01:en:0",
                "text_clean": "Ted: Hi there",
                "character_id": "ted",
            }
        ],
        rewrite_subtitle_file=True,
    )

    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert len(cues) == 1
    assert cues[0]["text_clean"] == "Ted: Hi there"

    assignments = store.load_character_assignments()
    assert any(
        a.get("episode_id") == "S01E01"
        and a.get("source_type") == "cue"
        and a.get("source_id") == "S01E01:en:0"
        and a.get("character_id") == "ted"
        for a in assignments
    )

    subtitle = store.load_episode_subtitle_content("S01E01", "en")
    assert subtitle is not None
    content, fmt = subtitle
    assert fmt == "srt"
    assert "00:00:01,000 --> 00:00:02,500" in content
    assert "Ted: Hi there" in content


def test_save_cue_edits_rolls_back_on_subtitle_rewrite_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store, db = _init_project(tmp_path)
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=2500,
                text_raw="Hi there",
                text_clean="Hi there",
            )
        ],
    )
    store.save_episode_subtitle_content(
        "S01E01",
        "en",
        "1\n00:00:01,000 --> 00:00:02,500\nHi there\n",
        "srt",
    )
    service = PreparerService(store, db)

    original_save = store.save_episode_subtitle_content
    calls = {"n": 0}

    def _flaky_save(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("disk full")
        return original_save(*args, **kwargs)

    monkeypatch.setattr(store, "save_episode_subtitle_content", _flaky_save)

    with pytest.raises(OSError):
        service.save_cue_edits(
            "S01E01",
            "en",
            [
                {
                    "cue_id": "S01E01:en:0",
                    "text_clean": "Ted: Hi there",
                    "character_id": "ted",
                    "start_ms": 1200,
                    "end_ms": 2600,
                }
            ],
            rewrite_subtitle_file=True,
        )

    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert len(cues) == 1
    assert cues[0]["text_clean"] == "Hi there"
    assert cues[0]["start_ms"] == 1000
    assert cues[0]["end_ms"] == 2500

    subtitle = store.load_episode_subtitle_content("S01E01", "en")
    assert subtitle is not None
    content, fmt = subtitle
    assert fmt == "srt"
    assert "00:00:01,000 --> 00:00:02,500" in content
    assert "Ted: Hi there" not in content

    assignments = store.load_character_assignments()
    assert not any(a.get("character_id") == "ted" for a in assignments)
