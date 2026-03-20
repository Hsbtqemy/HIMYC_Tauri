"""Onglet Préparer : édition transcript fichier par fichier avant alignement."""

from __future__ import annotations

import logging
from typing import Any, Callable

from PySide6.QtCore import Qt
from PySide6.QtGui import QUndoStack
from PySide6.QtWidgets import (
    QMessageBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.app.tabs.preparer_actions import PreparerActionsController
from howimetyourcorpus.app.tabs.preparer_context import PreparerContextController
from howimetyourcorpus.app.tabs.preparer_edit import PreparerEditController
from howimetyourcorpus.app.tabs.preparer_persistence import PreparerPersistenceController
from howimetyourcorpus.app.tabs.preparer_save import PreparerSaveController
from howimetyourcorpus.app.tabs.preparer_state import PreparerStateController
from howimetyourcorpus.app.tabs.preparer_ui import PreparerUiBuilder
from howimetyourcorpus.core.constants import SUPPORTED_LANGUAGES
from howimetyourcorpus.app.ui_utils import require_project, require_project_and_db
from howimetyourcorpus.app.undo_commands import CallbackUndoCommand
from howimetyourcorpus.core.preparer import (
    PREP_STATUS_VALUES,
    PreparerService,
    format_ms_to_srt_time as _format_ms_to_srt_time,
    parse_srt_time_to_ms as _parse_srt_time_to_ms,
)

logger = logging.getLogger(__name__)


def parse_srt_time_to_ms(value: str) -> int:
    """Compat tests/modules: réexport local des utilitaires timecodes."""
    return _parse_srt_time_to_ms(value)


def format_ms_to_srt_time(ms: int) -> str:
    """Compat tests/modules: réexport local des utilitaires timecodes."""
    return _format_ms_to_srt_time(ms)


class PreparerTabWidget(QWidget):
    """Préparation d'un fichier: normalisation, édition, segmentation tours, sauvegarde."""

    def __init__(
        self,
        *,
        get_store: Callable[[], Any],
        get_db: Callable[[], Any],
        show_status: Callable[[str, int], None],
        on_go_alignement: Callable[[str, str], None],
        undo_stack: QUndoStack | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._show_status = show_status
        self._on_go_alignement = on_go_alignement
        self.undo_stack = undo_stack
        self._service: PreparerService | None = None
        self._dirty = False
        self._current_episode_id: str | None = None
        self._current_source_key = "transcript"
        self._current_status_value = "raw"
        self._force_save_transcript_rows = False
        self._updating_ui = False
        self._edit_role = int(Qt.ItemDataRole.UserRole) + 1
        self._actions_controller = PreparerActionsController(self, logger)
        self._persistence_controller = PreparerPersistenceController(self, logger)
        self._context_controller = PreparerContextController(self, logger)
        self._edit_controller = PreparerEditController(self)
        self._state_controller = PreparerStateController(self, valid_status_values=PREP_STATUS_VALUES)
        self._ui_builder = PreparerUiBuilder(self)
        self._save_controller = PreparerSaveController(
            get_store=self._get_store,
            get_db=self._get_db,
            build_service=self._build_service,
            normalize_cue_timecodes_display=self._normalize_cue_timecodes_display,
            undo_stack=self.undo_stack,
        )

        layout = QVBoxLayout(self)
        self._build_top_row(layout)
        self._build_actions_row(layout)
        self._build_utterance_actions_row(layout)
        self._build_help_label(layout)
        self._build_editors_stack(layout)
        self._update_utterance_action_states()

    def _build_top_row(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_top_row(layout)

    def _build_actions_row(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_actions_row(layout)

    def _build_utterance_actions_row(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_utterance_actions_row(layout)

    def _build_help_label(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_help_label(layout)

    def _build_editors_stack(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_editors_stack(layout)

    def _build_service(self) -> PreparerService | None:
        store = self._get_store()
        db = self._get_db()
        if not store or not db:
            self._service = None
            return None
        if (
            self._service is None
            or self._service.store is not store
            or self._service.db is not db
        ):
            self._service = PreparerService(store, db)
        return self._service

    def has_unsaved_changes(self) -> bool:
        return self._dirty

    def current_episode_id(self) -> str | None:
        return self._current_episode_id

    def refresh(self) -> None:
        self._context_controller.refresh()

    def set_episode_and_load(self, episode_id: str, source_key: str | None = None) -> None:
        self._context_controller.set_episode_and_load(episode_id, source_key)

    def _refresh_source_combo_items(self) -> None:
        """Synchronise les sources Préparer avec les langues projet (Transcript + SRT <lang>)."""
        current_key = (
            self.prep_source_combo.currentData()
            or self._current_source_key
            or "transcript"
        )
        store = self._get_store()
        langs_raw = store.load_project_languages() if store else list(SUPPORTED_LANGUAGES)
        langs: list[str] = []
        seen: set[str] = set()
        for lang in langs_raw or []:
            key = str(lang or "").strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            langs.append(key)
        if not langs:
            langs = list(SUPPORTED_LANGUAGES)

        self.prep_source_combo.blockSignals(True)
        self.prep_source_combo.clear()
        self.prep_source_combo.addItem("Transcript", "transcript")
        for lang in langs:
            self.prep_source_combo.addItem(f"SRT {lang.upper()}", f"srt_{lang}")
        idx = self.prep_source_combo.findData(current_key)
        self.prep_source_combo.setCurrentIndex(idx if idx >= 0 else 0)

        source_model = self.prep_source_combo.model()
        for i in range(1, self.prep_source_combo.count()):
            item = source_model.item(i) if hasattr(source_model, "item") else None
            if item is not None:
                item.setEnabled(False)
        self.prep_source_combo.blockSignals(False)

        source_key = self.prep_source_combo.currentData() or "transcript"
        self._current_source_key = str(source_key)

    def save_state(self) -> None:
        """Méthode symétrique aux autres onglets (pas d'état persistant spécifique pour l'instant)."""
        return

    def prompt_save_if_dirty(self) -> bool:
        if not self._dirty:
            return True
        msg = QMessageBox(self)
        msg.setIcon(QMessageBox.Icon.Warning)
        msg.setWindowTitle("Préparer")
        msg.setText("Modifications non enregistrées.")
        msg.setInformativeText("Voulez-vous enregistrer avant de continuer ?")
        btn_save = msg.addButton("Enregistrer", QMessageBox.ButtonRole.AcceptRole)
        btn_discard = msg.addButton("Ignorer", QMessageBox.ButtonRole.DestructiveRole)
        btn_cancel = msg.addButton("Annuler", QMessageBox.ButtonRole.RejectRole)
        msg.setDefaultButton(btn_save)
        msg.exec()
        clicked = msg.clickedButton()
        if clicked == btn_save:
            return self.save_current()
        if clicked == btn_discard:
            # Recharger l'état persistant pour réellement abandonner le brouillon.
            self._load_selected_context(force=True)
            self._set_dirty(False)
            return True
        return clicked != btn_cancel

    def _on_episode_changed(self) -> None:
        self._context_controller.on_episode_changed()

    def _on_source_changed(self) -> None:
        self._context_controller.on_source_changed()

    def _restore_episode_combo(self) -> None:
        self._context_controller.restore_episode_combo()

    def _restore_source_combo(self) -> None:
        self._context_controller.restore_source_combo()

    def _default_status_for_loaded_data(self, source_key: str, data: dict[str, Any]) -> str:
        return self._context_controller.default_status_for_loaded_data(source_key, data)

    def _apply_status_value(self, status: str, *, persist: bool, mark_dirty: bool) -> None:
        st = (status or "raw").strip().lower()
        if st not in PREP_STATUS_VALUES:
            st = "raw"
        idx = self.prep_status_combo.findData(st)
        if idx < 0:
            idx = 0
            st = self.prep_status_combo.itemData(0) or "raw"
        self.prep_status_combo.blockSignals(True)
        self.prep_status_combo.setCurrentIndex(idx)
        self.prep_status_combo.blockSignals(False)
        self._current_status_value = st
        if persist:
            store = self._get_store()
            if store and self._current_episode_id and self._current_source_key:
                store.set_episode_prep_status(self._current_episode_id, self._current_source_key, st)
        self._set_dirty(mark_dirty)

    def _on_status_changed(self) -> None:
        if self._updating_ui:
            return
        new_status = (self.prep_status_combo.currentData() or "raw").strip().lower()
        old_status = (getattr(self, "_current_status_value", "") or new_status).strip().lower()
        if new_status == old_status:
            return

        # Changement utilisateur : persistance immédiate.
        self._apply_status_value(new_status, persist=True, mark_dirty=False)
        if self.undo_stack:
            cmd = CallbackUndoCommand(
                "Changer statut préparation",
                redo_callback=lambda s=new_status: self._apply_status_value(s, persist=True, mark_dirty=False),
                undo_callback=lambda s=old_status: self._apply_status_value(s, persist=True, mark_dirty=False),
                already_applied=True,
            )
            self.undo_stack.push(cmd)
        self._show_status(f"Statut: {new_status}.", 2500)

    def _reset_empty_context(self) -> None:
        self._context_controller.reset_empty_context()

    def _load_selected_context(self, force: bool = False) -> None:
        self._context_controller.load_selected_context(force=force)

    def _set_dirty(self, dirty: bool) -> None:
        self._dirty = bool(dirty)
        self.dirty_label.setText("* brouillon" if self._dirty else "")

    def _set_text(self, text: str) -> None:
        self._transcript_widgets.set_text(text)

    def _set_utterances(self, utterances: list[dict[str, Any]]) -> None:
        self._transcript_widgets.set_utterances(
            utterances,
            character_options=self._character_choices(),
        )
        self._update_utterance_action_states()

    def set_show_per_line_status(self, show: bool) -> None:
        """Met à jour l'affichage de la colonne Statut (option menu Affichage)."""
        self._transcript_widgets.set_show_status_column(show)
        # Réafficher les tours actuels avec ou sans colonne Statut
        rows = self._transcript_widgets.export_utterance_rows()
        if rows:
            self._transcript_widgets.set_utterances(
                rows,
                character_options=self._character_choices(),
            )
        self._update_utterance_action_states()

    def _set_cues(
        self,
        cues: list[dict[str, Any]],
        *,
        episode_id: str | None = None,
        lang: str | None = None,
    ) -> None:
        episode_for_assign = episode_id or self._current_episode_id
        assign_map = self._load_assignment_map(
            source_type="cue",
            episode_id=episode_for_assign,
            prefix=f"{episode_for_assign}:{(lang or '').strip().lower()}:",
        )
        self._cue_widgets.set_cues(
            cues,
            assign_map,
            character_options=self._character_choices(),
        )
        self._apply_cue_timecode_editability()
        self._update_utterance_action_states()

    def _refresh_source_availability(self, episode_id: str | None) -> None:
        self._context_controller.refresh_source_availability(episode_id)

    def _on_edit_timecodes_toggled(self, checked: bool) -> None:
        self.prep_strict_timecodes_cb.setEnabled(bool(checked) and self.prep_edit_timecodes_cb.isEnabled())
        self._apply_cue_timecode_editability()

    def _apply_cue_timecode_editability(self) -> None:
        editable = self.prep_edit_timecodes_cb.isChecked() and self.prep_edit_timecodes_cb.isEnabled()
        self._cue_widgets.apply_timecode_editability(editable)

    def _normalize_cue_timecodes_display(self) -> None:
        self._cue_widgets.normalize_timecodes_display()

    def _apply_plain_text_value(self, text: str) -> None:
        self._edit_controller.apply_plain_text_value(text)

    def _apply_table_column_values(self, table: QTableWidget, col: int, values: list[str]) -> None:
        self._edit_controller.apply_table_column_values(table, col, values)

    def _apply_table_cell_value(self, table: QTableWidget, row: int, col: int, value: str) -> None:
        self._edit_controller.apply_table_cell_value(table, row, col, value)

    def _on_text_changed(self) -> None:
        self._edit_controller.on_text_changed()

    def _on_table_item_changed(self, item: QTableWidgetItem) -> None:
        self._edit_controller.on_table_item_changed(item)

    @require_project_and_db
    def _normalize_transcript(self) -> None:
        self._actions_controller.normalize_transcript()

    def _search_replace(self) -> None:
        self._actions_controller.search_replace()

    def _search_replace_table(
        self,
        table: QTableWidget,
        needle: str,
        repl: str,
        case_sensitive: bool,
        is_regex: bool,
        *,
        text_col: int,
    ) -> int:
        return self._edit_controller.search_replace_table(
            table,
            needle,
            repl,
            case_sensitive,
            is_regex,
            text_col=text_col,
        )

    @staticmethod
    def _replace_text(
        text: str,
        needle: str,
        repl: str,
        case_sensitive: bool,
        is_regex: bool,
    ) -> tuple[str, int]:
        return PreparerEditController.replace_text(text, needle, repl, case_sensitive, is_regex)

    def _export_utterance_rows(self) -> list[dict[str, Any]]:
        return self._transcript_widgets.export_utterance_rows()

    def _load_segmentation_options(self, episode_id: str, source_key: str) -> dict[str, Any]:
        return self._actions_controller.load_segmentation_options(episode_id, source_key)

    @require_project
    def _open_segmentation_options(self) -> None:
        self._actions_controller.open_segmentation_options()

    def _segment_to_utterances(self) -> None:
        self._edit_controller.segment_to_utterances()

    def _add_utterance_row_below(self) -> None:
        self._edit_controller.add_utterance_row_below()

    def _delete_selected_utterance_rows(self) -> None:
        self._edit_controller.delete_selected_utterance_rows()

    def _merge_selected_utterances(self) -> None:
        self._edit_controller.merge_selected_utterances()

    def _split_selected_utterance_at_cursor(self) -> None:
        self._edit_controller.split_selected_utterance_at_cursor()

    def _group_utterances_by_assignments(self) -> None:
        self._edit_controller.group_utterances_by_assignments(tolerant=True)

    def _renumber_utterances(self) -> None:
        self._edit_controller.renumber_utterances()

    def _reset_utterances_to_text(self) -> None:
        self._edit_controller.reset_utterances_to_text()

    def _update_utterance_action_states(self) -> None:
        is_transcript = self._current_source_key == "transcript"
        has_episode = bool(self.prep_episode_combo.currentData())
        has_rows = self.utterance_table.rowCount() > 0

        self.prep_segment_options_btn.setEnabled(is_transcript and has_episode)
        self.prep_add_utt_btn.setEnabled(is_transcript and has_episode)
        self.prep_delete_utt_btn.setEnabled(is_transcript and has_rows)
        self.prep_merge_utt_btn.setEnabled(is_transcript and self.utterance_table.rowCount() >= 2)
        self.prep_split_utt_btn.setEnabled(is_transcript and has_rows)
        self.prep_group_utt_btn.setEnabled(is_transcript and has_rows)
        self.prep_renumber_utt_btn.setEnabled(is_transcript and has_rows)
        self.prep_reset_utt_btn.setEnabled(is_transcript and has_rows)

    def save_clean_text_with_meta(
        self,
        episode_id: str,
        clean_text: str,
        *,
        stats: Any | None = None,
        debug: dict[str, Any] | None = None,
    ) -> bool:
        return self._persistence_controller.save_clean_text_with_meta(
            episode_id,
            clean_text,
            stats=stats,
            debug=debug,
        )

    def save_current(self) -> bool:
        return self._persistence_controller.save_current()

    def _go_to_alignement(self) -> None:
        self._actions_controller.go_to_alignement()

    def _load_assignment_map(
        self,
        *,
        source_type: str,
        episode_id: str | None,
        prefix: str,
    ) -> dict[str, str]:
        store = self._get_store()
        if not store or not episode_id:
            return {}
        out: dict[str, str] = {}
        for a in store.load_character_assignments():
            if a.get("episode_id") != episode_id:
                continue
            if a.get("source_type") != source_type:
                continue
            source_id = (a.get("source_id") or "").strip()
            if prefix and not source_id.startswith(prefix):
                continue
            out[source_id] = (a.get("character_id") or "").strip()
        return out

    def _character_choices(self) -> list[str]:
        """Valeurs proposées dans les combos Personnage (id/canonique/noms par langue)."""
        store = self._get_store()
        if not store:
            return []
        seen: set[str] = set()
        out: list[str] = []
        for ch in store.load_character_names():
            raw_values: list[str] = [
                (ch.get("id") or "").strip(),
                (ch.get("canonical") or "").strip(),
            ]
            names = ch.get("names_by_lang") or {}
            if isinstance(names, dict):
                raw_values.extend((str(v or "").strip() for v in names.values()))
            for value in raw_values:
                key = value.lower()
                if not value or key in seen:
                    continue
                seen.add(key)
                out.append(value)
        return out
