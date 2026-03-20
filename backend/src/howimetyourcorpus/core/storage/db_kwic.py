"""Recherche KWIC (contexte gauche, match, contexte droit) sur documents, segments et cues."""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass

from howimetyourcorpus.core.constants import KWIC_CONTEXT_WINDOW, KWIC_ELLIPSIS


@dataclass
class KwicHit:
    """Un résultat KWIC (contexte gauche, match, contexte droit)."""

    episode_id: str
    title: str
    left: str
    match: str
    right: str
    position: int  # position approximative dans le document (caractère)
    score: float = 1.0
    segment_id: str | None = None  # Phase 2: hit au niveau segment
    kind: str | None = None  # "sentence" | "utterance"
    cue_id: str | None = None  # Phase 3: hit au niveau cue sous-titre
    lang: str | None = None  # Phase 3: langue de la cue
    speaker: str | None = None  # Phase 3: personnage / locuteur (segment speaker_explicit ou cue)


def fts5_match_query(term: str) -> str:
    """Échappe le terme pour FTS5 MATCH (phrase entre guillemets)."""
    escaped = term.replace('"', '""')
    return f'"{escaped}"'


def query_kwic(
    conn: sqlite3.Connection,
    term: str,
    season: int | None = None,
    episode: int | None = None,
    window: int = KWIC_CONTEXT_WINDOW,
    limit: int = 200,
    case_sensitive: bool = False,
) -> list[KwicHit]:
    """
    Recherche KWIC sur documents (FTS5). Construit (left, match, right) avec window caractères.
    """
    if not term or not term.strip():
        return []
    conn.row_factory = sqlite3.Row
    fts_query = fts5_match_query(term)
    if season is not None and episode is not None:
        rows = conn.execute(
            """
            SELECT d.episode_id, d.clean_text, e.title
            FROM documents_fts
            JOIN documents d ON d.rowid = documents_fts.rowid
            JOIN episodes e ON e.episode_id = d.episode_id
            WHERE documents_fts MATCH ? AND e.season = ? AND e.episode = ?
            """,
            (fts_query, season, episode),
        ).fetchall()
    elif season is not None:
        rows = conn.execute(
            """
            SELECT d.episode_id, d.clean_text, e.title
            FROM documents_fts
            JOIN documents d ON d.rowid = documents_fts.rowid
            JOIN episodes e ON e.episode_id = d.episode_id
            WHERE documents_fts MATCH ? AND e.season = ?
            """,
            (fts_query, season),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT d.episode_id, d.clean_text, e.title
            FROM documents_fts
            JOIN documents d ON d.rowid = documents_fts.rowid
            JOIN episodes e ON e.episode_id = d.episode_id
            WHERE documents_fts MATCH ?
            """,
            (fts_query,),
        ).fetchall()

    hits: list[KwicHit] = []
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(term), flags)
    for row in rows:
        episode_id = row["episode_id"]
        title = row["title"] or ""
        text = row["clean_text"] or ""
        for m in pattern.finditer(text):
            start, end = m.start(), m.end()
            left = text[max(0, start - window) : start]
            match = text[start:end]
            right = text[end : end + window]
            if len(left) < start - max(0, start - window):
                left = KWIC_ELLIPSIS + left
            if len(right) < min(window, len(text) - end):
                right = right + KWIC_ELLIPSIS
            hits.append(
                KwicHit(
                    episode_id=episode_id,
                    title=title,
                    left=left,
                    match=match,
                    right=right,
                    position=start,
                    score=1.0,
                )
            )
            if len(hits) >= limit:
                return hits
    return hits


def query_kwic_segments(
    conn: sqlite3.Connection,
    term: str,
    kind: str | None = None,
    season: int | None = None,
    episode: int | None = None,
    window: int = KWIC_CONTEXT_WINDOW,
    limit: int = 200,
    case_sensitive: bool = False,
) -> list[KwicHit]:
    """Recherche KWIC au niveau segments (FTS segments_fts). Retourne des KwicHit avec segment_id et kind."""
    if not term or not term.strip():
        return []
    conn.row_factory = sqlite3.Row
    fts_query = fts5_match_query(term)
    params: list = [fts_query]
    where_extra = ""
    if kind is not None:
        where_extra += " AND s.kind = ?"
        params.append(kind)
    if season is not None:
        where_extra += " AND e.season = ?"
        params.append(season)
    if episode is not None:
        where_extra += " AND e.episode = ?"
        params.append(episode)
    rows = conn.execute(
        f"""
        SELECT s.segment_id, s.episode_id, s.kind, s.text, s.speaker_explicit, e.title
        FROM segments_fts
        JOIN segments s ON s.rowid = segments_fts.rowid
        JOIN episodes e ON e.episode_id = s.episode_id
        WHERE segments_fts MATCH ?{where_extra}
        """,
        params,
    ).fetchall()

    hits: list[KwicHit] = []
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(term), flags)
    for row in rows:
        segment_id = row["segment_id"]
        episode_id = row["episode_id"]
        k = row["kind"]
        title = row["title"] or ""
        text = row["text"] or ""
        speaker = (row["speaker_explicit"] or "").strip() or None
        for m in pattern.finditer(text):
            start, end = m.start(), m.end()
            left = text[max(0, start - window) : start]
            match = text[start:end]
            right = text[end : end + window]
            if len(left) < start - max(0, start - window):
                left = KWIC_ELLIPSIS + left
            if len(right) < min(window, len(text) - end):
                right = right + KWIC_ELLIPSIS
            hits.append(
                KwicHit(
                    episode_id=episode_id,
                    title=title,
                    left=left,
                    match=match,
                    right=right,
                    position=start,
                    score=1.0,
                    segment_id=segment_id,
                    kind=k,
                    speaker=speaker,
                )
            )
            if len(hits) >= limit:
                return hits
    return hits


def query_kwic_cues(
    conn: sqlite3.Connection,
    term: str,
    lang: str | None = None,
    season: int | None = None,
    episode: int | None = None,
    window: int = KWIC_CONTEXT_WINDOW,
    limit: int = 200,
    case_sensitive: bool = False,
) -> list[KwicHit]:
    """Recherche KWIC sur les cues sous-titres (FTS cues_fts). Retourne des KwicHit avec cue_id et lang."""
    if not term or not term.strip():
        return []
    conn.row_factory = sqlite3.Row
    fts_query = fts5_match_query(term)
    params: list = [fts_query]
    where_extra = ""
    if lang:
        where_extra += " AND c.lang = ?"
        params.append(lang)
    if season is not None:
        where_extra += " AND e.season = ?"
        params.append(season)
    if episode is not None:
        where_extra += " AND e.episode = ?"
        params.append(episode)
    rows = conn.execute(
        f"""
        SELECT c.cue_id, c.episode_id, c.lang, c.text_clean, e.title
        FROM cues_fts
        JOIN subtitle_cues c ON c.rowid = cues_fts.rowid
        JOIN episodes e ON e.episode_id = c.episode_id
        WHERE cues_fts MATCH ?{where_extra}
        """,
        params,
    ).fetchall()

    hits: list[KwicHit] = []
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(term), flags)
    for row in rows:
        cue_id = row["cue_id"]
        episode_id = row["episode_id"]
        lang_val = row["lang"]
        title = row["title"] or ""
        text = row["text_clean"] or ""
        speaker = None
        speaker_match = re.match(r"^([^:]+):\s*", text.strip())
        if speaker_match:
            speaker = speaker_match.group(1).strip() or None
        for m in pattern.finditer(text):
            start, end = m.start(), m.end()
            left = text[max(0, start - window) : start]
            match = text[start:end]
            right = text[end : end + window]
            if len(left) < start - max(0, start - window):
                left = KWIC_ELLIPSIS + left
            if len(right) < min(window, len(text) - end):
                right = right + KWIC_ELLIPSIS
            hits.append(
                KwicHit(
                    episode_id=episode_id,
                    title=title,
                    left=left,
                    match=match,
                    right=right,
                    position=start,
                    score=1.0,
                    cue_id=cue_id,
                    lang=lang_val,
                    speaker=speaker,
                )
            )
            if len(hits) >= limit:
                return hits
    return hits
