"""SQLite + FTS5 + requêtes KWIC."""

from __future__ import annotations

import datetime
import sqlite3
from contextlib import contextmanager
from pathlib import Path


from howimetyourcorpus.core.constants import KWIC_CONTEXT_WINDOW, SQLITE_CACHE_SIZE_KB, SQLITE_MMAP_SIZE
from howimetyourcorpus.core.models import EpisodeRef, EpisodeStatus

from howimetyourcorpus.core.storage import db_align
from howimetyourcorpus.core.storage import db_segments
from howimetyourcorpus.core.storage import db_subtitles
from howimetyourcorpus.core.storage.db_kwic import (
    KwicHit,
    query_kwic as _query_kwic,
    query_kwic_cues as _query_kwic_cues,
    query_kwic_segments as _query_kwic_segments,
)

# Schéma DDL
STORAGE_DIR = Path(__file__).parent
SCHEMA_SQL = (STORAGE_DIR / "schema.sql").read_text(encoding="utf-8")
MIGRATIONS_DIR = STORAGE_DIR / "migrations"

# Réexport pour compatibilité (KwicHit défini dans db_kwic)
__all__ = ["CorpusDB", "KwicHit"]


class CorpusDB:
    """Accès à la base corpus (épisodes, documents, FTS, KWIC).
    
    Optimisations Phase 6 :
    - PRAGMA pour performance (WAL, cache, mmap)
    - Context manager pour réutilisation de connexion
    - Méthodes batch pour insertions multiples
    """

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)

    def _conn(self) -> sqlite3.Connection:
        """Ouvre une connexion avec PRAGMA d'optimisation."""
        conn = sqlite3.connect(self.db_path)
        # Phase 6: Optimisations SQLite
        conn.execute("PRAGMA journal_mode = WAL")  # Write-Ahead Logging (lectures non-bloquantes)
        conn.execute("PRAGMA synchronous = NORMAL")  # Balance sécurité/performance
        conn.execute(f"PRAGMA cache_size = {SQLITE_CACHE_SIZE_KB}")  # Cache 64MB (négatif = KB)
        conn.execute("PRAGMA temp_store = MEMORY")  # Tables temporaires en RAM
        conn.execute(f"PRAGMA mmap_size = {SQLITE_MMAP_SIZE}")  # Memory-mapped I/O 256MB pour FTS5
        return conn
    
    @contextmanager
    def connection(self):
        """Context manager pour réutiliser une connexion (Phase 6).
        
        Exemple :
            with db.connection() as conn:
                db_segments.upsert_segments(conn, ep_id, "sentence", segs)
                db_segments.upsert_segments(conn, ep_id, "utterance", utts)
                # 1 seule connexion pour N opérations !
        """
        conn = self._conn()
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self):
        """Context manager transactionnel (commit/rollback automatique)."""
        conn = self._conn()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Exécute les migrations en attente (schema_version)."""
        if not self._table_exists(conn, "schema_version"):
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)"
            )
            conn.execute("INSERT INTO schema_version (version) VALUES (1)")
            conn.commit()
        cur = conn.execute(
            "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
        )
        row = cur.fetchone()
        current = int(row[0]) if row else 0
        if not MIGRATIONS_DIR.exists():
            return
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        for path in migration_files:
            # 002_segments.sql -> 2
            try:
                version = int(path.stem.split("_")[0])
            except ValueError:
                continue
            if version <= current:
                continue
            sql = path.read_text(encoding="utf-8")
            conn.executescript(sql)
            conn.commit()

    def init(self) -> None:
        """Crée les tables et FTS si nécessaire, puis exécute les migrations."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = self._conn()
        try:
            conn.executescript(SCHEMA_SQL)
            conn.commit()
            self._migrate(conn)
        finally:
            conn.close()

    def _table_exists(self, conn: sqlite3.Connection, table_name: str) -> bool:
        """Retourne True si la table existe."""
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        ).fetchone()
        return row is not None

    def get_schema_version(self) -> int:
        """Retourne la version du schéma (table schema_version). 0 si la table n'existe pas ou est vide."""
        if not self.db_path.exists():
            return 0
        conn = self._conn()
        try:
            if not self._table_exists(conn, "schema_version"):
                return 0
            row = conn.execute(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()

    def rebuild_segments_fts(self) -> dict[str, int]:
        """Reconstruit l'index FTS5 `segments_fts` depuis la table `segments` (commande FTS5 rebuild).

        À utiliser après une incohérence entre la table segments et son index full-text,
        par exemple après un import manuel ou une migration hors flux normal.

        Retourne ``{"segments_rows": N, "segments_fts_rows": M}``.
        """
        with self.transaction() as conn:
            conn.execute("INSERT INTO segments_fts(segments_fts) VALUES('rebuild')")
        with self.connection() as conn:
            seg_rows  = conn.execute("SELECT count(*) FROM segments").fetchone()[0]
            fts_rows  = conn.execute("SELECT count(*) FROM segments_fts").fetchone()[0]
        return {"segments_rows": int(seg_rows), "segments_fts_rows": int(fts_rows)}

    def ensure_migrated(self) -> None:
        """Exécute les migrations en attente (à appeler à l'ouverture d'un projet existant).
        Si des tables Phase 3+ sont manquantes (schema_version incohérent), exécute les scripts concernés.
        """
        if not self.db_path.exists():
            return
        conn = self._conn()
        try:
            self._migrate(conn)
            if not self._table_exists(conn, "subtitle_tracks"):
                for name in ("003_subtitles", "004_align"):
                    path = MIGRATIONS_DIR / f"{name}.sql"
                    if path.exists():
                        conn.executescript(path.read_text(encoding="utf-8"))
                        conn.commit()
        finally:
            conn.close()

    def upsert_episode(self, ref: EpisodeRef, status: str = "new") -> None:
        """Insère ou met à jour une entrée épisode."""
        conn = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO episodes (episode_id, season, episode, title, url, status)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(episode_id) DO UPDATE SET
                  season=excluded.season, episode=excluded.episode,
                  title=excluded.title, url=excluded.url, status=excluded.status
                """,
                (ref.episode_id, ref.season, ref.episode, ref.title, ref.url, status),
            )
            conn.commit()
        finally:
            conn.close()
    
    def upsert_episodes_batch(self, refs: list[EpisodeRef], status: str = "new") -> None:
        """Insère ou met à jour plusieurs épisodes en une seule transaction (Phase 6)."""
        if not refs:
            return
        conn = self._conn()
        try:
            with conn:
                for ref in refs:
                    conn.execute(
                        """
                        INSERT INTO episodes (episode_id, season, episode, title, url, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(episode_id) DO UPDATE SET
                          season=excluded.season, episode=excluded.episode,
                          title=excluded.title, url=excluded.url, status=excluded.status
                        """,
                        (ref.episode_id, ref.season, ref.episode, ref.title, ref.url, status),
                    )
        finally:
            conn.close()

    def set_episode_status(
        self, episode_id: str, status: str, timestamp: str | None = None
    ) -> None:
        """Met à jour le statut d'un épisode (et fetched_at / normalized_at si fourni)."""
        ts = timestamp or datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
        conn = self._conn()
        try:
            if status == EpisodeStatus.FETCHED.value:
                conn.execute(
                    "UPDATE episodes SET status=?, fetched_at=? WHERE episode_id=?",
                    (status, ts, episode_id),
                )
            elif status == EpisodeStatus.NORMALIZED.value:
                conn.execute(
                    "UPDATE episodes SET status=?, normalized_at=? WHERE episode_id=?",
                    (status, ts, episode_id),
                )
            else:
                conn.execute(
                    "UPDATE episodes SET status=? WHERE episode_id=?",
                    (status, episode_id),
                )
            conn.commit()
        finally:
            conn.close()

    def index_episode_text(self, episode_id: str, clean_text: str) -> None:
        """Indexe le texte normalisé d'un épisode (documents + FTS)."""
        conn = self._conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO documents (episode_id, clean_text) VALUES (?, ?)",
                (episode_id, clean_text),
            )
            conn.execute(
                "UPDATE episodes SET status=? WHERE episode_id=?",
                (EpisodeStatus.INDEXED.value, episode_id),
            )
            conn.commit()
        finally:
            conn.close()

    def query_kwic(
        self,
        term: str,
        season: int | None = None,
        episode: int | None = None,
        window: int = KWIC_CONTEXT_WINDOW,
        limit: int = 200,
        case_sensitive: bool = False,
    ) -> list[KwicHit]:
        """Recherche KWIC sur documents (FTS5). Délègue à db_kwic."""
        conn = self._conn()
        try:
            return _query_kwic(conn, term, season=season, episode=episode, window=window, limit=limit, case_sensitive=case_sensitive)
        finally:
            conn.close()

    def get_episode_ids_indexed(self) -> list[str]:
        """Liste des episode_id ayant du texte indexé."""
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT episode_id FROM documents"
            ).fetchall()
            return [r[0] for r in rows]
        finally:
            conn.close()
    
    def get_episodes_by_status(self, status: str | None = None) -> list[dict]:
        """Retourne les épisodes filtrés par statut (Phase 6, optimisé avec index).
        
        Args:
            status: Statut à filtrer ("new", "fetched", "normalized", "indexed"), ou None pour tous.
        
        Returns:
            Liste de dicts {episode_id, season, episode, title, url, status, fetched_at, normalized_at}.
        """
        conn = self._conn()
        try:
            conn.row_factory = sqlite3.Row
            if status:
                # Utilise idx_episodes_status (Phase 6)
                rows = conn.execute(
                    """SELECT episode_id, season, episode, title, url, status, fetched_at, normalized_at
                       FROM episodes WHERE status = ?
                       ORDER BY season, episode""",
                    (status,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT episode_id, season, episode, title, url, status, fetched_at, normalized_at
                       FROM episodes
                       ORDER BY season, episode""",
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()
    
    def count_episodes_by_status(self) -> dict[str, int]:
        """Compte rapide des épisodes par statut (Phase 6, optimisé avec index).
        
        Returns:
            Dict {status: count}, ex: {"new": 5, "fetched": 10, "indexed": 8}.
        """
        conn = self._conn()
        try:
            rows = conn.execute(
                "SELECT status, COUNT(*) FROM episodes GROUP BY status"
            ).fetchall()
            return {r[0]: r[1] for r in rows}
        finally:
            conn.close()

    # ----- Phase 2: segments (délègue à db_segments) -----

    def upsert_segments(
        self,
        episode_id: str,
        kind: str,
        segments: list,
    ) -> None:
        """Insère ou met à jour les segments d'un épisode (sentence ou utterance)."""
        conn = self._conn()
        try:
            db_segments.upsert_segments(conn, episode_id, kind, segments)
            conn.commit()
        finally:
            conn.close()

    def query_kwic_segments(
        self,
        term: str,
        kind: str | None = None,
        season: int | None = None,
        episode: int | None = None,
        window: int = KWIC_CONTEXT_WINDOW,
        limit: int = 200,
        case_sensitive: bool = False,
    ) -> list[KwicHit]:
        """Recherche KWIC au niveau segments (FTS segments_fts). Délègue à db_kwic."""
        conn = self._conn()
        try:
            return _query_kwic_segments(
                conn, term, kind=kind, season=season, episode=episode, window=window, limit=limit,
                case_sensitive=case_sensitive,
            )
        finally:
            conn.close()

    def get_segments_for_episode(
        self,
        episode_id: str,
        kind: str | None = None,
    ) -> list[dict]:
        """Retourne les segments d'un épisode (pour l'Inspecteur). kind = 'sentence' | 'utterance' | None (tous)."""
        conn = self._conn()
        try:
            return db_segments.get_segments_for_episode(conn, episode_id, kind)
        finally:
            conn.close()

    def update_segment_speaker(self, segment_id: str, speaker_explicit: str | None) -> None:
        """Met à jour le champ speaker_explicit d'un segment (propagation §8)."""
        conn = self._conn()
        try:
            db_segments.update_segment_speaker(conn, segment_id, speaker_explicit)
            conn.commit()
        finally:
            conn.close()

    def update_segment_text(self, segment_id: str, text: str) -> None:
        """Met à jour le texte d'un segment."""
        conn = self._conn()
        try:
            db_segments.update_segment_text(conn, segment_id, text)
            conn.commit()
        finally:
            conn.close()

    def get_distinct_speaker_explicit(self, episode_ids: list[str]) -> list[str]:
        """Retourne la liste des noms de locuteurs (speaker_explicit) présents dans les segments des épisodes donnés, triés."""
        conn = self._conn()
        try:
            return db_segments.get_distinct_speaker_explicit(conn, episode_ids)
        finally:
            conn.close()

    # ----- Phase 3: sous-titres (délègue à db_subtitles) -----

    def add_track(
        self,
        track_id: str,
        episode_id: str,
        lang: str,
        fmt: str,
        source_path: str | None = None,
        imported_at: str | None = None,
        meta_json: str | None = None,
    ) -> None:
        """Enregistre une piste sous-titres (ou met à jour si track_id existe). fmt = "srt"|"vtt"."""
        conn = self._conn()
        try:
            db_subtitles.add_track(conn, track_id, episode_id, lang, fmt, source_path, imported_at, meta_json)
            conn.commit()
        finally:
            conn.close()

    def upsert_cues(self, track_id: str, episode_id: str, lang: str, cues: list) -> None:
        """Remplace les cues d'une piste (supprime anciennes, insère les nouvelles)."""
        conn = self._conn()
        try:
            db_subtitles.upsert_cues(conn, track_id, episode_id, lang, cues)
            conn.commit()
        finally:
            conn.close()

    def update_cue_text_clean(self, cue_id: str, text_clean: str) -> None:
        """Met à jour le champ text_clean d'une cue (propagation §8)."""
        conn = self._conn()
        try:
            db_subtitles.update_cue_text_clean(conn, cue_id, text_clean)
            conn.commit()
        finally:
            conn.close()

    def update_cue_timecodes(self, cue_id: str, start_ms: int, end_ms: int) -> None:
        """Met à jour les timecodes d'une cue."""
        conn = self._conn()
        try:
            db_subtitles.update_cue_timecodes(conn, cue_id, start_ms, end_ms)
            conn.commit()
        finally:
            conn.close()

    def query_kwic_cues(
        self,
        term: str,
        lang: str | None = None,
        season: int | None = None,
        episode: int | None = None,
        window: int = KWIC_CONTEXT_WINDOW,
        limit: int = 200,
        case_sensitive: bool = False,
    ) -> list[KwicHit]:
        """Recherche KWIC sur les cues sous-titres (FTS cues_fts). Délègue à db_kwic."""
        conn = self._conn()
        try:
            return _query_kwic_cues(
                conn, term, lang=lang, season=season, episode=episode, window=window, limit=limit,
                case_sensitive=case_sensitive,
            )
        finally:
            conn.close()

    def get_tracks_for_episode(self, episode_id: str) -> list[dict]:
        """Retourne les pistes sous-titres d'un épisode avec nb_cues (pour l'UI)."""
        conn = self._conn()
        try:
            return db_subtitles.get_tracks_for_episode(conn, episode_id)
        finally:
            conn.close()

    def get_tracks_for_episodes(self, episode_ids: list[str]) -> dict[str, list[dict]]:
        """Retourne les pistes par épisode (episode_id -> liste). Batch pour refresh Corpus / arbre."""
        conn = self._conn()
        try:
            return db_subtitles.get_tracks_for_episodes(conn, episode_ids)
        finally:
            conn.close()

    def delete_subtitle_track(self, episode_id: str, lang: str) -> None:
        """Supprime une piste sous-titres (cues puis track). track_id = episode_id:lang."""
        conn = self._conn()
        try:
            db_subtitles.delete_subtitle_track(conn, episode_id, lang)
            conn.commit()
        finally:
            conn.close()

    def delete_segments_for_episode(self, episode_id: str) -> None:
        """Supprime tous les segments (toutes kinds) pour un épisode."""
        conn = self._conn()
        try:
            conn.execute("DELETE FROM segments WHERE episode_id = ?", (episode_id,))
            conn.commit()
        finally:
            conn.close()

    def get_cues_for_episode_lang(self, episode_id: str, lang: str) -> list[dict]:
        """Retourne les cues d'un épisode pour une langue (pour l'Inspecteur). meta = dict si meta_json présent."""
        conn = self._conn()
        try:
            return db_subtitles.get_cues_for_episode_lang(conn, episode_id, lang)
        finally:
            conn.close()

    # ----- Phase 4: alignement (délègue à db_align) -----

    def create_align_run(
        self,
        align_run_id: str,
        episode_id: str,
        pivot_lang: str,
        params_json: str | None = None,
        created_at: str | None = None,
        summary_json: str | None = None,
    ) -> None:
        """Crée une entrée de run d'alignement."""
        conn = self._conn()
        try:
            db_align.create_align_run(conn, align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json)
            conn.commit()
        finally:
            conn.close()

    def upsert_align_links(self, align_run_id: str, episode_id: str, links: list[dict]) -> None:
        """Remplace les liens d'un run (DELETE puis INSERT). Chaque link: segment_id?, cue_id?, cue_id_target?, lang?, role, confidence, status, meta_json?."""
        conn = self._conn()
        try:
            db_align.upsert_align_links(conn, align_run_id, episode_id, links)
            conn.commit()
        finally:
            conn.close()

    def create_align_run_and_links(
        self,
        align_run_id: str,
        episode_id: str,
        pivot_lang: str,
        params_json: str | None,
        created_at: str | None,
        summary_json: str | None,
        links: list[dict],
    ) -> None:
        """Crée un run et insère ses liens en une unique transaction atomique.

        Garantit qu'il ne peut pas y avoir de run sans liens ni de liens sans run
        en base, même en cas de coupure entre les deux écritures.
        """
        conn = self._conn()
        try:
            with conn:  # commit global ou rollback global
                db_align.create_align_run(conn, align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json)
                db_align._insert_align_links_inner(conn, align_run_id, episode_id, links)
        finally:
            conn.close()

    def set_align_status(self, link_id: str, status: str) -> None:
        """Met à jour le statut d'un lien (accepted / rejected / ignored)."""
        conn = self._conn()
        try:
            db_align.set_align_status(conn, link_id, status)
            conn.commit()
        finally:
            conn.close()

    def set_align_note(self, link_id: str, note: str | None) -> None:
        """Enregistre une note libre dans meta_json d'un lien (G-008 / MX-049)."""
        conn = self._conn()
        try:
            db_align.set_align_note(conn, link_id, note)
            conn.commit()
        finally:
            conn.close()

    def bulk_set_align_status(
        self,
        align_run_id: str,
        episode_id: str,
        new_status: str,
        *,
        link_ids: list[str] | None = None,
        filter_status: str | None = None,
        conf_lt: float | None = None,
    ) -> int:
        """Mise à jour groupée des statuts de liens (MX-039). Retourne le nombre de lignes modifiées."""
        conn = self._conn()
        try:
            n = db_align.bulk_set_align_status(
                conn,
                align_run_id,
                episode_id,
                new_status,
                link_ids=link_ids,
                filter_status=filter_status,
                conf_lt=conf_lt,
            )
            conn.commit()
            return n
        finally:
            conn.close()

    def update_align_link_cues(
        self,
        link_id: str,
        cue_id: str | None = None,
        cue_id_target: str | None = None,
    ) -> None:
        """Modifie la cible d'un lien (réplique EN et/ou réplique cible). Met le statut à 'accepted' (correction manuelle)."""
        conn = self._conn()
        try:
            db_align.update_align_link_cues(conn, link_id, cue_id, cue_id_target)
            conn.commit()
        finally:
            conn.close()

    def search_subtitle_cues(
        self,
        episode_id: str,
        lang: str,
        *,
        q: str | None = None,
        around_cue_id: str | None = None,
        around_window: int = 10,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Recherche des cues SRT (FTS ou neighbourhood). Retourne (rows, total)."""
        conn = self._conn()
        try:
            return db_align.search_subtitle_cues(
                conn,
                episode_id,
                lang,
                q=q,
                around_cue_id=around_cue_id,
                around_window=around_window,
                limit=limit,
                offset=offset,
            )
        finally:
            conn.close()

    def get_align_runs_for_episode(self, episode_id: str) -> list[dict]:
        """Retourne les runs d'alignement d'un épisode (pour l'UI)."""
        conn = self._conn()
        try:
            return db_align.get_align_runs_for_episode(conn, episode_id)
        finally:
            conn.close()

    def get_align_run(self, run_id: str) -> dict | None:
        """Retourne un run d'alignement par son id (pour pivot_lang, etc.)."""
        conn = self._conn()
        try:
            return db_align.get_align_run(conn, run_id)
        finally:
            conn.close()

    def get_link_positions(self, episode_id: str, run_id: str) -> list[dict]:
        """Retourne (n, status) pour chaque lien pivot — usage minimap."""
        conn = self._conn()
        try:
            return db_align.get_link_positions(conn, episode_id, run_id)
        finally:
            conn.close()

    def get_align_runs_for_episodes(self, episode_ids: list[str]) -> dict[str, list[dict]]:
        """Retourne les runs d'alignement par épisode (episode_id -> liste). Batch pour refresh Corpus / arbre."""
        conn = self._conn()
        try:
            return db_align.get_align_runs_for_episodes(conn, episode_ids)
        finally:
            conn.close()

    def delete_align_run(self, align_run_id: str) -> None:
        """Supprime un run d'alignement et tous ses liens."""
        conn = self._conn()
        try:
            db_align.delete_align_run(conn, align_run_id)
            conn.commit()
        finally:
            conn.close()

    def delete_align_runs_for_episode(self, episode_id: str) -> None:
        """Supprime tous les runs d'alignement d'un épisode (évite liens orphelins après suppression piste ou re-segmentation)."""
        conn = self._conn()
        try:
            db_align.delete_align_runs_for_episode(conn, episode_id)
            conn.commit()
        finally:
            conn.close()

    def query_alignment_for_episode(
        self,
        episode_id: str,
        run_id: str | None = None,
        status_filter: str | None = None,
        min_confidence: float | None = None,
    ) -> list[dict]:
        """Retourne les liens d'alignement pour un épisode (optionnel: run_id, filtre status, min confidence)."""
        conn = self._conn()
        try:
            return db_align.query_alignment_for_episode(conn, episode_id, run_id, status_filter, min_confidence)
        finally:
            conn.close()

    # ----- Phase 5: concordancier parallèle et stats (délègue à db_align) -----

    def get_align_stats_for_run(
        self, episode_id: str, run_id: str, status_filter: str | None = None
    ) -> dict:
        """
        Statistiques d'alignement pour un run : nb_links, nb_pivot, nb_target,
        by_status (auto/accepted/rejected), avg_confidence.
        """
        conn = self._conn()
        try:
            return db_align.get_align_stats_for_run(conn, episode_id, run_id, status_filter)
        finally:
            conn.close()

    def get_parallel_concordance(
        self,
        episode_id: str,
        run_id: str,
        status_filter: str | None = None,
        limit: int = 2000,
        q: str | None = None,
    ) -> tuple[list[dict], bool]:
        """
        Construit les lignes du concordancier parallèle : segment (transcript) + cue EN + cues FR/IT
        à partir des liens d'alignement.
        Retourne ``(rows, has_more)``.
        """
        conn = self._conn()
        try:
            return db_align.get_parallel_concordance(conn, episode_id, run_id, status_filter, limit=limit, q=q)
        finally:
            conn.close()

    def get_audit_links(
        self,
        episode_id: str,
        run_id: str,
        *,
        status_filter: str | None = None,
        q: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict], int]:
        """Liens enrichis avec texte pour la vue Audit (paginage + filtre)."""
        conn = self._conn()
        try:
            return db_align.get_audit_links(
                conn, episode_id, run_id,
                status_filter=status_filter, q=q, offset=offset, limit=limit,
            )
        finally:
            conn.close()

    def get_collisions_for_run(self, episode_id: str, run_id: str) -> list[dict]:
        """Détecte les collisions d'alignement (cue pivot → plusieurs cues cibles, même lang)."""
        conn = self._conn()
        try:
            return db_align.get_collisions_for_run(conn, episode_id, run_id)
        finally:
            conn.close()
