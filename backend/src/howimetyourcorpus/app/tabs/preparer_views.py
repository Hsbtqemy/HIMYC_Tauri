"""Sous-vues UI pour l'onglet Préparer."""

from __future__ import annotations

from typing import Any, Callable

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QHeaderView,
    QPlainTextEdit,
    QStyledItemDelegate,
    QTableWidget,
    QTableWidgetItem,
    QWidget,
)

from howimetyourcorpus.core.preparer import format_ms_to_srt_time, parse_srt_time_to_ms


class CharacterComboDelegate(QStyledItemDelegate):
    """Éditeur combo éditable pour colonnes Personnage."""

    def __init__(self, *, get_options: Callable[[], list[str]], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._get_options = get_options

    def createEditor(self, parent: QWidget, option, index):  # type: ignore[override]
        combo = QComboBox(parent)
        combo.setEditable(True)
        combo.addItem("")
        for label in self._get_options():
            combo.addItem(label)
        combo.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
        combo.setMaxVisibleItems(12)
        return combo

    def setEditorData(self, editor: QWidget, index):  # type: ignore[override]
        if not isinstance(editor, QComboBox):
            return
        raw = index.data(Qt.ItemDataRole.EditRole)
        if raw is None:
            raw = index.data(Qt.ItemDataRole.DisplayRole)
        text = str(raw or "")
        idx = editor.findText(text)
        if idx >= 0:
            editor.setCurrentIndex(idx)
        else:
            editor.setEditText(text)

    def setModelData(self, editor: QWidget, model, index):  # type: ignore[override]
        if not isinstance(editor, QComboBox):
            return
        model.setData(index, editor.currentText(), Qt.ItemDataRole.EditRole)


class TranscriptWidgets:
    """Widgets transcript: éditeur texte + table tours."""

    def __init__(
        self,
        *,
        edit_role: int,
        on_text_changed: Callable[[], None],
        on_table_item_changed: Callable[[QTableWidgetItem], None],
        show_status_column: bool = False,
    ) -> None:
        self._edit_role = edit_role
        self._character_options: list[str] = []
        self._show_status_column = show_status_column
        self.text_editor = QPlainTextEdit()
        self.text_editor.setPlaceholderText("Transcript (clean ou raw fallback)")
        self.text_editor.textChanged.connect(on_text_changed)

        self.utterance_table = QTableWidget()
        self._configure_utterance_table()
        self._update_utterance_columns()
        self.utterance_table.setItemDelegateForColumn(
            1,
            CharacterComboDelegate(
                get_options=lambda: self._character_options,
                parent=self.utterance_table,
            ),
        )
        self.utterance_table.itemChanged.connect(on_table_item_changed)
        self.utterance_table.itemChanged.connect(self._on_utterance_item_changed)

    def _configure_utterance_table(self) -> None:
        table = self.utterance_table
        table.setWordWrap(True)
        table.setTextElideMode(Qt.TextElideMode.ElideNone)
        table.verticalHeader().setDefaultSectionSize(24)
        table.verticalHeader().setMinimumSectionSize(22)
        table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().sectionResized.connect(lambda *_: table.resizeRowsToContents())

    def _apply_utterance_header_modes(self) -> None:
        header = self.utterance_table.horizontalHeader()
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        if self._show_status_column:
            header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)

    def _update_utterance_columns(self) -> None:
        """Met à jour le nombre de colonnes et les en-têtes selon l'option statut par ligne."""
        if self._show_status_column:
            self.utterance_table.setColumnCount(4)
            self.utterance_table.setHorizontalHeaderLabels(["#", "Personnage", "Texte", "Statut"])
        else:
            self.utterance_table.setColumnCount(3)
            self.utterance_table.setHorizontalHeaderLabels(["#", "Personnage", "Texte"])
        self._apply_utterance_header_modes()

    def set_show_status_column(self, show: bool) -> None:
        """Active ou désactive la colonne Statut (option Phase 3.2)."""
        if self._show_status_column == show:
            return
        self._show_status_column = show
        self._update_utterance_columns()

    def set_text(self, text: str) -> None:
        self.text_editor.blockSignals(True)
        self.text_editor.setPlainText(text or "")
        self.text_editor.document().setModified(False)
        self.text_editor.blockSignals(False)

    def set_utterances(
        self,
        utterances: list[dict[str, Any]],
        *,
        character_options: list[str] | None = None,
    ) -> None:
        if character_options is not None:
            self._character_options = list(character_options)
        self.utterance_table.blockSignals(True)
        self._update_utterance_columns()
        self.utterance_table.setRowCount(0)
        for seg in utterances:
            row = self.utterance_table.rowCount()
            self.utterance_table.insertRow(row)
            n_item = QTableWidgetItem(str(seg.get("n", row)))
            n_item.setData(Qt.ItemDataRole.UserRole, seg.get("segment_id") or "")
            n_item.setFlags(n_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.utterance_table.setItem(row, 0, n_item)
            speaker_item = QTableWidgetItem(seg.get("speaker_explicit") or "")
            speaker_item.setData(self._edit_role, speaker_item.text())
            self.utterance_table.setItem(row, 1, speaker_item)
            text_item = QTableWidgetItem(seg.get("text") or "")
            text_item.setData(self._edit_role, text_item.text())
            self.utterance_table.setItem(row, 2, text_item)
            if self._show_status_column:
                status_item = QTableWidgetItem(seg.get("status", "—"))
                status_item.setFlags(status_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.utterance_table.setItem(row, 3, status_item)
        self.utterance_table.blockSignals(False)
        self._refresh_utterance_layout()

    def _refresh_utterance_layout(self) -> None:
        self.utterance_table.resizeColumnToContents(0)
        self.utterance_table.resizeColumnToContents(1)
        if self._show_status_column:
            self.utterance_table.resizeColumnToContents(3)
        self.utterance_table.resizeRowsToContents()

    def _on_utterance_item_changed(self, item: QTableWidgetItem) -> None:
        if item is None:
            return
        row = item.row()
        self.utterance_table.resizeRowToContents(row)
        if item.column() in {0, 1, 3}:
            self.utterance_table.resizeColumnToContents(item.column())

    def export_utterance_rows(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for row in range(self.utterance_table.rowCount()):
            n_item = self.utterance_table.item(row, 0)
            speaker_item = self.utterance_table.item(row, 1)
            text_item = self.utterance_table.item(row, 2)
            out = {
                "segment_id": (n_item.data(Qt.ItemDataRole.UserRole) if n_item else "") or "",
                "n": int((n_item.text() if n_item else row) or row),
                "speaker_explicit": (speaker_item.text() if speaker_item else "") or "",
                "text": (text_item.text() if text_item else "") or "",
            }
            if self._show_status_column:
                status_item = self.utterance_table.item(row, 3)
                out["status"] = (status_item.text() if status_item else "") or "—"
            rows.append(out)
        return rows


class CueWidgets:
    """Widgets sous-titres: table cues + utilitaires timecodes."""

    def __init__(
        self,
        *,
        edit_role: int,
        on_table_item_changed: Callable[[QTableWidgetItem], None],
    ) -> None:
        self._edit_role = edit_role
        self._character_options: list[str] = []
        self.cue_table = QTableWidget()
        self._configure_cue_table()
        self.cue_table.setColumnCount(5)
        self.cue_table.setHorizontalHeaderLabels(["#", "Début", "Fin", "Personnage", "Texte"])
        self._apply_cue_header_modes()
        self.cue_table.setItemDelegateForColumn(
            3,
            CharacterComboDelegate(
                get_options=lambda: self._character_options,
                parent=self.cue_table,
            ),
        )
        self.cue_table.itemChanged.connect(on_table_item_changed)
        self.cue_table.itemChanged.connect(self._on_cue_item_changed)

    def _configure_cue_table(self) -> None:
        table = self.cue_table
        table.setWordWrap(True)
        table.setTextElideMode(Qt.TextElideMode.ElideNone)
        table.verticalHeader().setDefaultSectionSize(24)
        table.verticalHeader().setMinimumSectionSize(22)
        table.verticalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().sectionResized.connect(lambda *_: table.resizeRowsToContents())

    def _apply_cue_header_modes(self) -> None:
        header = self.cue_table.horizontalHeader()
        header.setStretchLastSection(False)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)

    def set_cues(
        self,
        cues: list[dict[str, Any]],
        assign_map: dict[str, str],
        *,
        character_options: list[str] | None = None,
    ) -> None:
        if character_options is not None:
            self._character_options = list(character_options)
        self.cue_table.blockSignals(True)
        self.cue_table.setRowCount(0)
        for cue in cues:
            row = self.cue_table.rowCount()
            self.cue_table.insertRow(row)
            n_item = QTableWidgetItem(str(cue.get("n", row)))
            n_item.setData(Qt.ItemDataRole.UserRole, cue.get("cue_id") or "")
            n_item.setFlags(n_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.cue_table.setItem(row, 0, n_item)

            start_item = QTableWidgetItem(format_ms_to_srt_time(int(cue.get("start_ms") or 0)))
            start_item.setData(Qt.ItemDataRole.UserRole, int(cue.get("start_ms") or 0))
            start_item.setData(self._edit_role, start_item.text())
            self.cue_table.setItem(row, 1, start_item)

            end_item = QTableWidgetItem(format_ms_to_srt_time(int(cue.get("end_ms") or 0)))
            end_item.setData(Qt.ItemDataRole.UserRole, int(cue.get("end_ms") or 0))
            end_item.setData(self._edit_role, end_item.text())
            self.cue_table.setItem(row, 2, end_item)

            cue_id = cue.get("cue_id") or ""
            speaker_item = QTableWidgetItem(assign_map.get(cue_id, ""))
            speaker_item.setData(self._edit_role, speaker_item.text())
            self.cue_table.setItem(row, 3, speaker_item)
            text_item = QTableWidgetItem(cue.get("text_clean") or cue.get("text_raw") or "")
            text_item.setData(self._edit_role, text_item.text())
            self.cue_table.setItem(row, 4, text_item)
        self.cue_table.blockSignals(False)
        self._refresh_cue_layout()

    def _refresh_cue_layout(self) -> None:
        for col in (0, 1, 2, 3):
            self.cue_table.resizeColumnToContents(col)
        self.cue_table.resizeRowsToContents()

    def _on_cue_item_changed(self, item: QTableWidgetItem) -> None:
        if item is None:
            return
        row = item.row()
        self.cue_table.resizeRowToContents(row)
        if item.column() in {0, 1, 2, 3}:
            self.cue_table.resizeColumnToContents(item.column())

    def apply_timecode_editability(self, editable: bool) -> None:
        self.cue_table.blockSignals(True)
        try:
            for row in range(self.cue_table.rowCount()):
                start_item = self.cue_table.item(row, 1)
                end_item = self.cue_table.item(row, 2)
                for item in (start_item, end_item):
                    if item is None:
                        continue
                    flags = item.flags()
                    if editable:
                        item.setFlags(flags | Qt.ItemFlag.ItemIsEditable)
                    else:
                        item.setFlags(flags & ~Qt.ItemFlag.ItemIsEditable)
        finally:
            self.cue_table.blockSignals(False)

    def normalize_timecodes_display(self) -> None:
        """Normalise l'affichage des timecodes après validation/sauvegarde."""
        self.cue_table.blockSignals(True)
        try:
            for row in range(self.cue_table.rowCount()):
                start_item = self.cue_table.item(row, 1)
                end_item = self.cue_table.item(row, 2)
                if start_item is None or end_item is None:
                    continue
                try:
                    start_ms = parse_srt_time_to_ms(start_item.text())
                    end_ms = parse_srt_time_to_ms(end_item.text())
                except ValueError:
                    continue
                start_item.setText(format_ms_to_srt_time(start_ms))
                end_item.setText(format_ms_to_srt_time(end_ms))
                start_item.setData(Qt.ItemDataRole.UserRole, start_ms)
                end_item.setData(Qt.ItemDataRole.UserRole, end_ms)
        finally:
            self.cue_table.blockSignals(False)
