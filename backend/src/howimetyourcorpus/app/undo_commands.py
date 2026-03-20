"""Commandes Undo/Redo pour QUndoStack (Basse Priorité #3)."""

from __future__ import annotations

import json
import sqlite3
from typing import TYPE_CHECKING, Any, Callable

from PySide6.QtGui import QUndoCommand

if TYPE_CHECKING:
    from howimetyourcorpus.core.storage.db import CorpusDB
    from howimetyourcorpus.core.storage.project_store import ProjectStore


class SetAlignStatusCommand(QUndoCommand):
    """Commande pour changer le statut d'un lien d'alignement (accept/reject)."""
    
    def __init__(
        self,
        db: CorpusDB,
        link_id: str,
        new_status: str,
        old_status: str,
        description: str | None = None
    ):
        super().__init__(description or f"Changer statut alignement → {new_status}")
        self.db = db
        self.link_id = link_id
        self.new_status = new_status
        self.old_status = old_status
    
    def redo(self) -> None:
        """Applique le nouveau statut."""
        self.db.set_align_status(self.link_id, self.new_status)
    
    def undo(self) -> None:
        """Restaure l'ancien statut."""
        self.db.set_align_status(self.link_id, self.old_status)


class EditAlignLinkCommand(QUndoCommand):
    """Commande pour modifier la cible d'un lien d'alignement."""
    
    def __init__(
        self,
        db: CorpusDB,
        link_id: str,
        new_target_id: str | None,
        old_target_id: str | None,
        new_status: str = "manual",
        old_status: str = "auto"
    ):
        super().__init__("Modifier lien alignement")
        self.db = db
        self.link_id = link_id
        self.new_target_id = new_target_id
        self.old_target_id = old_target_id
        self.new_status = new_status
        self.old_status = old_status
    
    def redo(self) -> None:
        """Applique la nouvelle cible."""
        with self.db.connection() as conn:
            conn.execute(
                "UPDATE align_links SET cue_id_target = ?, status = ? WHERE link_id = ?",
                (self.new_target_id, self.new_status, self.link_id)
            )
            conn.commit()
    
    def undo(self) -> None:
        """Restaure l'ancienne cible."""
        with self.db.connection() as conn:
            conn.execute(
                "UPDATE align_links SET cue_id_target = ?, status = ? WHERE link_id = ?",
                (self.old_target_id, self.old_status, self.link_id)
            )
            conn.commit()


class DeleteAlignRunCommand(QUndoCommand):
    """Commande pour supprimer un run d'alignement (avec backup pour Undo)."""

    def __init__(
        self,
        db: CorpusDB,
        run_id: str,
        episode_id: str
    ):
        super().__init__(f"Supprimer run alignement {run_id}")
        self.db = db
        self.run_id = run_id
        self.episode_id = episode_id
        self.backup_links: list[dict[str, Any]] = []
        self.backup_run: dict[str, Any] | None = None
        self._backup_data()

    def _backup_data(self) -> None:
        """Sauvegarde les liens et le run (schéma align_runs / align_links)."""
        self.backup_links = self.db.query_alignment_for_episode(
            self.episode_id,
            run_id=self.run_id
        )
        with self.db.connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json FROM align_runs WHERE align_run_id = ?",
                (self.run_id,)
            ).fetchone()
            if row:
                self.backup_run = dict(row)

    def redo(self) -> None:
        """Supprime le run."""
        self.db.delete_align_run(self.run_id)

    def undo(self) -> None:
        """Restaure le run et ses liens."""
        if not self.backup_run:
            return
        with self.db.connection() as conn:
            conn.execute(
                """INSERT INTO align_runs (align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    self.backup_run["align_run_id"],
                    self.backup_run["episode_id"],
                    self.backup_run["pivot_lang"],
                    self.backup_run.get("params_json"),
                    self.backup_run.get("created_at"),
                    self.backup_run.get("summary_json"),
                )
            )
            for link in self.backup_links:
                meta = link.get("meta") or {}
                meta_json = json.dumps(meta) if meta else None
                conn.execute(
                    """INSERT INTO align_links
                       (link_id, align_run_id, episode_id, segment_id, cue_id, cue_id_target, lang, role, confidence, status, meta_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        link.get("link_id"),
                        self.run_id,
                        link.get("episode_id"),
                        link.get("segment_id"),
                        link.get("cue_id"),
                        link.get("cue_id_target"),
                        link.get("lang") or "",
                        link.get("role") or "pivot",
                        link.get("confidence"),
                        link.get("status") or "auto",
                        meta_json,
                    )
                )
            conn.commit()


class BulkAcceptLinksCommand(QUndoCommand):
    """Commande pour accepter en masse des liens d'alignement."""
    
    def __init__(
        self,
        db: CorpusDB,
        link_ids: list[str],
        count: int
    ):
        super().__init__(f"Accepter {count} lien(s)")
        self.db = db
        self.link_ids = link_ids
    
    def redo(self) -> None:
        """Accepte tous les liens."""
        with self.db.connection() as conn:
            for link_id in self.link_ids:
                conn.execute(
                    "UPDATE align_links SET status = 'accepted' WHERE link_id = ?",
                    (link_id,)
                )
            conn.commit()
    
    def undo(self) -> None:
        """Restaure le statut 'auto' pour tous les liens."""
        with self.db.connection() as conn:
            for link_id in self.link_ids:
                conn.execute(
                    "UPDATE align_links SET status = 'auto' WHERE link_id = ?",
                    (link_id,)
                )
            conn.commit()


class BulkRejectLinksCommand(QUndoCommand):
    """Commande pour rejeter en masse des liens d'alignement."""
    
    def __init__(
        self,
        db: CorpusDB,
        link_ids: list[str],
        count: int
    ):
        super().__init__(f"Rejeter {count} lien(s)")
        self.db = db
        self.link_ids = link_ids
    
    def redo(self) -> None:
        """Rejette tous les liens."""
        with self.db.connection() as conn:
            for link_id in self.link_ids:
                conn.execute(
                    "UPDATE align_links SET status = 'rejected' WHERE link_id = ?",
                    (link_id,)
                )
            conn.commit()
    
    def undo(self) -> None:
        """Restaure le statut 'auto' pour tous les liens."""
        with self.db.connection() as conn:
            for link_id in self.link_ids:
                conn.execute(
                    "UPDATE align_links SET status = 'auto' WHERE link_id = ?",
                    (link_id,)
                )
            conn.commit()


class DeleteSubtitleTrackCommand(QUndoCommand):
    """Commande pour supprimer une piste de sous-titres (DB + fichiers + runs alignement)."""

    def __init__(
        self,
        db: CorpusDB,
        store: ProjectStore,
        episode_id: str,
        lang: str,
    ):
        super().__init__(f"Supprimer piste sous-titres {episode_id} ({lang})")
        self.db = db
        self.store = store
        self.episode_id = episode_id
        self.lang = lang
        self.track_id = f"{episode_id}:{lang}"
        self.backup_track: dict[str, Any] | None = None
        self.backup_cues: list[dict[str, Any]] = []
        self.backup_runs: list[dict[str, Any]] = []
        self.backup_links: list[dict[str, Any]] = []
        self.backup_file_content: str | None = None
        self.backup_file_fmt: str | None = None
        self._backup_data()

    def _backup_data(self) -> None:
        """Sauvegarde la piste, les cues, les runs/links et le fichier sur disque."""
        with self.db.connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """SELECT track_id, episode_id, lang, format, source_path, imported_at, meta_json
                   FROM subtitle_tracks WHERE track_id = ?""",
                (self.track_id,),
            ).fetchone()
            if row:
                self.backup_track = dict(row)

            cue_rows = conn.execute(
                """SELECT cue_id, track_id, episode_id, lang, n, start_ms, end_ms, text_raw, text_clean, meta_json
                   FROM subtitle_cues
                   WHERE track_id = ?
                   ORDER BY n""",
                (self.track_id,),
            ).fetchall()
            self.backup_cues = [dict(r) for r in cue_rows]

            run_rows = conn.execute(
                """SELECT align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json
                   FROM align_runs
                   WHERE episode_id = ?
                   ORDER BY created_at DESC""",
                (self.episode_id,),
            ).fetchall()
            self.backup_runs = [dict(r) for r in run_rows]

            link_rows = conn.execute(
                """SELECT link_id, align_run_id, episode_id, segment_id, cue_id, cue_id_target, lang, role, confidence, status, meta_json
                   FROM align_links
                   WHERE episode_id = ?
                   ORDER BY align_run_id, link_id""",
                (self.episode_id,),
            ).fetchall()
            self.backup_links = [dict(r) for r in link_rows]

        content_fmt = self.store.load_episode_subtitle_content(self.episode_id, self.lang)
        if content_fmt:
            self.backup_file_content, self.backup_file_fmt = content_fmt

    def redo(self) -> None:
        """Supprime la piste en base + les runs alignement + les fichiers sur disque."""
        self.db.delete_subtitle_track(self.episode_id, self.lang)
        self.db.delete_align_runs_for_episode(self.episode_id)
        self.store.remove_episode_subtitle(self.episode_id, self.lang)

    def undo(self) -> None:
        """Restaure la piste, les runs alignement et le fichier disque."""
        with self.db.connection() as conn:
            if self.backup_track:
                conn.execute(
                    """
                    INSERT INTO subtitle_tracks (track_id, episode_id, lang, format, source_path, imported_at, meta_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(track_id) DO UPDATE SET
                      episode_id=excluded.episode_id,
                      lang=excluded.lang,
                      format=excluded.format,
                      source_path=excluded.source_path,
                      imported_at=excluded.imported_at,
                      meta_json=excluded.meta_json
                    """,
                    (
                        self.backup_track.get("track_id"),
                        self.backup_track.get("episode_id"),
                        self.backup_track.get("lang"),
                        self.backup_track.get("format"),
                        self.backup_track.get("source_path"),
                        self.backup_track.get("imported_at"),
                        self.backup_track.get("meta_json"),
                    ),
                )

            for cue in self.backup_cues:
                conn.execute(
                    """
                    INSERT INTO subtitle_cues
                      (cue_id, track_id, episode_id, lang, n, start_ms, end_ms, text_raw, text_clean, meta_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(cue_id) DO UPDATE SET
                      track_id=excluded.track_id,
                      episode_id=excluded.episode_id,
                      lang=excluded.lang,
                      n=excluded.n,
                      start_ms=excluded.start_ms,
                      end_ms=excluded.end_ms,
                      text_raw=excluded.text_raw,
                      text_clean=excluded.text_clean,
                      meta_json=excluded.meta_json
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

            for run in self.backup_runs:
                conn.execute(
                    """
                    INSERT INTO align_runs (align_run_id, episode_id, pivot_lang, params_json, created_at, summary_json)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(align_run_id) DO UPDATE SET
                      episode_id=excluded.episode_id,
                      pivot_lang=excluded.pivot_lang,
                      params_json=excluded.params_json,
                      created_at=excluded.created_at,
                      summary_json=excluded.summary_json
                    """,
                    (
                        run.get("align_run_id"),
                        run.get("episode_id"),
                        run.get("pivot_lang"),
                        run.get("params_json"),
                        run.get("created_at"),
                        run.get("summary_json"),
                    ),
                )

            for link in self.backup_links:
                conn.execute(
                    """
                    INSERT INTO align_links
                      (link_id, align_run_id, episode_id, segment_id, cue_id, cue_id_target, lang, role, confidence, status, meta_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(link_id) DO UPDATE SET
                      align_run_id=excluded.align_run_id,
                      episode_id=excluded.episode_id,
                      segment_id=excluded.segment_id,
                      cue_id=excluded.cue_id,
                      cue_id_target=excluded.cue_id_target,
                      lang=excluded.lang,
                      role=excluded.role,
                      confidence=excluded.confidence,
                      status=excluded.status,
                      meta_json=excluded.meta_json
                    """,
                    (
                        link.get("link_id"),
                        link.get("align_run_id"),
                        link.get("episode_id"),
                        link.get("segment_id"),
                        link.get("cue_id"),
                        link.get("cue_id_target"),
                        link.get("lang"),
                        link.get("role"),
                        link.get("confidence"),
                        link.get("status"),
                        link.get("meta_json"),
                    ),
                )
            conn.commit()

        if self.backup_file_content and self.backup_file_fmt:
            cues_audit = [
                {
                    "cue_id": cue.get("cue_id"),
                    "n": cue.get("n"),
                    "start_ms": cue.get("start_ms"),
                    "end_ms": cue.get("end_ms"),
                    "text_raw": cue.get("text_raw"),
                    "text_clean": cue.get("text_clean"),
                }
                for cue in self.backup_cues
            ]
            self.store.save_episode_subtitles(
                self.episode_id,
                self.lang,
                self.backup_file_content,
                self.backup_file_fmt,
                cues_audit,
            )


class CallbackUndoCommand(QUndoCommand):
    """Commande Undo/Redo générique basée sur callbacks."""

    def __init__(
        self,
        description: str,
        redo_callback: Callable[[], None],
        undo_callback: Callable[[], None],
        *,
        already_applied: bool = False,
    ):
        super().__init__(description)
        self._redo_callback = redo_callback
        self._undo_callback = undo_callback
        self._already_applied = already_applied
        self._first_redo = True

    def redo(self) -> None:
        if self._first_redo and self._already_applied:
            self._first_redo = False
            return
        self._first_redo = False
        self._redo_callback()

    def undo(self) -> None:
        self._undo_callback()
