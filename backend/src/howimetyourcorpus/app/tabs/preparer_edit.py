"""Contrôleur d'édition locale pour l'onglet Préparer."""

from __future__ import annotations

import re
from typing import Any

from PySide6.QtWidgets import (
    QApplication,
    QInputDialog,
    QLineEdit,
    QMessageBox,
    QTableWidget,
    QTableWidgetItem,
)

from howimetyourcorpus.app.undo_commands import CallbackUndoCommand
from howimetyourcorpus.core.preparer import (
    regroup_utterance_rows_by_character,
    segment_text_to_utterance_rows,
)


class PreparerEditController:
    """Gère les mutations UI locales, undo d'édition et opérations de texte."""

    def __init__(self, tab: Any) -> None:
        self._tab = tab

    def apply_plain_text_value(self, text: str) -> None:
        tab = self._tab
        tab._updating_ui = True
        try:
            tab._set_text(text)
        finally:
            tab._updating_ui = False
        tab._set_dirty(True)

    def apply_table_column_values(self, table: QTableWidget, col: int, values: list[str]) -> None:
        tab = self._tab
        tab._updating_ui = True
        try:
            for row, value in enumerate(values):
                if row >= table.rowCount():
                    break
                item = table.item(row, col)
                if item is None:
                    item = QTableWidgetItem("")
                    table.setItem(row, col, item)
                item.setText(value)
                item.setData(tab._edit_role, value)
        finally:
            tab._updating_ui = False
        tab._set_dirty(True)

    def apply_table_cell_value(self, table: QTableWidget, row: int, col: int, value: str) -> None:
        tab = self._tab
        tab._updating_ui = True
        try:
            if row >= table.rowCount():
                return
            item = table.item(row, col)
            if item is None:
                item = QTableWidgetItem("")
                table.setItem(row, col, item)
            item.setText(value)
            item.setData(tab._edit_role, value)
        finally:
            tab._updating_ui = False
        tab._set_dirty(True)

    def on_text_changed(self) -> None:
        tab = self._tab
        if tab._updating_ui:
            return
        tab._set_dirty(True)

    def on_table_item_changed(self, item: QTableWidgetItem) -> None:
        tab = self._tab
        if tab._updating_ui:
            return
        if item is None:
            return
        table = item.tableWidget()
        if table is None:
            return
        col = item.column()
        if table is tab.utterance_table:
            editable_cols = {1, 2}
        elif table is tab.cue_table:
            editable_cols = {1, 2, 3, 4}
        else:
            editable_cols = set()
        if col not in editable_cols:
            return

        new_value = item.text()
        old_value = item.data(tab._edit_role)
        if old_value is None:
            item.setData(tab._edit_role, new_value)
            tab._set_dirty(True)
            return
        old_value_str = str(old_value)
        if old_value_str == new_value:
            return

        row = item.row()
        item.setData(tab._edit_role, new_value)
        if tab.undo_stack:
            cmd = CallbackUndoCommand(
                f"Modifier cellule ({row + 1},{col + 1})",
                redo_callback=lambda t=table, r=row, c=col, v=new_value: self.apply_table_cell_value(t, r, c, v),
                undo_callback=lambda t=table, r=row, c=col, v=old_value_str: self.apply_table_cell_value(t, r, c, v),
                already_applied=True,
            )
            tab.undo_stack.push(cmd)
        tab._set_dirty(True)

    @staticmethod
    def replace_text(
        text: str,
        needle: str,
        repl: str,
        case_sensitive: bool,
        is_regex: bool,
    ) -> tuple[str, int]:
        if is_regex:
            flags = 0 if case_sensitive else re.IGNORECASE
            return re.subn(needle, repl, text, flags=flags)
        if case_sensitive:
            return text.replace(needle, repl), text.count(needle)
        pattern = re.compile(re.escape(needle), re.IGNORECASE)
        return pattern.subn(repl, text)

    def search_replace_table(
        self,
        table: QTableWidget,
        needle: str,
        repl: str,
        case_sensitive: bool,
        is_regex: bool,
        *,
        text_col: int,
    ) -> int:
        tab = self._tab
        before_values: list[str] = []
        after_values: list[str] = []
        count_total = 0
        for row in range(table.rowCount()):
            item = table.item(row, text_col)
            old = item.text() if item is not None else ""
            new, count = self.replace_text(old, needle, repl, case_sensitive, is_regex)
            before_values.append(old)
            after_values.append(new)
            count_total += count
        if count_total <= 0:
            return 0
        if tab.undo_stack:
            cmd = CallbackUndoCommand(
                f"Rechercher/remplacer tableau ({count_total})",
                redo_callback=lambda t=table, c=text_col, v=after_values: self.apply_table_column_values(t, c, v),
                undo_callback=lambda t=table, c=text_col, v=before_values: self.apply_table_column_values(t, c, v),
            )
            tab.undo_stack.push(cmd)
        else:
            self.apply_table_column_values(table, text_col, after_values)
        return count_total

    def _normalize_utterance_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Construit des lignes table utterance stables, renumérotées."""
        out: list[dict[str, Any]] = []
        for idx, row in enumerate(rows or []):
            out.append(
                {
                    "segment_id": (row.get("segment_id") or "").strip(),
                    "n": idx,
                    "speaker_explicit": (row.get("speaker_explicit") or "").strip(),
                    "text": (row.get("text") or "").strip(),
                }
            )
        return out

    def _replace_utterance_rows(
        self,
        rows: list[dict[str, Any]],
        *,
        mark_dirty: bool,
    ) -> None:
        tab = self._tab
        tab._updating_ui = True
        try:
            tab._set_utterances(self._normalize_utterance_rows(rows))
            tab.stack.setCurrentWidget(tab.utterance_table)
            tab._update_utterance_action_states()
        finally:
            tab._updating_ui = False
        tab._set_dirty(mark_dirty)

    def _replace_utterance_rows_exact(
        self,
        rows: list[dict[str, Any]],
        *,
        mark_dirty: bool,
    ) -> None:
        """Applique les lignes telles quelles (dont la colonne n), sans renumérotation implicite."""
        tab = self._tab
        tab._updating_ui = True
        try:
            tab._set_utterances(rows)
            tab.stack.setCurrentWidget(tab.utterance_table)
            tab._update_utterance_action_states()
        finally:
            tab._updating_ui = False
        tab._set_dirty(mark_dirty)

    def _apply_utterance_rows_with_undo(
        self,
        *,
        title: str,
        before_rows: list[dict[str, Any]],
        after_rows: list[dict[str, Any]],
        status_message: str,
    ) -> None:
        tab = self._tab
        normalized_before = self._normalize_utterance_rows(before_rows)
        normalized_after = self._normalize_utterance_rows(after_rows)

        if normalized_before == normalized_after:
            return

        if tab.undo_stack:
            tab.undo_stack.push(
                CallbackUndoCommand(
                    title,
                    redo_callback=lambda rows=normalized_after: self._replace_utterance_rows(rows, mark_dirty=True),
                    undo_callback=lambda rows=normalized_before: self._replace_utterance_rows(rows, mark_dirty=True),
                )
            )
        else:
            self._replace_utterance_rows(normalized_after, mark_dirty=True)
        tab._show_status(status_message, 3000)

    def segment_to_utterances(self) -> None:
        tab = self._tab
        episode_id = tab.prep_episode_combo.currentData()
        if not episode_id:
            QMessageBox.warning(tab, "Préparer", "Sélectionnez un épisode.")
            return
        if tab._current_source_key != "transcript":
            QMessageBox.information(tab, "Préparer", "MVP: segmentation disponible sur Transcript.")
            return

        existing = tab.utterance_table.rowCount() > 0
        if existing:
            reply = QMessageBox.question(
                tab,
                "Préparer",
                "Des tours existent déjà pour cet épisode.\n\n"
                "Re-segmenter écrasera le découpage précédent. Continuer ?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                return

        clean_text = tab.text_editor.toPlainText().strip()
        if not clean_text:
            QMessageBox.warning(tab, "Préparer", "Aucun transcript à segmenter.")
            return
        options = tab._load_segmentation_options(episode_id, tab._current_source_key)
        try:
            rows = segment_text_to_utterance_rows(clean_text, options)
        except ValueError as exc:
            QMessageBox.warning(tab, "Préparer", str(exc))
            return
        prev_rows = tab._export_utterance_rows()
        prev_widget_is_utterance = tab.stack.currentWidget() == tab.utterance_table

        def _redo() -> None:
            tab._updating_ui = True
            try:
                tab._set_utterances(self._normalize_utterance_rows(rows))
                tab.stack.setCurrentWidget(tab.utterance_table)
                tab._update_utterance_action_states()
            finally:
                tab._updating_ui = False
            tab._set_dirty(True)

        def _undo() -> None:
            tab._updating_ui = True
            try:
                tab._set_utterances(prev_rows)
                if prev_widget_is_utterance:
                    tab.stack.setCurrentWidget(tab.utterance_table)
                else:
                    tab.stack.setCurrentWidget(tab.text_editor)
                tab._update_utterance_action_states()
            finally:
                tab._updating_ui = False
            tab._set_dirty(True)

        if tab.undo_stack:
            cmd = CallbackUndoCommand(
                f"Segmenter en tours ({len(rows)})",
                redo_callback=_redo,
                undo_callback=_undo,
            )
            tab.undo_stack.push(cmd)
        else:
            _redo()
        tab._show_status(f"{len(rows)} tour(s) généré(s).", 4000)

    def add_utterance_row_below(self) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        before_rows = tab._export_utterance_rows()
        insert_after = tab.utterance_table.currentRow()
        if insert_after < 0:
            insert_after = len(before_rows) - 1
        insert_index = max(0, insert_after + 1)
        after_rows = list(before_rows)
        after_rows.insert(
            insert_index,
            {
                "segment_id": "",
                "n": insert_index,
                "speaker_explicit": "",
                "text": "",
            },
        )
        self._apply_utterance_rows_with_undo(
            title="Ajouter ligne utterance",
            before_rows=before_rows,
            after_rows=after_rows,
            status_message="Ligne ajoutée.",
        )

    @staticmethod
    def _selected_utterance_rows(table: QTableWidget) -> list[int]:
        rows = sorted({idx.row() for idx in table.selectedIndexes()})
        if rows:
            return rows
        current = table.currentRow()
        return [current] if current >= 0 else []

    def delete_selected_utterance_rows(self) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        selected = self._selected_utterance_rows(tab.utterance_table)
        if not selected:
            QMessageBox.information(tab, "Préparer", "Sélectionnez au moins une ligne à supprimer.")
            return
        before_rows = tab._export_utterance_rows()
        after_rows = [row for idx, row in enumerate(before_rows) if idx not in set(selected)]
        self._apply_utterance_rows_with_undo(
            title="Supprimer ligne(s) utterance",
            before_rows=before_rows,
            after_rows=after_rows,
            status_message=f"{len(selected)} ligne(s) supprimée(s).",
        )

    @staticmethod
    def _ask_merge_separator(parent: Any) -> str | None:
        options = ["Aucun", "Espace", "Saut de ligne"]
        selected, ok = QInputDialog.getItem(
            parent,
            "Fusionner tours",
            "Séparateur entre les textes:",
            options,
            0,
            False,
        )
        if not ok:
            return None
        if selected == "Espace":
            return " "
        if selected == "Saut de ligne":
            return "\n"
        return ""

    def merge_selected_utterances(self) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        selected = self._selected_utterance_rows(tab.utterance_table)
        if len(selected) < 2:
            QMessageBox.information(tab, "Préparer", "Sélectionnez au moins deux lignes à fusionner.")
            return
        expected = list(range(selected[0], selected[-1] + 1))
        if selected != expected:
            QMessageBox.warning(
                tab,
                "Préparer",
                "La fusion nécessite des lignes consécutives.",
            )
            return
        separator = self._ask_merge_separator(tab)
        if separator is None:
            return

        before_rows = tab._export_utterance_rows()
        grouped_rows = [before_rows[idx] for idx in selected]
        first_index = selected[0]

        merged_speaker = ""
        for row in grouped_rows:
            speaker = (row.get("speaker_explicit") or "").strip()
            if speaker:
                merged_speaker = speaker
                break
        merged_text = separator.join([(row.get("text") or "").strip() for row in grouped_rows]).strip()

        after_rows: list[dict[str, Any]] = []
        for idx, row in enumerate(before_rows):
            if idx < first_index or idx > selected[-1]:
                after_rows.append(row)
                continue
            if idx == first_index:
                after_rows.append(
                    {
                        "segment_id": "",
                        "n": first_index,
                        "speaker_explicit": merged_speaker,
                        "text": merged_text,
                    }
                )
                continue
        self._apply_utterance_rows_with_undo(
            title="Fusionner tours",
            before_rows=before_rows,
            after_rows=after_rows,
            status_message=f"{len(selected)} lignes fusionnées.",
        )

    def split_selected_utterance_at_cursor(self) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        row = tab.utterance_table.currentRow()
        col = tab.utterance_table.currentColumn()
        if row < 0 or col != 2:
            QMessageBox.information(tab, "Préparer", "Placez le curseur dans la cellule Texte à scinder.")
            return

        editor: QLineEdit | None = None
        focus_widget = QApplication.focusWidget()
        if isinstance(focus_widget, QLineEdit):
            editor = focus_widget
        else:
            for candidate in tab.utterance_table.findChildren(QLineEdit):
                if candidate.hasFocus():
                    editor = candidate
                    break
        if editor is None:
            QMessageBox.information(
                tab,
                "Préparer",
                "Entrez en mode édition dans la cellule Texte puis placez le curseur.",
            )
            return

        cursor = int(editor.cursorPosition())
        current_item = tab.utterance_table.item(row, 2)
        text = editor.text() if editor is not None else ((current_item.text() if current_item else ""))
        if cursor <= 0 or cursor >= len(text):
            QMessageBox.warning(tab, "Préparer", "Le curseur doit être au milieu du texte pour scinder la ligne.")
            return

        left = text[:cursor].strip()
        right = text[cursor:].strip()
        if not left or not right:
            QMessageBox.warning(tab, "Préparer", "Scission impossible: une des deux parties est vide.")
            return

        before_rows = tab._export_utterance_rows()
        if 0 <= row < len(before_rows):
            before_rows[row]["text"] = text
        after_rows: list[dict[str, Any]] = []
        for idx, row_data in enumerate(before_rows):
            if idx != row:
                after_rows.append(row_data)
                continue
            after_rows.append(
                {
                    "segment_id": "",
                    "n": idx,
                    "speaker_explicit": (row_data.get("speaker_explicit") or "").strip(),
                    "text": left,
                }
            )
            after_rows.append(
                {
                    "segment_id": "",
                    "n": idx + 1,
                    "speaker_explicit": (row_data.get("speaker_explicit") or "").strip(),
                    "text": right,
                }
            )
        self._apply_utterance_rows_with_undo(
            title="Scinder tour",
            before_rows=before_rows,
            after_rows=after_rows,
            status_message="Ligne scindée.",
        )

    def group_utterances_by_assignments(self, *, tolerant: bool = True) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        before_rows = tab._export_utterance_rows()
        if not before_rows:
            QMessageBox.information(tab, "Préparer", "Aucune ligne à regrouper.")
            return
        character_lookup = tab._save_controller.build_character_lookup()
        episode_id = (tab.prep_episode_combo.currentData() or tab._current_episode_id or "").strip()
        assignment_map: dict[str, str] = {}
        if episode_id:
            assignment_map = tab._load_assignment_map(
                source_type="segment",
                episode_id=episode_id,
                prefix=f"{episode_id}:utterance:",
            )
        after_rows = regroup_utterance_rows_by_character(
            before_rows,
            character_lookup=character_lookup,
            assignment_by_segment_id=assignment_map,
            tolerant=tolerant,
        )
        self._apply_utterance_rows_with_undo(
            title="Regrouper par assignations",
            before_rows=before_rows,
            after_rows=after_rows,
            status_message=f"Tours regroupés: {len(before_rows)} → {len(after_rows)}.",
        )

    def renumber_utterances(self) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        before_rows = tab._export_utterance_rows()
        after_rows = []
        changed = False
        for idx, row in enumerate(before_rows):
            updated = dict(row)
            try:
                previous_n = int(updated.get("n", idx))
            except (TypeError, ValueError):
                previous_n = idx
            if previous_n != idx:
                changed = True
            updated["n"] = idx
            after_rows.append(updated)
        if not changed:
            tab._show_status("Renumérotation déjà à jour.", 2500)
            return

        if tab.undo_stack:
            tab.undo_stack.push(
                CallbackUndoCommand(
                    "Renuméroter tours",
                    redo_callback=lambda rows=after_rows: self._replace_utterance_rows_exact(rows, mark_dirty=True),
                    undo_callback=lambda rows=before_rows: self._replace_utterance_rows_exact(rows, mark_dirty=True),
                )
            )
        else:
            self._replace_utterance_rows_exact(after_rows, mark_dirty=True)
        tab._show_status("Renumérotation appliquée.", 3000)

    def reset_utterances_to_text(self) -> None:
        tab = self._tab
        if tab._current_source_key != "transcript":
            return
        before_rows = tab._export_utterance_rows()
        if not before_rows:
            tab.stack.setCurrentWidget(tab.text_editor)
            tab._update_utterance_action_states()
            return
        previous_force = bool(getattr(tab, "_force_save_transcript_rows", False))

        def _redo() -> None:
            tab._updating_ui = True
            try:
                tab._set_utterances([])
                tab.stack.setCurrentWidget(tab.text_editor)
                tab._force_save_transcript_rows = True
                tab._update_utterance_action_states()
            finally:
                tab._updating_ui = False
            tab._set_dirty(True)

        def _undo() -> None:
            tab._updating_ui = True
            try:
                tab._set_utterances(before_rows)
                tab.stack.setCurrentWidget(tab.utterance_table)
                tab._force_save_transcript_rows = previous_force
                tab._update_utterance_action_states()
            finally:
                tab._updating_ui = False
            tab._set_dirty(True)

        if tab.undo_stack:
            tab.undo_stack.push(
                CallbackUndoCommand(
                    "Revenir au texte",
                    redo_callback=_redo,
                    undo_callback=_undo,
                )
            )
        else:
            _redo()
        tab._show_status("Retour au texte (tours retirés).", 3000)
