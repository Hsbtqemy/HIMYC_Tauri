"""Tests d'intégrité alignement : pas de liens orphelins après suppression piste ou re-segmentation (§14)."""

from __future__ import annotations

import pytest
from pathlib import Path
import tempfile

from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.models import EpisodeRef
from howimetyourcorpus.core.segment import Segment
from howimetyourcorpus.core.subtitles import Cue


@pytest.fixture
def db_path():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d) / "corpus.db"


@pytest.fixture
def db(db_path):
    c = CorpusDB(db_path)
    c.init()
    return c


def test_delete_align_runs_for_episode_clears_runs_and_links(db):
    """delete_align_runs_for_episode supprime tous les runs et liens d'un épisode."""
    ref = EpisodeRef(episode_id="S01E01", season=1, episode=1, title="Pilot", url="https://ex.com/s01e01")
    db.upsert_episode(ref)
    run_id = "S01E01:align:run1"
    db.create_align_run(run_id, "S01E01", "en", None, None, "{}")
    db.upsert_align_links(run_id, "S01E01", [
        {"segment_id": "S01E01:sentence:0", "cue_id": "S01E01:en:0", "lang": "en", "role": "pivot", "confidence": 0.9, "status": "auto", "meta": {}},
    ])
    assert len(db.get_align_runs_for_episode("S01E01")) == 1
    assert len(db.query_alignment_for_episode("S01E01")) == 1

    db.delete_align_runs_for_episode("S01E01")

    assert db.get_align_runs_for_episode("S01E01") == []
    assert db.query_alignment_for_episode("S01E01") == []


def test_after_delete_subtitle_track_then_delete_align_runs_no_orphans(db):
    """Après suppression d'une piste SRT et nettoyage alignement, plus de runs/liens pour l'épisode."""
    ref = EpisodeRef(episode_id="S01E02", season=1, episode=2, title="Purple", url="https://ex.com/s01e02")
    db.upsert_episode(ref)
    db.add_track("S01E02:en", "S01E02", "en", "srt")
    cue = Cue(episode_id="S01E02", lang="en", n=0, start_ms=0, end_ms=2000, text_raw="Hi", text_clean="Hi")
    db.upsert_cues("S01E02:en", "S01E02", "en", [cue])
    run_id = "S01E02:align:run1"
    db.create_align_run(run_id, "S01E02", "en", None, None, "{}")
    db.upsert_align_links(run_id, "S01E02", [
        {"segment_id": "S01E02:sentence:0", "cue_id": "S01E02:en:0", "lang": "en", "role": "pivot", "confidence": 0.9, "status": "auto", "meta": {}},
    ])
    assert len(db.get_align_runs_for_episode("S01E02")) == 1

    db.delete_subtitle_track("S01E02", "en")
    db.delete_align_runs_for_episode("S01E02")

    assert db.get_align_runs_for_episode("S01E02") == []
    assert db.query_alignment_for_episode("S01E02") == []


def test_after_resegment_delete_align_runs_no_orphans(db):
    """Après re-segmentation (upsert segments + delete_align_runs_for_episode), plus de runs pour l'épisode."""
    ref = EpisodeRef(episode_id="S01E03", season=1, episode=3, title="Sweet", url="https://ex.com/s01e03")
    db.upsert_episode(ref)
    seg0 = Segment(episode_id="S01E03", kind="sentence", n=0, start_char=0, end_char=5, text="First")
    db.upsert_segments("S01E03", "sentence", [seg0])
    run_id = "S01E03:align:run1"
    db.create_align_run(run_id, "S01E03", "en", None, None, "{}")
    db.upsert_align_links(run_id, "S01E03", [
        {"segment_id": "S01E03:sentence:0", "cue_id": "S01E03:en:0", "lang": "en", "role": "pivot", "confidence": 0.9, "status": "auto", "meta": {}},
    ])
    assert len(db.get_align_runs_for_episode("S01E03")) == 1

    seg_new = Segment(episode_id="S01E03", kind="sentence", n=0, start_char=0, end_char=12, text="First second")
    db.upsert_segments("S01E03", "sentence", [seg_new])
    db.delete_align_runs_for_episode("S01E03")

    assert db.get_align_runs_for_episode("S01E03") == []
    assert db.query_alignment_for_episode("S01E03") == []


def test_batch_get_tracks_and_runs(db):
    """Phase 3 : get_tracks_for_episodes et get_align_runs_for_episodes retournent un dict par épisode."""
    ref1 = EpisodeRef(episode_id="S01E10", season=1, episode=10, title="A", url="https://ex.com/1")
    ref2 = EpisodeRef(episode_id="S01E11", season=1, episode=11, title="B", url="https://ex.com/2")
    db.upsert_episode(ref1)
    db.upsert_episode(ref2)
    db.add_track("S01E10:en", "S01E10", "en", "srt")
    db.create_align_run("S01E11:align:1", "S01E11", "en", None, None, "{}")
    episode_ids = ["S01E10", "S01E11", "S99E99"]
    tracks = db.get_tracks_for_episodes(episode_ids)
    runs = db.get_align_runs_for_episodes(episode_ids)
    assert set(tracks.keys()) == set(episode_ids)
    assert set(runs.keys()) == set(episode_ids)
    assert len(tracks["S01E10"]) == 1
    assert tracks["S01E11"] == []
    assert tracks["S99E99"] == []
    assert len(runs["S01E11"]) == 1
    assert runs["S01E10"] == []
    assert runs["S99E99"] == []
