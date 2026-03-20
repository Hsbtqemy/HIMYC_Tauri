"""Tests du regroupement multi-langues basé sur les runs d'alignement."""

from __future__ import annotations

import json
from pathlib import Path

from howimetyourcorpus.core.models import EpisodeRef, ProjectConfig
from howimetyourcorpus.core.segment import Segment
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore
from howimetyourcorpus.core.subtitles import Cue


def _init_project(tmp_path: Path) -> tuple[ProjectStore, CorpusDB]:
    root = tmp_path / "project"
    config = ProjectConfig(
        project_name="align_grouping_test",
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


def test_generate_align_grouping_non_destructive_and_assignment_aware(tmp_path: Path) -> None:
    store, db = _init_project(tmp_path)
    episode_id = "S01E01"
    run_id = "S01E01:align:GROUPS"

    db.upsert_segments(
        episode_id,
        "utterance",
        [
            Segment(episode_id=episode_id, kind="utterance", n=0, start_char=0, end_char=1, text="A"),
            Segment(episode_id=episode_id, kind="utterance", n=1, start_char=2, end_char=3, text="B"),
            Segment(episode_id=episode_id, kind="utterance", n=2, start_char=4, end_char=5, text="C"),
        ],
    )
    db.add_track(f"{episode_id}:en", episode_id, "en", "srt")
    db.add_track(f"{episode_id}:fr", episode_id, "fr", "srt")
    db.upsert_cues(
        f"{episode_id}:en",
        episode_id,
        "en",
        [
            Cue(episode_id=episode_id, lang="en", n=0, start_ms=1000, end_ms=1500, text_raw="Hi", text_clean="Hi"),
            Cue(
                episode_id=episode_id,
                lang="en",
                n=1,
                start_ms=1600,
                end_ms=2100,
                text_raw="There",
                text_clean="There",
            ),
            Cue(episode_id=episode_id, lang="en", n=2, start_ms=2200, end_ms=2600, text_raw="Bye", text_clean="Bye"),
        ],
    )
    db.upsert_cues(
        f"{episode_id}:fr",
        episode_id,
        "fr",
        [
            Cue(
                episode_id=episode_id,
                lang="fr",
                n=0,
                start_ms=1000,
                end_ms=1500,
                text_raw="Salut",
                text_clean="Salut",
            ),
            Cue(episode_id=episode_id, lang="fr", n=1, start_ms=1600, end_ms=2100, text_raw="Là", text_clean="Là"),
            Cue(
                episode_id=episode_id,
                lang="fr",
                n=2,
                start_ms=2200,
                end_ms=2600,
                text_raw="Au revoir",
                text_clean="Au revoir",
            ),
            Cue(
                episode_id=episode_id,
                lang="fr",
                n=3,
                start_ms=2700,
                end_ms=3000,
                text_raw="Extra",
                text_clean="Extra",
            ),
        ],
    )

    db.create_align_run(
        run_id,
        episode_id,
        "en",
        params_json=json.dumps({"segment_kind": "utterance"}),
    )
    db.upsert_align_links(
        run_id,
        episode_id,
        [
            {
                "segment_id": f"{episode_id}:utterance:0",
                "cue_id": f"{episode_id}:en:0",
                "lang": "en",
                "role": "pivot",
                "confidence": 0.9,
                "status": "auto",
            },
            {
                "segment_id": f"{episode_id}:utterance:1",
                "cue_id": f"{episode_id}:en:1",
                "lang": "en",
                "role": "pivot",
                "confidence": 0.8,
                "status": "auto",
            },
            {
                "segment_id": f"{episode_id}:utterance:2",
                "cue_id": f"{episode_id}:en:2",
                "lang": "en",
                "role": "pivot",
                "confidence": 0.7,
                "status": "auto",
            },
            {
                "cue_id": f"{episode_id}:en:0",
                "cue_id_target": f"{episode_id}:fr:0",
                "lang": "fr",
                "role": "target",
                "confidence": 0.95,
                "status": "auto",
            },
            {
                "cue_id": f"{episode_id}:en:1",
                "cue_id_target": f"{episode_id}:fr:1",
                "lang": "fr",
                "role": "target",
                "confidence": 0.85,
                "status": "auto",
            },
            {
                "cue_id": f"{episode_id}:en:2",
                "cue_id_target": f"{episode_id}:fr:2",
                "lang": "fr",
                "role": "target",
                "confidence": 0.75,
                "status": "auto",
            },
        ],
    )

    store.save_character_names(
        [
            {"id": "ted", "canonical": "TED", "names_by_lang": {"en": "Ted", "fr": "Ted"}},
            {"id": "robin", "canonical": "ROBIN", "names_by_lang": {"en": "Robin", "fr": "Robin"}},
        ]
    )
    assignments_before = [
        {
            "episode_id": episode_id,
            "source_type": "segment",
            "source_id": f"{episode_id}:utterance:0",
            "character_id": "ted",
        },
        {
            "episode_id": episode_id,
            "source_type": "segment",
            "source_id": f"{episode_id}:utterance:1",
            "character_id": "ted",
        },
        {
            "episode_id": episode_id,
            "source_type": "segment",
            "source_id": f"{episode_id}:utterance:2",
            "character_id": "robin",
        },
    ]
    store.save_character_assignments(assignments_before)

    segs_before = db.get_segments_for_episode(episode_id, kind="utterance")
    cues_before = db.get_cues_for_episode_lang(episode_id, "fr")

    grouping = store.generate_align_grouping(db, episode_id, run_id, tolerant=True)
    groups = grouping.get("groups") or []
    assert len(groups) == 2
    assert groups[0]["character_id"] == "ted"
    assert groups[0]["text_segment"] == "A\nB"
    assert groups[0]["texts_by_lang"]["en"] == "Hi\nThere"
    assert groups[0]["texts_by_lang"]["fr"] == "Salut\nLà"
    assert groups[1]["character_id"] == "robin"
    assert groups[1]["text_segment"] == "C"

    # Non destructif : aucune source modifiée.
    assert db.get_segments_for_episode(episode_id, kind="utterance") == segs_before
    assert db.get_cues_for_episode_lang(episode_id, "fr") == cues_before
    assert store.load_character_assignments() == assignments_before

    saved = store.load_align_grouping(episode_id, run_id)
    assert saved is not None
    assert len(saved.get("groups") or []) == 2

    rows = store.align_grouping_to_parallel_rows(grouping)
    assert len(rows) == 2
    assert rows[0]["text_en"] == "Hi\nThere"
    assert rows[0]["text_fr"] == "Salut\nLà"
    assert rows[1]["text_en"] == "Bye"
    assert rows[1]["text_fr"] == "Au revoir"

