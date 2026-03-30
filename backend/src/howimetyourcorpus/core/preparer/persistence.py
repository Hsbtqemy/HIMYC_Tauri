"""Helpers de persistance pour snapshots Préparer (DB + fichiers)."""

from __future__ import annotations

import sqlite3
from typing import Any

from howimetyourcorpus.core.constants import CLEAN_TEXT_FILENAME


def capture_clean_storage_state(store: Any, episode_id: str) -> dict[str, Any]:
    """Capture l'état disque de clean.txt et transform_meta.json."""
    ep_dir = store._episode_dir(episode_id)  # noqa: SLF001 - sanitation centralisée côté store
    clean_path = ep_dir / CLEAN_TEXT_FILENAME
    meta_path = store.get_episode_transform_meta_path(episode_id)
    return {
        "clean_exists": clean_path.exists(),
        "clean_text": clean_path.read_text(encoding="utf-8") if clean_path.exists() else "",
        "meta_exists": meta_path.exists(),
        "meta_text": meta_path.read_text(encoding="utf-8") if meta_path.exists() else "",
    }


def apply_clean_storage_state(store: Any, episode_id: str, state: dict[str, Any]) -> None:
    """Restaure l'état disque de clean.txt et transform_meta.json."""
    ep_dir = store._episode_dir(episode_id)  # noqa: SLF001 - sanitation centralisée côté store
    ep_dir.mkdir(parents=True, exist_ok=True)
    clean_path = ep_dir / CLEAN_TEXT_FILENAME
    meta_path = store.get_episode_transform_meta_path(episode_id)

    if state.get("clean_exists"):
        clean_path.write_text(state.get("clean_text", ""), encoding="utf-8")
    elif clean_path.exists():
        clean_path.unlink()

    if state.get("meta_exists"):
        meta_path.write_text(state.get("meta_text", ""), encoding="utf-8")
    elif meta_path.exists():
        meta_path.unlink()


def capture_utterance_db_state(db: Any, episode_id: str) -> dict[str, Any]:
    """Capture segments utterance + runs/links d'alignement d'un épisode."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        seg_rows = conn.execute(
            """
            SELECT segment_id, episode_id, kind, n, start_char, end_char, text, speaker_explicit, meta_json
            FROM segments
            WHERE episode_id = ? AND kind = 'utterance'
            ORDER BY n
            """,
            (episode_id,),
        ).fetchall()
        segments = [dict(r) for r in seg_rows]

    runs = db.get_align_runs_for_episode(episode_id)
    links_by_run: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        run_id = run.get("align_run_id") or ""
        if run_id:
            links_by_run[run_id] = db.query_alignment_for_episode(episode_id, run_id=run_id)

    return {
        "segments": segments,
        "align_runs": runs,
        "align_links_by_run": links_by_run,
    }


def apply_utterance_db_state(db: Any, episode_id: str, state: dict[str, Any]) -> None:
    """Restaure segments utterance + runs/links d'alignement d'un épisode."""
    with db.transaction() as conn:
        conn.execute(
            "DELETE FROM segments WHERE episode_id = ? AND kind = 'utterance'",
            (episode_id,),
        )
        for seg in state.get("segments", []):
            conn.execute(
                """
                INSERT INTO segments
                  (segment_id, episode_id, kind, n, start_char, end_char, text, speaker_explicit, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    seg.get("segment_id"),
                    seg.get("episode_id"),
                    seg.get("kind"),
                    seg.get("n"),
                    seg.get("start_char"),
                    seg.get("end_char"),
                    seg.get("text"),
                    seg.get("speaker_explicit"),
                    seg.get("meta_json"),
                ),
            )

    db.delete_align_runs_for_episode(episode_id)
    links_by_run = state.get("align_links_by_run", {}) or {}
    for run in state.get("align_runs", []):
        run_id = run.get("align_run_id") or ""
        if not run_id:
            continue
        links_payload: list[dict[str, Any]] = [
            {
                "link_id": link.get("link_id"),
                "segment_id": link.get("segment_id"),
                "cue_id": link.get("cue_id"),
                "cue_id_target": link.get("cue_id_target"),
                "lang": link.get("lang"),
                "role": link.get("role"),
                "confidence": link.get("confidence"),
                "status": link.get("status"),
                "meta": link.get("meta") or {},
            }
            for link in links_by_run.get(run_id, [])
        ]
        db.create_align_run_and_links(
            run_id,
            episode_id,
            run.get("pivot_lang") or "en",
            run.get("params_json"),
            run.get("created_at"),
            run.get("summary_json"),
            links_payload,
        )


def capture_cue_storage_state(db: Any, store: Any | None, episode_id: str, lang: str) -> dict[str, Any]:
    """Capture cues DB + fichier sous-titres disque pour (épisode, langue)."""
    with db.connection() as conn:
        conn.row_factory = sqlite3.Row
        cue_rows = conn.execute(
            """
            SELECT cue_id, track_id, episode_id, lang, n, start_ms, end_ms, text_raw, text_clean, meta_json
            FROM subtitle_cues
            WHERE episode_id = ? AND lang = ?
            ORDER BY n
            """,
            (episode_id, lang),
        ).fetchall()
        cues = [dict(r) for r in cue_rows]

    subtitle_content = store.load_episode_subtitle_content(episode_id, lang) if store else None
    return {
        "cues": cues,
        "subtitle_content": subtitle_content,
    }


def apply_cue_storage_state(db: Any, store: Any, episode_id: str, lang: str, state: dict[str, Any]) -> None:
    """Restaure cues DB + fichier sous-titres disque pour (épisode, langue)."""
    with db.transaction() as conn:
        conn.execute(
            "DELETE FROM subtitle_cues WHERE episode_id = ? AND lang = ?",
            (episode_id, lang),
        )
        for cue in state.get("cues", []):
            conn.execute(
                """
                INSERT INTO subtitle_cues
                  (cue_id, track_id, episode_id, lang, n, start_ms, end_ms, text_raw, text_clean, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cue.get("cue_id"),
                    cue.get("track_id"),
                    cue.get("episode_id"),
                    cue.get("lang"),
                    cue.get("n"),
                    cue.get("start_ms"),
                    cue.get("end_ms"),
                    cue.get("text_raw"),
                    cue.get("text_clean"),
                    cue.get("meta_json"),
                ),
            )

    subtitle_content = state.get("subtitle_content")
    if subtitle_content:
        content, fmt = subtitle_content
        store.save_episode_subtitle_content(episode_id, lang, content, fmt)
    else:
        store.remove_episode_subtitle(episode_id, lang)
