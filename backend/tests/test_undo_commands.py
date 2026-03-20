"""Tests de non-régression des commandes Undo/Redo UI."""

from __future__ import annotations

from pathlib import Path

from howimetyourcorpus.app.undo_commands import DeleteSubtitleTrackCommand
from howimetyourcorpus.core.models import ProjectConfig
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore
from howimetyourcorpus.core.subtitles import parse_subtitle_content


def _make_project(tmp_path: Path) -> tuple[ProjectStore, CorpusDB]:
    root = tmp_path / "project"
    config = ProjectConfig(
        project_name="test",
        root_dir=root,
        source_id="subslikescript",
        series_url="https://example.com",
    )
    ProjectStore.init_project(config)
    store = ProjectStore(root)
    db = CorpusDB(store.get_db_path())
    db.init()
    return store, db


def test_delete_subtitle_track_command_redo_undo_restores_db_files_and_alignment(tmp_path: Path) -> None:
    store, db = _make_project(tmp_path)
    episode_id = "S01E01"
    lang = "fr"
    track_id = f"{episode_id}:{lang}"
    srt = """1
00:00:01,000 --> 00:00:03,000
Bonjour !
"""

    cues, fmt = parse_subtitle_content(srt, "sample.srt")
    for cue in cues:
        cue.episode_id = episode_id
        cue.lang = lang

    store.save_episode_subtitles(
        episode_id,
        lang,
        srt,
        fmt,
        [
            {
                "cue_id": c.cue_id,
                "n": c.n,
                "start_ms": c.start_ms,
                "end_ms": c.end_ms,
                "text_raw": c.text_raw,
                "text_clean": c.text_clean,
            }
            for c in cues
        ],
    )
    db.add_track(
        track_id=track_id,
        episode_id=episode_id,
        lang=lang,
        fmt=fmt,
        source_path="sample.srt",
        imported_at="2026-01-01T00:00:00Z",
    )
    db.upsert_cues(track_id, episode_id, lang, cues)

    run_id = f"{episode_id}:align:test"
    db.create_align_run(run_id, episode_id, "en")
    db.upsert_align_links(
        run_id,
        episode_id,
        [
            {
                "link_id": f"{run_id}:0",
                "segment_id": f"{episode_id}:sentence:0",
                "cue_id": f"{episode_id}:en:0",
                "cue_id_target": f"{episode_id}:{lang}:0",
                "lang": lang,
                "role": "target",
                "confidence": 1.0,
                "status": "auto",
                "meta": {},
            }
        ],
    )

    assert store.has_episode_subs(episode_id, lang)
    assert len(db.get_tracks_for_episode(episode_id)) == 1
    assert len(db.get_cues_for_episode_lang(episode_id, lang)) == 1
    assert len(db.get_align_runs_for_episode(episode_id)) == 1
    assert len(db.query_alignment_for_episode(episode_id, run_id=run_id)) == 1

    cmd = DeleteSubtitleTrackCommand(db, store, episode_id, lang)
    cmd.redo()

    assert not store.has_episode_subs(episode_id, lang)
    assert db.get_tracks_for_episode(episode_id) == []
    assert db.get_cues_for_episode_lang(episode_id, lang) == []
    assert db.get_align_runs_for_episode(episode_id) == []
    assert db.query_alignment_for_episode(episode_id) == []

    cmd.undo()

    tracks = db.get_tracks_for_episode(episode_id)
    cues_restored = db.get_cues_for_episode_lang(episode_id, lang)
    runs_restored = db.get_align_runs_for_episode(episode_id)
    links_restored = db.query_alignment_for_episode(episode_id, run_id=run_id)

    assert store.has_episode_subs(episode_id, lang)
    assert len(tracks) == 1
    assert tracks[0]["format"] == "srt"
    assert len(cues_restored) == 1
    assert cues_restored[0]["cue_id"] == f"{episode_id}:{lang}:0"
    assert len(runs_restored) == 1
    assert runs_restored[0]["align_run_id"] == run_id
    assert len(links_restored) == 1
    assert links_restored[0]["cue_id_target"] == f"{episode_id}:{lang}:0"
