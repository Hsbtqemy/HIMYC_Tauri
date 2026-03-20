"""Tests de robustesse stockage: JSON corrompu et sanitation des chemins épisode."""

from __future__ import annotations

from pathlib import Path

from howimetyourcorpus.core.pipeline.tasks import SegmentEpisodeStep
from howimetyourcorpus.core.preparer.persistence import (
    apply_clean_storage_state,
    capture_clean_storage_state,
)
from howimetyourcorpus.core.storage.project_store import ProjectStore


def test_load_series_index_invalid_json_returns_none(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    (tmp_path / "series_index.json").write_text("{not-json", encoding="utf-8")
    assert store.load_series_index() is None


def test_load_episode_transform_meta_invalid_json_returns_none(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    ep_dir = store._episode_dir("S01E01")
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / "transform_meta.json").write_text("{not-json", encoding="utf-8")
    assert store.load_episode_transform_meta("S01E01") is None


def test_preparer_clean_state_uses_sanitized_episode_dir(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    episode_id = "../evil"
    safe_dir = store._episode_dir(episode_id)
    safe_dir.mkdir(parents=True, exist_ok=True)
    (safe_dir / "clean.txt").write_text("SAFE", encoding="utf-8")
    (safe_dir / "transform_meta.json").write_text('{"ok": true}', encoding="utf-8")

    unsafe_dir = tmp_path / "evil"
    unsafe_dir.mkdir(parents=True, exist_ok=True)
    (unsafe_dir / "clean.txt").write_text("UNSAFE", encoding="utf-8")
    (unsafe_dir / "transform_meta.json").write_text('{"ok": false}', encoding="utf-8")

    state = capture_clean_storage_state(store, episode_id)
    assert state["clean_text"] == "SAFE"
    assert state["meta_text"] == '{"ok": true}'

    apply_clean_storage_state(
        store,
        episode_id,
        {
            "clean_exists": True,
            "clean_text": "SAFE-UPDATED",
            "meta_exists": True,
            "meta_text": '{"ok": "updated"}',
        },
    )
    assert (safe_dir / "clean.txt").read_text(encoding="utf-8") == "SAFE-UPDATED"
    assert (unsafe_dir / "clean.txt").read_text(encoding="utf-8") == "UNSAFE"


def test_segment_episode_writes_to_sanitized_episode_dir(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    episode_id = "../evil"
    safe_dir = store._episode_dir(episode_id)
    safe_dir.mkdir(parents=True, exist_ok=True)
    (safe_dir / "clean.txt").write_text("Ted: Hello.\nBarney: Legendary!", encoding="utf-8")

    step = SegmentEpisodeStep(episode_id, lang_hint="en")
    result = step.run({"store": store, "db": None})
    assert result.success is True
    assert (safe_dir / "segments.jsonl").exists()
    assert not (tmp_path / "evil" / "segments.jsonl").exists()
