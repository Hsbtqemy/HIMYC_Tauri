"""Tests de non-régression pour la propagation des personnages (§8)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from howimetyourcorpus.core.models import ProjectConfig
from howimetyourcorpus.core.storage.project_store import ProjectStore


class _FakePropagationDB:
    def __init__(
        self,
        *,
        run: dict[str, Any],
        links: list[dict[str, Any]],
        cues_by_lang: dict[str, list[dict[str, Any]]],
    ) -> None:
        self._run = run
        self._links = links
        self._cues_by_lang = cues_by_lang
        self.get_cues_calls: dict[str, int] = {}
        self.updated_segments: list[tuple[str, str]] = []
        self.updated_cues: list[tuple[str, str]] = []

    def query_alignment_for_episode(self, episode_id: str, run_id: str | None = None) -> list[dict[str, Any]]:  # noqa: ARG002
        return list(self._links)

    def get_align_run(self, run_id: str) -> dict[str, Any] | None:  # noqa: ARG002
        return dict(self._run)

    def update_segment_speaker(self, segment_id: str, speaker_explicit: str | None) -> None:
        self.updated_segments.append((segment_id, speaker_explicit or ""))

    def get_cues_for_episode_lang(self, episode_id: str, lang: str) -> list[dict[str, Any]]:  # noqa: ARG002
        key = (lang or "").strip().lower()
        self.get_cues_calls[key] = self.get_cues_calls.get(key, 0) + 1
        return self._cues_by_lang.get(key, [])

    def update_cue_text_clean(self, cue_id: str, text_clean: str) -> None:
        self.updated_cues.append((cue_id, text_clean))
        for cues in self._cues_by_lang.values():
            for cue in cues:
                if cue.get("cue_id") == cue_id:
                    cue["text_clean"] = text_clean
                    return


def _init_store(tmp_path: Path) -> ProjectStore:
    root = tmp_path / "project"
    ProjectStore.init_project(
        ProjectConfig(
            project_name="propagation",
            root_dir=root,
            source_id="subslikescript",
            series_url="https://example.invalid/series",
        )
    )
    return ProjectStore(root)


def test_propagation_rewrites_only_selected_languages_and_caches_cues(tmp_path: Path) -> None:
    store = _init_store(tmp_path)
    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "Ted",
                "names_by_lang": {"en": "Ted", "fr": "Ted FR"},
            }
        ]
    )
    store.save_character_assignments(
        [
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:sentence:0",
                "character_id": "ted",
            },
            {
                "episode_id": "S01E01",
                "source_type": "cue",
                "source_id": "S01E01:en:1",
                "character_id": "ted",
            },
        ]
    )

    db = _FakePropagationDB(
        run={"align_run_id": "run1", "pivot_lang": "en"},
        links=[
            {
                "role": "pivot",
                "segment_id": "S01E01:sentence:0",
                "cue_id": "S01E01:en:0",
            },
            {
                "role": "pivot",
                "segment_id": "S01E01:sentence:1",
                "cue_id": "S01E01:en:1",
            },
            {
                "role": "target",
                "cue_id": "S01E01:en:0",
                "cue_id_target": "S01E01:fr:0",
                "lang": "fr",
            },
            {
                "role": "target",
                "cue_id": "S01E01:en:1",
                "cue_id_target": "S01E01:fr:1",
                "lang": "fr",
            },
        ],
        cues_by_lang={
            "en": [
                {"cue_id": "S01E01:en:0", "n": 0, "start_ms": 0, "end_ms": 900, "text_clean": "Hello", "text_raw": "Hello"},
                {"cue_id": "S01E01:en:1", "n": 1, "start_ms": 1000, "end_ms": 1900, "text_clean": "How are you", "text_raw": "How are you"},
            ],
            "fr": [
                {"cue_id": "S01E01:fr:0", "n": 0, "start_ms": 0, "end_ms": 900, "text_clean": "Bonjour", "text_raw": "Bonjour"},
                {"cue_id": "S01E01:fr:1", "n": 1, "start_ms": 1000, "end_ms": 1900, "text_clean": "Comment ca va", "text_raw": "Comment ca va"},
            ],
        },
    )

    nb_seg, nb_cue = store.propagate_character_names(
        db,
        "S01E01",
        "run1",
        languages_to_rewrite={"fr"},
    )

    assert nb_seg == 1
    assert nb_cue == 4
    assert ("S01E01:sentence:0", "ted") in db.updated_segments
    assert db.get_cues_calls == {"en": 1, "fr": 1}

    fr_saved = store.load_episode_subtitle_content("S01E01", "fr")
    assert fr_saved is not None
    assert "Ted FR: Bonjour" in fr_saved[0]
    assert "Ted FR: Comment ca va" in fr_saved[0]

    en_saved = store.load_episode_subtitle_content("S01E01", "en")
    assert en_saved is None


def test_propagation_rewrites_all_updated_languages_by_default(tmp_path: Path) -> None:
    store = _init_store(tmp_path)
    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "Ted",
                "names_by_lang": {"en": "Ted", "fr": "Ted FR"},
            }
        ]
    )
    store.save_character_assignments(
        [
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:sentence:0",
                "character_id": "ted",
            }
        ]
    )

    db = _FakePropagationDB(
        run={"align_run_id": "run1", "pivot_lang": "en"},
        links=[
            {
                "role": "pivot",
                "segment_id": "S01E01:sentence:0",
                "cue_id": "S01E01:en:0",
            },
            {
                "role": "target",
                "cue_id": "S01E01:en:0",
                "cue_id_target": "S01E01:fr:0",
                "lang": "fr",
            },
        ],
        cues_by_lang={
            "en": [
                {"cue_id": "S01E01:en:0", "n": 0, "start_ms": 0, "end_ms": 900, "text_clean": "Hello", "text_raw": "Hello"},
            ],
            "fr": [
                {"cue_id": "S01E01:fr:0", "n": 0, "start_ms": 0, "end_ms": 900, "text_clean": "Bonjour", "text_raw": "Bonjour"},
            ],
        },
    )

    nb_seg, nb_cue = store.propagate_character_names(db, "S01E01", "run1")

    assert nb_seg == 1
    assert nb_cue == 2
    assert db.get_cues_calls == {"en": 1, "fr": 1}
    assert store.load_episode_subtitle_content("S01E01", "en") is not None
    assert store.load_episode_subtitle_content("S01E01", "fr") is not None
