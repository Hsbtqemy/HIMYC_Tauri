"""Opérations DB sur les pistes et cues sous-titres (Phase 3)."""

from __future__ import annotations

import json
import sqlite3
from typing import Callable


def _normalize_cue_text(raw: str) -> str:
    """Normalisation minimaliste pour text_clean (fallback si Cue.text_clean vide)."""
    if not raw:
        return ""
    t = raw.replace("\n", " ").replace("\r", " ")
    return " ".join(t.split()).strip()


def add_track(
    conn: sqlite3.Connection,
    track_id: str,
    episode_id: str,
    lang: str,
    fmt: str,
    source_path: str | None = None,
    imported_at: str | None = None,
    meta_json: str | None = None,
) -> None:
    """Enregistre une piste sous-titres (ou met à jour si track_id existe). fmt = 'srt'|'vtt'."""
    conn.execute(
        """
        INSERT INTO subtitle_tracks (track_id, episode_id, lang, format, source_path, imported_at, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
          episode_id=excluded.episode_id, lang=excluded.lang, format=excluded.format,
          source_path=excluded.source_path, imported_at=excluded.imported_at, meta_json=excluded.meta_json
        """,
        (track_id, episode_id, lang, fmt, source_path, imported_at, meta_json),
    )


def upsert_cues(
    conn: sqlite3.Connection,
    track_id: str,
    episode_id: str,
    lang: str,
    cues: list,
    normalize_text: Callable[[str], str] = _normalize_cue_text,
) -> None:
    """Remplace les cues d'une piste (supprime anciennes, insère les nouvelles)."""
    from howimetyourcorpus.core.subtitles import Cue

    # Transaction explicite pour éviter 1000 commits et garantir l'atomicité
    with conn:
        conn.execute("DELETE FROM subtitle_cues WHERE track_id = ?", (track_id,))
        for c in cues:
            if not isinstance(c, Cue):
                continue
            cid = f"{episode_id}:{lang}:{c.n}" if episode_id and lang else f":{c.lang}:{c.n}"
            meta_json_str = json.dumps(c.meta) if c.meta else None
            text_clean = c.text_clean or normalize_text(c.text_raw)
            conn.execute(
                """
                INSERT INTO subtitle_cues (cue_id, track_id, episode_id, lang, n, start_ms, end_ms, text_raw, text_clean, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    cid,
                    track_id,
                    episode_id,
                    lang,
                    c.n,
                    c.start_ms,
                    c.end_ms,
                    c.text_raw,
                    text_clean,
                    meta_json_str,
                ),
            )


def update_cue_text_clean(conn: sqlite3.Connection, cue_id: str, text_clean: str) -> None:
    """Met à jour le champ text_clean d'une cue (propagation §8)."""
    conn.execute(
        "UPDATE subtitle_cues SET text_clean = ? WHERE cue_id = ?",
        (text_clean, cue_id),
    )


def update_cue_timecodes(
    conn: sqlite3.Connection,
    cue_id: str,
    start_ms: int,
    end_ms: int,
) -> None:
    """Met à jour les timecodes d'une cue."""
    conn.execute(
        "UPDATE subtitle_cues SET start_ms = ?, end_ms = ? WHERE cue_id = ?",
        (int(start_ms), int(end_ms), cue_id),
    )


def get_tracks_for_episode(conn: sqlite3.Connection, episode_id: str) -> list[dict]:
    """Retourne les pistes sous-titres d'un épisode avec nb_cues (pour l'UI)."""
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """SELECT t.track_id, t.episode_id, t.lang, t.format, t.source_path, t.imported_at,
                  COUNT(c.cue_id) AS nb_cues
           FROM subtitle_tracks t
           LEFT JOIN subtitle_cues c ON c.track_id = t.track_id
           WHERE t.episode_id = ?
           GROUP BY t.track_id
           ORDER BY t.lang""",
        (episode_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_tracks_for_episodes(conn: sqlite3.Connection, episode_ids: list[str]) -> dict[str, list[dict]]:
    """Retourne les pistes par épisode (episode_id -> liste de pistes avec nb_cues). Évite N requêtes au refresh Corpus / arbre."""
    if not episode_ids:
        return {}
    conn.row_factory = sqlite3.Row
    placeholders = ",".join("?" * len(episode_ids))
    rows = conn.execute(
        f"""SELECT t.track_id, t.episode_id, t.lang, t.format, t.source_path, t.imported_at,
                  COUNT(c.cue_id) AS nb_cues
           FROM subtitle_tracks t
           LEFT JOIN subtitle_cues c ON c.track_id = t.track_id
           WHERE t.episode_id IN ({placeholders})
           GROUP BY t.track_id
           ORDER BY t.episode_id, t.lang""",
        episode_ids,
    ).fetchall()
    result: dict[str, list[dict]] = {eid: [] for eid in episode_ids}
    for r in rows:
        d = dict(r)
        eid = d.get("episode_id", "")
        if eid in result:
            result[eid].append(d)
    return result


def delete_subtitle_track(conn: sqlite3.Connection, episode_id: str, lang: str) -> None:
    """Supprime une piste sous-titres (cues puis track). track_id = episode_id:lang."""
    track_id = f"{episode_id}:{lang}"
    # Transaction explicite pour garantir l'atomicité (cues puis track)
    with conn:
        conn.execute("DELETE FROM subtitle_cues WHERE track_id = ?", (track_id,))
        conn.execute("DELETE FROM subtitle_tracks WHERE track_id = ?", (track_id,))


def get_cues_for_episode_lang(
    conn: sqlite3.Connection,
    episode_id: str,
    lang: str,
) -> list[dict]:
    """Retourne les cues d'un épisode pour une langue (pour l'Inspecteur). meta = dict si meta_json présent."""
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """SELECT cue_id, track_id, episode_id, lang, n, start_ms, end_ms, text_raw, text_clean, meta_json
           FROM subtitle_cues WHERE episode_id = ? AND lang = ? ORDER BY n""",
        (episode_id, lang),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        meta_raw = d.pop("meta_json", None)
        d["meta"] = json.loads(meta_raw) if meta_raw and meta_raw.strip() else {}
        result.append(d)
    return result
