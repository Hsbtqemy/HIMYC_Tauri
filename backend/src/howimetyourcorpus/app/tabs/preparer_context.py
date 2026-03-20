"""Contrôleur de navigation et chargement de contexte pour l'onglet Préparer."""

from __future__ import annotations

import logging
from typing import Any

from PySide6.QtWidgets import QMessageBox


class PreparerContextController:
    """Orchestre la navigation épisode/source et le chargement de contexte."""

    def __init__(self, tab: Any, logger_obj: logging.Logger) -> None:
        self._tab = tab
        self._logger = logger_obj

    @staticmethod
    def default_status_for_loaded_data(source_key: str, data: dict[str, Any]) -> str:
        source = (source_key or "transcript").strip().lower()
        if source == "transcript":
            kind = (data.get("kind") or "").strip().lower()
            return "normalized" if kind == "clean" else "raw"
        if source.startswith("srt_"):
            cues = data.get("cues") or []
            for cue in cues:
                text_raw = (cue.get("text_raw") or "").strip()
                text_clean = (cue.get("text_clean") or "").strip()
                if text_clean and text_clean != text_raw:
                    return "normalized"
        return "raw"

    def refresh(self) -> None:
        tab = self._tab
        tab._refresh_source_combo_items()
        current_episode_id = tab._current_episode_id or tab.prep_episode_combo.currentData()
        tab.prep_episode_combo.blockSignals(True)
        tab.prep_episode_combo.clear()
        store = tab._get_store()
        if store:
            index = store.load_series_index()
            if index and index.episodes:
                for e in index.episodes:
                    tab.prep_episode_combo.addItem(f"{e.episode_id} - {e.title}", e.episode_id)
        if current_episode_id:
            for i in range(tab.prep_episode_combo.count()):
                if tab.prep_episode_combo.itemData(i) == current_episode_id:
                    tab.prep_episode_combo.setCurrentIndex(i)
                    break
        tab.prep_episode_combo.blockSignals(False)
        self.refresh_source_availability(current_episode_id)
        self.load_selected_context(force=True)

    def set_episode_and_load(self, episode_id: str, source_key: str | None = None) -> None:
        tab = self._tab
        tab._refresh_source_combo_items()
        if source_key:
            for i in range(tab.prep_source_combo.count()):
                if tab.prep_source_combo.itemData(i) == source_key:
                    tab.prep_source_combo.blockSignals(True)
                    tab.prep_source_combo.setCurrentIndex(i)
                    tab.prep_source_combo.blockSignals(False)
                    tab._current_source_key = source_key
                    break

        for i in range(tab.prep_episode_combo.count()):
            if tab.prep_episode_combo.itemData(i) == episode_id:
                tab.prep_episode_combo.blockSignals(True)
                tab.prep_episode_combo.setCurrentIndex(i)
                tab.prep_episode_combo.blockSignals(False)
                break
        self.refresh_source_availability(episode_id)
        self.load_selected_context(force=True)

    def on_episode_changed(self) -> None:
        tab = self._tab
        if tab._updating_ui:
            return
        if not tab.prompt_save_if_dirty():
            self.restore_episode_combo()
            return
        self.load_selected_context()

    def on_source_changed(self) -> None:
        tab = self._tab
        if tab._updating_ui:
            return
        if not tab.prompt_save_if_dirty():
            self.restore_source_combo()
            return
        self.load_selected_context()

    def restore_episode_combo(self) -> None:
        tab = self._tab
        if not tab._current_episode_id:
            return
        tab.prep_episode_combo.blockSignals(True)
        for i in range(tab.prep_episode_combo.count()):
            if tab.prep_episode_combo.itemData(i) == tab._current_episode_id:
                tab.prep_episode_combo.setCurrentIndex(i)
                break
        tab.prep_episode_combo.blockSignals(False)

    def restore_source_combo(self) -> None:
        tab = self._tab
        tab.prep_source_combo.blockSignals(True)
        for i in range(tab.prep_source_combo.count()):
            if tab.prep_source_combo.itemData(i) == tab._current_source_key:
                tab.prep_source_combo.setCurrentIndex(i)
                break
        tab.prep_source_combo.blockSignals(False)

    def refresh_source_availability(self, episode_id: str | None) -> None:
        tab = self._tab
        db = tab._get_db()
        available_langs: set[str] = set()
        if db and episode_id:
            tracks = db.get_tracks_for_episode(episode_id) or []
            available_langs = {(t.get("lang") or "").strip().lower() for t in tracks if t.get("lang")}
        source_model = tab.prep_source_combo.model()
        for i in range(1, tab.prep_source_combo.count()):
            source_key = tab.prep_source_combo.itemData(i) or ""
            lang = source_key.replace("srt_", "", 1) if source_key.startswith("srt_") else ""
            enabled = bool(lang and lang in available_langs)
            item = source_model.item(i) if hasattr(source_model, "item") else None
            if item is not None:
                item.setEnabled(enabled)

        current_idx = tab.prep_source_combo.currentIndex()
        current_key = tab.prep_source_combo.itemData(current_idx) or ""
        if current_key.startswith("srt_"):
            lang = current_key.replace("srt_", "", 1)
            if lang not in available_langs:
                tab.prep_source_combo.blockSignals(True)
                tab.prep_source_combo.setCurrentIndex(0)
                tab.prep_source_combo.blockSignals(False)

    def reset_empty_context(self) -> None:
        tab = self._tab
        tab._current_episode_id = None
        tab._force_save_transcript_rows = False
        tab._set_dirty(False)
        tab._set_text("")
        tab._set_utterances([])
        tab._set_cues([])
        tab._apply_status_value("raw", persist=False, mark_dirty=False)
        tab.prep_normalize_btn.setEnabled(False)
        tab.prep_segment_btn.setEnabled(False)
        tab.prep_edit_timecodes_cb.setEnabled(False)
        tab.prep_strict_timecodes_cb.setEnabled(False)
        tab._update_utterance_action_states()

    def load_selected_context(self, force: bool = False) -> None:
        tab = self._tab
        service = tab._build_service()
        if service is None:
            self.reset_empty_context()
            return

        episode_id = tab.prep_episode_combo.currentData()
        self.refresh_source_availability(episode_id)
        source_key = tab.prep_source_combo.currentData() or "transcript"
        if not episode_id:
            self.reset_empty_context()
            return

        if not force and episode_id == tab._current_episode_id and source_key == tab._current_source_key:
            return

        try:
            data = service.load_source(episode_id, source_key)
        except Exception as exc:
            self._logger.exception("Load source preparer")
            QMessageBox.critical(tab, "Préparer", f"Erreur chargement: {exc}")
            return

        tab._updating_ui = True
        try:
            if source_key == "transcript":
                text = data.get("text") or ""
                utterances = data.get("utterances") or []
                tab._set_text(text)
                tab._set_utterances(utterances)
                tab._set_cues([])
                tab.stack.setCurrentWidget(tab.utterance_table if utterances else tab.text_editor)
                tab.prep_normalize_btn.setEnabled(True)
                tab.prep_segment_btn.setEnabled(True)
                tab.prep_edit_timecodes_cb.setEnabled(False)
                tab.prep_strict_timecodes_cb.setEnabled(False)
            else:
                cues = data.get("cues") or []
                lang = data.get("lang") or source_key.replace("srt_", "", 1)
                tab._set_text("")
                tab._set_utterances([])
                tab._set_cues(cues, episode_id=episode_id, lang=lang)
                tab.stack.setCurrentWidget(tab.cue_table)
                tab.prep_normalize_btn.setEnabled(False)
                tab.prep_segment_btn.setEnabled(False)
                tab.prep_edit_timecodes_cb.setEnabled(True)
                tab._apply_cue_timecode_editability()
                tab.prep_strict_timecodes_cb.setEnabled(tab.prep_edit_timecodes_cb.isChecked())
        finally:
            tab._updating_ui = False

        tab._current_episode_id = episode_id
        tab._current_source_key = source_key
        tab._force_save_transcript_rows = False
        tab._update_utterance_action_states()
        store = tab._get_store()
        default_status = self.default_status_for_loaded_data(source_key, data)
        status = (
            store.get_episode_prep_status(episode_id, source_key, default=default_status)
            if store
            else default_status
        )
        tab._apply_status_value(status, persist=False, mark_dirty=False)
