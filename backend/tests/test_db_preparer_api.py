"""Tests des APIs DB ajoutées pour l'onglet Préparer."""

from __future__ import annotations

from pathlib import Path

from howimetyourcorpus.core.models import EpisodeRef
from howimetyourcorpus.core.segment import Segment
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.subtitles import Cue


def _init_db(tmp_path: Path) -> CorpusDB:
    db_path = tmp_path / "corpus.db"
    db = CorpusDB(db_path)
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
    return db


def test_update_segment_text(tmp_path: Path) -> None:
    db = _init_db(tmp_path)
    segments = [
        Segment(episode_id="S01E01", kind="utterance", n=0, start_char=0, end_char=4, text="Hi.", speaker_explicit="TED")
    ]
    db.upsert_segments("S01E01", "utterance", segments)

    db.update_segment_text("S01E01:utterance:0", "Hello there.")

    rows = db.get_segments_for_episode("S01E01", kind="utterance")
    assert len(rows) == 1
    assert rows[0]["text"] == "Hello there."


def test_update_cue_timecodes(tmp_path: Path) -> None:
    db = _init_db(tmp_path)
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        track_id="S01E01:en",
        episode_id="S01E01",
        lang="en",
        cues=[
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=2000,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )

    db.update_cue_timecodes("S01E01:en:0", 1500, 2600)

    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert len(cues) == 1
    assert cues[0]["start_ms"] == 1500
    assert cues[0]["end_ms"] == 2600
