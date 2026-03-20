"""Opérations DB sur les segments (Phase 2)."""

from __future__ import annotations

import json
import sqlite3


def upsert_segments(
    conn: sqlite3.Connection,
    episode_id: str,
    kind: str,
    segments: list,
) -> None:
    """Insère ou met à jour les segments d'un épisode (sentence ou utterance)."""
    from howimetyourcorpus.core.segment import Segment

    # Transaction explicite pour éviter 1000 commits et garantir l'atomicité
    with conn:
        conn.execute(
            "DELETE FROM segments WHERE episode_id = ? AND kind = ?",
            (episode_id, kind),
        )
        for seg in segments:
            if not isinstance(seg, Segment):
                continue
            sid = f"{episode_id}:{seg.kind}:{seg.n}"
            meta_json = json.dumps(seg.meta) if seg.meta else None
            conn.execute(
                """
                INSERT INTO segments (segment_id, episode_id, kind, n, start_char, end_char, text, speaker_explicit, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sid,
                    episode_id,
                    seg.kind,
                    seg.n,
                    seg.start_char,
                    seg.end_char,
                    seg.text,
                    seg.speaker_explicit,
                    meta_json,
                ),
            )


def get_segments_for_episode(
    conn: sqlite3.Connection,
    episode_id: str,
    kind: str | None = None,
) -> list[dict]:
    """Retourne les segments d'un épisode. kind = 'sentence' | 'utterance' | None (tous)."""
    conn.row_factory = sqlite3.Row
    if kind:
        rows = conn.execute(
            "SELECT segment_id, episode_id, kind, n, start_char, end_char, text, speaker_explicit, meta_json FROM segments WHERE episode_id = ? AND kind = ? ORDER BY kind, n",
            (episode_id, kind),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT segment_id, episode_id, kind, n, start_char, end_char, text, speaker_explicit, meta_json FROM segments WHERE episode_id = ? ORDER BY kind, n",
            (episode_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def update_segment_speaker(
    conn: sqlite3.Connection,
    segment_id: str,
    speaker_explicit: str | None,
) -> None:
    """Met à jour le champ speaker_explicit d'un segment (propagation §8)."""
    conn.execute(
        "UPDATE segments SET speaker_explicit = ? WHERE segment_id = ?",
        (speaker_explicit, segment_id),
    )


def update_segment_text(
    conn: sqlite3.Connection,
    segment_id: str,
    text: str,
) -> None:
    """Met à jour le texte d'un segment (édition manuelle dans Préparer)."""
    conn.execute(
        "UPDATE segments SET text = ? WHERE segment_id = ?",
        (text, segment_id),
    )


def get_distinct_speaker_explicit(
    conn: sqlite3.Connection,
    episode_ids: list[str],
) -> list[str]:
    """Retourne la liste des noms de locuteurs (speaker_explicit) présents dans les segments des épisodes donnés, triés."""
    if not episode_ids:
        return []
    placeholders = ",".join("?" * len(episode_ids))
    rows = conn.execute(
        f"""SELECT DISTINCT speaker_explicit FROM segments
            WHERE episode_id IN ({placeholders}) AND speaker_explicit IS NOT NULL AND trim(speaker_explicit) != ''""",
        episode_ids,
    ).fetchall()
    return sorted({r[0].strip() for r in rows if r[0]})
