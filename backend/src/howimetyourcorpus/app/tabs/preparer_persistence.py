"""Contrôleur d'orchestration de persistance pour l'onglet Préparer."""

from __future__ import annotations

import logging
from typing import Any, Callable

from PySide6.QtWidgets import QMessageBox

from howimetyourcorpus.core.models import TransformStats


class PreparerPersistenceController:
    """Orchestre la sauvegarde courante + snapshots undo/redo."""

    def __init__(self, tab: Any, logger_obj: logging.Logger) -> None:
        self._tab = tab
        self._logger = logger_obj

    def save_clean_text_with_meta(
        self,
        episode_id: str,
        clean_text: str,
        *,
        stats: TransformStats | None = None,
        debug: dict[str, Any] | None = None,
    ) -> bool:
        """Sauvegarde clean.txt avec une méta minimale (contrat save_episode_clean complet)."""
        tab = self._tab
        store = tab._get_store()
        if not store:
            return False
        try:
            if stats is None:
                raw = store.load_episode_text(episode_id, kind="raw")
                stats = TransformStats(
                    raw_lines=len(raw.splitlines()) if raw else len(clean_text.splitlines()),
                    clean_lines=len(clean_text.splitlines()),
                    merges=0,
                    kept_breaks=0,
                    duration_ms=0,
                )
            store.save_episode_clean(
                episode_id,
                clean_text,
                stats,
                debug or {"source": "preparer", "mode": "manual_save"},
            )
            return True
        except Exception:
            self._logger.exception("Save clean text with meta")
            return False

    def _save_transcript_rows(self, episode_id: str) -> bool:
        tab = self._tab
        return tab._save_controller.save_transcript_rows(
            owner=tab,
            episode_id=episode_id,
            utterance_table=tab.utterance_table,
            text_value=tab.text_editor.toPlainText(),
        )

    def _save_cue_rows(self, episode_id: str, lang: str) -> bool:
        tab = self._tab
        strict = tab.prep_edit_timecodes_cb.isChecked() and tab.prep_strict_timecodes_cb.isChecked()
        return tab._save_controller.save_cue_rows(
            owner=tab,
            episode_id=episode_id,
            lang=lang,
            cue_table=tab.cue_table,
            strict=strict,
        )

    def _auto_update_status_after_save(self) -> None:
        tab = self._tab
        current = (tab.prep_status_combo.currentData() or "raw").strip().lower()
        if current in ("raw", "normalized"):
            tab._apply_status_value("edited", persist=True, mark_dirty=False)

    def _run_save_with_snapshot_undo(
        self,
        *,
        capture_before: Callable[[], dict[str, Any]],
        save_action: Callable[[], bool],
        capture_after: Callable[[], dict[str, Any]],
        undo_title: str,
        redo_callback: Callable[[dict[str, Any]], None],
        undo_callback: Callable[[dict[str, Any]], None],
        success_status: str,
    ) -> bool:
        tab = self._tab
        before_state = capture_before() if tab.undo_stack else {}
        ok = save_action()
        if not ok:
            return False
        self._auto_update_status_after_save()
        if tab.undo_stack:
            after_state = capture_after()
            tab._save_controller.push_snapshot_undo(
                title=undo_title,
                redo_callback=lambda st=after_state: redo_callback(st),
                undo_callback=lambda st=before_state: undo_callback(st),
            )
        tab._show_status(success_status, 3000)
        return True

    def save_current(self) -> bool:
        tab = self._tab
        episode_id = tab.prep_episode_combo.currentData()
        if not episode_id:
            return True
        try:
            if tab._current_source_key.startswith("srt_"):
                lang = tab._current_source_key.replace("srt_", "", 1)
                ok = self._run_save_with_snapshot_undo(
                    capture_before=lambda ep=episode_id, ln=lang: tab._state_controller.capture_cue_persistence_state(
                        ep, ln, tab._current_source_key
                    ),
                    save_action=lambda ep=episode_id, ln=lang: self._save_cue_rows(ep, ln),
                    capture_after=lambda ep=episode_id, ln=lang: tab._state_controller.capture_cue_persistence_state(
                        ep, ln, tab._current_source_key
                    ),
                    undo_title=f"Enregistrer cues {lang.upper()}",
                    redo_callback=lambda st, ep=episode_id, ln=lang: tab._state_controller.apply_cue_persistence_state(
                        ep, ln, st, mark_dirty=False
                    ),
                    undo_callback=lambda st, ep=episode_id, ln=lang: tab._state_controller.apply_cue_persistence_state(
                        ep, ln, st, mark_dirty=True
                    ),
                    success_status=f"Cues {lang.upper()} enregistrées et piste réécrite.",
                )
            elif tab.stack.currentWidget() == tab.utterance_table or (
                tab._current_source_key == "transcript" and tab._force_save_transcript_rows
            ):
                ok = self._run_save_with_snapshot_undo(
                    capture_before=lambda ep=episode_id: tab._state_controller.capture_utterance_persistence_state(
                        ep, tab._current_source_key
                    ),
                    save_action=lambda ep=episode_id: self._save_transcript_rows(ep),
                    capture_after=lambda ep=episode_id: tab._state_controller.capture_utterance_persistence_state(
                        ep, tab._current_source_key
                    ),
                    undo_title="Enregistrer tours",
                    redo_callback=lambda st, ep=episode_id: tab._state_controller.apply_utterance_persistence_state(
                        ep, st, mark_dirty=False
                    ),
                    undo_callback=lambda st, ep=episode_id: tab._state_controller.apply_utterance_persistence_state(
                        ep, st, mark_dirty=True
                    ),
                    success_status="Tours enregistrés.",
                )
            else:
                text = tab.text_editor.toPlainText()
                ok = self._run_save_with_snapshot_undo(
                    capture_before=lambda ep=episode_id: tab._state_controller.capture_clean_file_state(
                        ep, tab._current_source_key
                    ),
                    save_action=lambda ep=episode_id, txt=text: self.save_clean_text_with_meta(ep, txt),
                    capture_after=lambda ep=episode_id: tab._state_controller.capture_clean_file_state(
                        ep, tab._current_source_key
                    ),
                    undo_title="Enregistrer transcript clean",
                    redo_callback=lambda st, ep=episode_id: tab._state_controller.apply_clean_file_state(
                        ep, st, mark_dirty=False
                    ),
                    undo_callback=lambda st, ep=episode_id: tab._state_controller.apply_clean_file_state(
                        ep, st, mark_dirty=True
                    ),
                    success_status="Transcript clean enregistré.",
                )
            if not ok:
                abort_reason = tab._save_controller.pop_abort_reason()
                if abort_reason == "align_runs_invalidation_cancelled":
                    tab._show_status("Enregistrement annulé (alignements préservés).", 3500)
                    return False
                QMessageBox.critical(tab, "Préparer", "Échec de sauvegarde.")
                return False
            tab._force_save_transcript_rows = False
            tab._set_dirty(False)
            return True
        except Exception as exc:
            self._logger.exception("Save preparer")
            QMessageBox.critical(tab, "Préparer", f"Erreur sauvegarde: {exc}")
            return False
