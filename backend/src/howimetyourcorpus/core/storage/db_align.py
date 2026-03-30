"""Opérations DB sur l'alignement (Phase 4) et concordancier parallèle (Phase 5)."""

from __future__ import annotations

import datetime
import json
import logging
import sqlite3

from howimetyourcorpus.core.align import parse_run_segment_kind
from howimetyourcorpus.core.constants import DEFAULT_PIVOT_LANG, SQLITE_BULK_CHUNK_SIZE, SUPPORTED_LANGUAGES
from howimetyourcorpus.core.storage import db_segments
from howimetyourcorpus.core.storage import db_subtitles

logger = logging.getLogger(__name__)


def _escape_like(s: str) -> str:
    """Échappe les métacaractères SQLite LIKE (%, _, \\) pour une recherche littérale."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def create_align_run(
    conn: sqlite3.Connection,
    align_run_id: str,
    episode_id: str,
    pivot_lang: str,
    params_json: str | None = None,
    created_at: str | None = None,
    summary_json: str | None = None,
) -> None:
    """Crée une entrée de run d'alignement."""
    if not created_at:
        created_at = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
    conn.execute(
        """
        INSERT INTO align_runs (align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json),
    )


def upsert_align_links(
    conn: sqlite3.Connection,
    align_run_id: str,
    episode_id: str,
    links: list[dict],
) -> None:
    """Remplace les liens d'un run (DELETE puis INSERT). Chaque link: segment_id?, cue_id?, cue_id_target?, lang?, role, confidence, status, meta_json?."""
    # Transaction explicite pour éviter 1000 commits et garantir l'atomicité
    with conn:
        conn.execute("DELETE FROM align_links WHERE align_run_id = ?", (align_run_id,))
        for i, link in enumerate(links):
            link_id = link.get("link_id") or f"{align_run_id}:{i}"
            segment_id = link.get("segment_id")
            cue_id = link.get("cue_id")
            cue_id_target = link.get("cue_id_target")
            lang = link.get("lang") or ""
            role = link.get("role", "pivot")
            confidence = link.get("confidence")
            status = link.get("status", "auto")
            meta_json = json.dumps(link["meta"]) if link.get("meta") else None
            conn.execute(
                """
                INSERT INTO align_links (link_id, align_run_id, episode_id, segment_id, cue_id, cue_id_target, lang, role, confidence, status, meta_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (link_id, align_run_id, episode_id, segment_id, cue_id, cue_id_target, lang, role, confidence, status, meta_json),
            )


def set_align_status(conn: sqlite3.Connection, link_id: str, status: str) -> None:
    """Met à jour le statut d'un lien (accepted / rejected / ignored)."""
    conn.execute("UPDATE align_links SET status = ? WHERE link_id = ?", (status, link_id))


def set_align_note(conn: sqlite3.Connection, link_id: str, note: str | None) -> None:
    """Enregistre une note libre dans meta_json (G-008 / MX-049).
    Lit le meta_json existant, fusionne la note, réécrit.
    Si note est None ou vide, supprime la clé 'note' du meta.
    """
    row = conn.execute(
        "SELECT meta_json FROM align_links WHERE link_id = ?", (link_id,)
    ).fetchone()
    if row is None:
        return
    try:
        meta: dict = json.loads(row[0]) if row[0] else {}
    except (TypeError, ValueError):
        meta = {}
    if note:
        meta["note"] = note
    else:
        meta.pop("note", None)
    new_meta = json.dumps(meta, ensure_ascii=False) if meta else None
    conn.execute(
        "UPDATE align_links SET meta_json = ? WHERE link_id = ?", (new_meta, link_id)
    )


def bulk_set_align_status(
    conn: sqlite3.Connection,
    align_run_id: str,
    episode_id: str,
    new_status: str,
    *,
    link_ids: list[str] | None = None,
    filter_status: str | None = None,
    conf_lt: float | None = None,
) -> int:
    """Mise à jour groupée des statuts de liens (MX-039).

    Deux modes :
    - ``link_ids`` non-None : met à jour la liste explicite d'IDs (chunké par 500 pour SQLite).
    - Sinon         : met à jour tous les liens du run correspondant aux filtres optionnels
      ``filter_status`` (statut courant) et ``conf_lt`` (confidence strictement inférieure).

    Retourne le nombre de lignes effectivement modifiées.
    """
    if link_ids is not None:
        if not link_ids:
            return 0
        total_updated = 0
        # SQLite SQLITE_LIMIT_VARIABLE_NUMBER ≈ 999 — on chunk par SQLITE_BULK_CHUNK_SIZE pour la marge
        for i in range(0, len(link_ids), SQLITE_BULK_CHUNK_SIZE):
            chunk = link_ids[i : i + SQLITE_BULK_CHUNK_SIZE]
            placeholders = ",".join("?" * len(chunk))
            cur = conn.execute(
                f"UPDATE align_links SET status = ? WHERE link_id IN ({placeholders})",
                [new_status, *chunk],
            )
            total_updated += cur.rowcount
        return total_updated

    # Filter-based update (tous les liens du run correspondant aux critères)
    where_parts = ["align_run_id = ?", "episode_id = ?"]
    params: list = [align_run_id, episode_id]

    if filter_status is not None:
        where_parts.append("status = ?")
        params.append(filter_status)

    if conf_lt is not None:
        where_parts.append("(confidence IS NOT NULL AND confidence < ?)")
        params.append(conf_lt)

    where = " AND ".join(where_parts)
    cur = conn.execute(
        f"UPDATE align_links SET status = ? WHERE {where}",
        [new_status, *params],
    )
    return cur.rowcount


def update_align_link_cues(
    conn: sqlite3.Connection,
    link_id: str,
    cue_id: str | None = None,
    cue_id_target: str | None = None,
) -> None:
    """Modifie la cible d'un lien (réplique EN et/ou réplique cible). Met le statut à 'accepted' (correction manuelle)."""
    if cue_id is None and cue_id_target is None:
        return
    if cue_id is not None and cue_id_target is not None:
        conn.execute(
            "UPDATE align_links SET cue_id = ?, cue_id_target = ?, status = ? WHERE link_id = ?",
            (cue_id, cue_id_target, "accepted", link_id),
        )
    elif cue_id is not None:
        conn.execute("UPDATE align_links SET cue_id = ?, status = ? WHERE link_id = ?", (cue_id, "accepted", link_id))
    else:
        conn.execute("UPDATE align_links SET cue_id_target = ?, status = ? WHERE link_id = ?", (cue_id_target, "accepted", link_id))


def search_subtitle_cues(
    conn: sqlite3.Connection,
    episode_id: str,
    lang: str,
    *,
    q: str | None = None,
    around_cue_id: str | None = None,
    around_window: int = 10,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Recherche des cues SRT pour une langue/épisode (MX-040).

    Modes :
    - ``around_cue_id`` : retourne les ``around_window`` cues avant et après ce cue (même episode/lang,
      triés par n).  Ignoré si ``q`` est fourni.
    - ``q`` : recherche FTS5 dans ``cues_fts``.  Prioritaire sur ``around_cue_id``.
    - Sans aucun filtre : retourne les cues dans l'ordre (n ASC) avec pagination.

    Retourne ``(rows, total)`` où ``rows`` est une liste de dicts avec :
    ``cue_id, episode_id, lang, n, start_ms, end_ms, text_clean``.
    """
    conn.row_factory = sqlite3.Row

    if q:
        # Mode FTS : on recherche dans cues_fts puis on joint pour récupérer les champs
        # On échappe les caractères spéciaux FTS5 pour éviter les erreurs de syntaxe.
        safe_q = q.replace('"', '""').strip()
        fts_query = f'"{safe_q}"' if safe_q else safe_q

        count_row = conn.execute(
            """SELECT COUNT(*) AS cnt
               FROM cues_fts
               WHERE cues_fts MATCH ? AND episode_id = ? AND lang = ?""",
            (fts_query, episode_id, lang),
        ).fetchone()
        total = (count_row["cnt"] if count_row else 0)

        rows = conn.execute(
            """SELECT sc.cue_id, sc.episode_id, sc.lang, sc.n,
                      sc.start_ms, sc.end_ms, sc.text_clean
               FROM cues_fts cf
               JOIN subtitle_cues sc ON cf.cue_id = sc.cue_id
               WHERE cf.cues_fts MATCH ? AND cf.episode_id = ? AND cf.lang = ?
               ORDER BY sc.n
               LIMIT ? OFFSET ?""",
            (fts_query, episode_id, lang, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows], total

    if around_cue_id:
        # Mode neighbourhood : on récupère le n du cue de référence, puis ±window
        ref = conn.execute(
            "SELECT n FROM subtitle_cues WHERE cue_id = ? AND episode_id = ? AND lang = ?",
            (around_cue_id, episode_id, lang),
        ).fetchone()
        if ref is None:
            return [], 0
        n_ref = ref["n"]
        n_min = n_ref - around_window
        n_max = n_ref + around_window

        count_row = conn.execute(
            """SELECT COUNT(*) AS cnt FROM subtitle_cues
               WHERE episode_id = ? AND lang = ? AND n BETWEEN ? AND ?""",
            (episode_id, lang, n_min, n_max),
        ).fetchone()
        total = (count_row["cnt"] if count_row else 0)

        rows = conn.execute(
            """SELECT cue_id, episode_id, lang, n, start_ms, end_ms, text_clean
               FROM subtitle_cues
               WHERE episode_id = ? AND lang = ? AND n BETWEEN ? AND ?
               ORDER BY n
               LIMIT ? OFFSET ?""",
            (episode_id, lang, n_min, n_max, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows], total

    # Mode liste simple : tous les cues triés par n
    count_row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM subtitle_cues WHERE episode_id = ? AND lang = ?",
        (episode_id, lang),
    ).fetchone()
    total = (count_row["cnt"] if count_row else 0)

    rows = conn.execute(
        """SELECT cue_id, episode_id, lang, n, start_ms, end_ms, text_clean
           FROM subtitle_cues
           WHERE episode_id = ? AND lang = ?
           ORDER BY n
           LIMIT ? OFFSET ?""",
        (episode_id, lang, limit, offset),
    ).fetchall()
    return [dict(r) for r in rows], total


def get_align_runs_for_episode(conn: sqlite3.Connection, episode_id: str) -> list[dict]:
    """Retourne les runs d'alignement d'un épisode (pour l'UI)."""
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json FROM align_runs WHERE episode_id = ? ORDER BY created_at DESC",
        (episode_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_align_run(conn: sqlite3.Connection, run_id: str) -> dict | None:
    """Retourne un run d'alignement par son id (pour connaître pivot_lang)."""
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json FROM align_runs WHERE align_run_id = ?",
        (run_id,),
    ).fetchone()
    return dict(row) if row else None


def get_align_runs_for_episodes(conn: sqlite3.Connection, episode_ids: list[str]) -> dict[str, list[dict]]:
    """Retourne les runs d'alignement par épisode (episode_id -> liste de runs). Évite N requêtes au refresh Corpus / arbre."""
    if not episode_ids:
        return {}
    conn.row_factory = sqlite3.Row
    placeholders = ",".join("?" * len(episode_ids))
    rows = conn.execute(
        f"""SELECT align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json
           FROM align_runs WHERE episode_id IN ({placeholders}) ORDER BY episode_id, created_at DESC""",
        episode_ids,
    ).fetchall()
    result: dict[str, list[dict]] = {eid: [] for eid in episode_ids}
    for r in rows:
        d = dict(r)
        eid = d.get("episode_id", "")
        if eid in result:
            result[eid].append(d)
    return result


def delete_align_run(conn: sqlite3.Connection, align_run_id: str) -> None:
    """Supprime un run d'alignement et tous ses liens."""
    # Transaction explicite pour garantir l'atomicité (liens puis run)
    with conn:
        conn.execute("DELETE FROM align_links WHERE align_run_id = ?", (align_run_id,))
        conn.execute("DELETE FROM align_runs WHERE align_run_id = ?", (align_run_id,))


def delete_align_runs_for_episode(conn: sqlite3.Connection, episode_id: str) -> None:
    """Supprime tous les runs d'alignement d'un épisode (et leurs liens). À appeler après suppression d'une piste SRT ou re-segmentation pour éviter les liens orphelins."""
    # Transaction explicite pour garantir l'atomicité (liens puis runs)
    with conn:
        conn.execute("DELETE FROM align_links WHERE episode_id = ?", (episode_id,))
        conn.execute("DELETE FROM align_runs WHERE episode_id = ?", (episode_id,))


def query_alignment_for_episode(
    conn: sqlite3.Connection,
    episode_id: str,
    run_id: str | None = None,
    status_filter: str | None = None,
    min_confidence: float | None = None,
) -> list[dict]:
    """Retourne les liens d'alignement pour un épisode (optionnel: run_id, filtre status, min confidence)."""
    conn.row_factory = sqlite3.Row
    where = "WHERE episode_id = ?"
    params: list = [episode_id]
    if run_id:
        where += " AND align_run_id = ?"
        params.append(run_id)
    if status_filter:
        where += " AND status = ?"
        params.append(status_filter)
    if min_confidence is not None:
        where += " AND confidence >= ?"
        params.append(min_confidence)
    rows = conn.execute(
        f"""SELECT link_id, align_run_id, episode_id, segment_id, cue_id, cue_id_target, lang, role, confidence, status, meta_json
            FROM align_links {where} ORDER BY segment_id, cue_id, lang""",
        params,
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        meta_raw = d.pop("meta_json", None)
        d["meta"] = json.loads(meta_raw) if meta_raw and meta_raw.strip() else {}
        result.append(d)
    return result


def get_align_stats_for_run(
    conn: sqlite3.Connection,
    episode_id: str,
    run_id: str,
    status_filter: str | None = None,
) -> dict:
    """
    Statistiques d'alignement pour un run : nb_links, nb_pivot, nb_target,
    by_status (auto/accepted/rejected), avg_confidence.
    """
    conn.row_factory = sqlite3.Row
    where = "WHERE episode_id = ? AND align_run_id = ?"
    params: list = [episode_id, run_id]
    if status_filter:
        where += " AND status = ?"
        params.append(status_filter)
    rows = conn.execute(
        f"""SELECT role, status, confidence, COUNT(*) AS cnt
           FROM align_links {where}
           GROUP BY role, status""",
        params,
    ).fetchall()
    nb_links = 0
    nb_pivot = 0
    nb_target = 0
    by_status: dict[str, int] = {}
    conf_sum = 0.0
    conf_count = 0
    for r in rows:
        cnt = r["cnt"]
        nb_links += cnt
        if r["role"] == "pivot":
            nb_pivot += cnt
        else:
            nb_target += cnt
        st = r["status"] or "auto"
        by_status[st] = by_status.get(st, 0) + cnt
        if r["confidence"] is not None:
            conf_sum += r["confidence"] * cnt
            conf_count += cnt
    avg_confidence = conf_sum / conf_count if conf_count else None
    return {
        "episode_id": episode_id,
        "run_id": run_id,
        "nb_links": nb_links,
        "nb_pivot": nb_pivot,
        "nb_target": nb_target,
        "by_status": by_status,
        "avg_confidence": round(avg_confidence, 4) if avg_confidence is not None else None,
    }


def get_audit_links(
    conn: sqlite3.Connection,
    episode_id: str,
    run_id: str,
    *,
    status_filter: str | None = None,
    q: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[dict], int]:
    """
    Liens d'alignement enrichis avec le texte des segments et cues (pour la vue Audit).
    Retourne (rows, total_count).
    """
    conn.row_factory = sqlite3.Row
    where = "al.episode_id = ? AND al.align_run_id = ?"
    params: list = [episode_id, run_id]
    if status_filter:
        where += " AND al.status = ?"
        params.append(status_filter)
    if q:
        like = f"%{_escape_like(q)}%"
        where += " AND (s.text LIKE ? ESCAPE '\\' OR pc.text_clean LIKE ? ESCAPE '\\' OR tc.text_clean LIKE ? ESCAPE '\\')"
        params.extend([like, like, like])

    base_sql = f"""
        FROM align_links al
        LEFT JOIN segments s ON al.segment_id = s.segment_id
        LEFT JOIN subtitle_cues pc ON al.cue_id = pc.cue_id
        LEFT JOIN subtitle_cues tc ON al.cue_id_target = tc.cue_id
        WHERE {where}
    """
    total = conn.execute(f"SELECT COUNT(*) {base_sql}", params).fetchone()[0]
    rows = conn.execute(
        f"""
        SELECT al.link_id, al.role, al.lang, al.confidence, al.status,
               al.segment_id, al.cue_id, al.cue_id_target,
               s.text AS text_segment, s.speaker_explicit, s.n AS segment_n,
               pc.text_clean AS text_pivot,
               tc.text_clean AS text_target,
               al.meta_json
        {base_sql}
        ORDER BY COALESCE(s.n, 999999), al.lang
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        d["confidence"] = round(d["confidence"], 4) if d["confidence"] is not None else None
        # Extraire la note depuis meta_json (G-008)
        meta_raw = d.pop("meta_json", None)
        try:
            meta = json.loads(meta_raw) if meta_raw else {}
        except (TypeError, ValueError):
            meta = {}
        d["note"] = meta.get("note") or None
        result.append(d)
    return result, total


def get_collisions_for_run(
    conn: sqlite3.Connection,
    episode_id: str,
    run_id: str,
) -> list[dict]:
    """
    Détecte les collisions : cue pivot → plusieurs liens vers le même lang cible.
    Une collision = même cue_id apparaît dans > 1 liens cible pour le même lang.
    Retourne la liste avec texte pivot + liste des cues cibles en conflit.
    """
    conn.row_factory = sqlite3.Row
    # Trouver les cue_id pivot qui ont plusieurs liens target pour le même lang
    collision_rows = conn.execute(
        """
        SELECT al.cue_id AS pivot_cue_id, al.lang, COUNT(*) AS n_targets
        FROM align_links al
        WHERE al.episode_id = ? AND al.align_run_id = ? AND al.role = 'target'
        GROUP BY al.cue_id, al.lang
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        """,
        [episode_id, run_id],
    ).fetchall()

    if not collision_rows:
        return []

    collisions = []
    for cr in collision_rows:
        pivot_cue_id = cr["pivot_cue_id"]
        lang = cr["lang"]
        # Texte du cue pivot
        pc = conn.execute(
            "SELECT text_clean FROM subtitle_cues WHERE cue_id = ?", [pivot_cue_id]
        ).fetchone()
        pivot_text = pc["text_clean"] if pc else ""
        # Liens target en conflit
        target_links = conn.execute(
            """
            SELECT al.link_id, al.cue_id_target, al.confidence, al.status,
                   tc.text_clean AS target_text
            FROM align_links al
            LEFT JOIN subtitle_cues tc ON al.cue_id_target = tc.cue_id
            WHERE al.episode_id = ? AND al.align_run_id = ?
              AND al.role = 'target' AND al.cue_id = ? AND al.lang = ?
            """,
            [episode_id, run_id, pivot_cue_id, lang],
        ).fetchall()
        collisions.append({
            "pivot_cue_id": pivot_cue_id,
            "pivot_text": pivot_text,
            "lang": lang,
            "n_targets": cr["n_targets"],
            "targets": [
                {
                    "link_id": t["link_id"],
                    "cue_id_target": t["cue_id_target"],
                    "target_text": t["target_text"] or "",
                    "confidence": round(t["confidence"], 4) if t["confidence"] else None,
                    "status": t["status"],
                }
                for t in target_links
            ],
        })
    return collisions


def get_parallel_concordance(
    conn: sqlite3.Connection,
    episode_id: str,
    run_id: str,
    status_filter: str | None = None,
) -> list[dict]:
    """
    Construit les lignes du concordancier parallèle : segment (transcript) + cue pivot + cues cibles
    à partir des liens d'alignement. Si pivot_lang est FR (alignement segment↔FR direct),
    text_fr est rempli depuis les liens pivot ; text_en reste vide sauf si des liens cible existent.
    Utilise le segment_kind du run (params_json) pour charger les bons segments (sentence ou utterance).
    """
    links = query_alignment_for_episode(conn, episode_id, run_id=run_id, status_filter=status_filter)
    run = get_align_run(conn, run_id)
    pivot_lang = (run.get("pivot_lang") or DEFAULT_PIVOT_LANG).strip().lower() if run else DEFAULT_PIVOT_LANG
    segment_kind, _ = parse_run_segment_kind(
        run.get("params_json") if run else None,
        run_id=run_id,
        logger_obj=logger,
    )
    segments = db_segments.get_segments_for_episode(conn, episode_id, kind=segment_kind)

    def cue_text(c: dict) -> str:
        return (c.get("text_clean") or c.get("text_raw") or "").strip()

    cues_by_lang: dict[str, dict[str, str]] = {}
    for _lang in SUPPORTED_LANGUAGES:
        cues = db_subtitles.get_cues_for_episode_lang(conn, episode_id, _lang)
        cues_by_lang[_lang] = {c["cue_id"]: cue_text(c) for c in cues}

    seg_by_id = {s["segment_id"]: (s.get("text") or "").strip() for s in segments}
    seg_speaker_by_id = {s["segment_id"]: (s.get("speaker_explicit") or "").strip() for s in segments}

    pivot_links = [lnk for lnk in links if lnk.get("role") == "pivot"]
    # Index target links by the pivot cue they're attached to (independent of pivot_lang)
    target_by_cue_pivot: dict[str, list[dict]] = {}
    for lnk in links:
        if lnk.get("role") != "target" or not lnk.get("cue_id"):
            continue
        target_by_cue_pivot.setdefault(lnk["cue_id"], []).append(lnk)

    result: list[dict] = []
    for pl in pivot_links:
        seg_id = pl.get("segment_id")
        cue_id_pivot = pl.get("cue_id")
        text_seg = seg_by_id.get(seg_id, "")
        conf_pivot = pl.get("confidence")

        # Texte et confiance par langue — initialisés vides (dynamique selon SUPPORTED_LANGUAGES)
        text_by_lang: dict[str, str] = {lg: "" for lg in SUPPORTED_LANGUAGES}
        conf_by_lang: dict[str, float | None] = {lg: None for lg in SUPPORTED_LANGUAGES}

        # Le pivot remplit sa propre langue
        pivot_cues = cues_by_lang.get(pivot_lang, {})
        text_by_lang[pivot_lang] = pivot_cues.get(cue_id_pivot or "", "")

        # Les liens cible remplissent les autres langues (quel que soit pivot_lang)
        for tl in target_by_cue_pivot.get(cue_id_pivot or "", []):
            tl_lang = (tl.get("lang") or "").lower()
            cid_t = tl.get("cue_id_target")
            if tl_lang in cues_by_lang and cid_t:
                text_by_lang[tl_lang] = cues_by_lang[tl_lang].get(cid_t, "")
                conf_by_lang[tl_lang] = tl.get("confidence")

        row: dict = {
            "segment_id": seg_id,
            "speaker": seg_speaker_by_id.get(seg_id, ""),
            "text_segment": text_seg,
            "confidence_pivot": conf_pivot,
        }
        for _lg in SUPPORTED_LANGUAGES:
            row[f"text_{_lg}"] = text_by_lang[_lg]
            row[f"confidence_{_lg}"] = conf_by_lang[_lg]
        result.append(row)
    return result

def get_link_positions(
    conn: "sqlite3.Connection",
    episode_id: str,
    run_id: str,
) -> list[dict]:
    """Retourne (n, status) pour chaque lien pivot, trié par n — usage minimap."""
    import sqlite3 as _sqlite3
    conn.row_factory = _sqlite3.Row
    rows = conn.execute(
        """
        SELECT s.n AS n, al.status AS status
        FROM align_links al
        JOIN segments s ON s.segment_id = al.segment_id
        WHERE al.episode_id = ? AND al.align_run_id = ? AND al.role = 'pivot'
        ORDER BY s.n
        """,
        (episode_id, run_id),
    ).fetchall()
    return [{"n": int(r["n"]), "status": r["status"]} for r in rows]
