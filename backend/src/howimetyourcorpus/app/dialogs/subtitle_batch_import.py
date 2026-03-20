"""Dialogue pour mapper fichiers SRT/VTT → épisode + langue puis lancer l'import en masse. §11 : option appliquer profil à l'import."""

from __future__ import annotations

from pathlib import Path

from howimetyourcorpus.core.constants import SUPPORTED_LANGUAGES

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)


class SubtitleBatchImportDialog(QDialog):
    """Dialogue pour mapper fichiers SRT/VTT → épisode + langue puis lancer l'import en masse."""

    def __init__(
        self,
        parent: QWidget | None,
        episode_ids: list[str],
        rows: list[tuple[str, str | None, str | None]],
        languages: list[str] | None = None,
        profile_ids: list[str] | None = None,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle("Importer SRT en masse")
        self.episode_ids = episode_ids
        self.rows = rows  # (path, episode_id_guess, lang_guess)
        self.result: list[tuple[str, str, str]] = []  # (path, episode_id, lang) après validation
        self.profile_id_for_import: str | None = None  # §11 : profil à appliquer à l'import (si coché)
        langs = languages if languages else list(SUPPORTED_LANGUAGES)
        layout = QVBoxLayout(self)
        profile_row = QHBoxLayout()
        self.apply_profile_on_import_cb = QCheckBox("Appliquer le profil à l'import")
        self.apply_profile_on_import_cb.setToolTip("§11 — Applique le profil choisi à chaque piste après import (text_clean en base).")
        self.apply_profile_on_import_cb.setChecked(False)
        profile_row.addWidget(self.apply_profile_on_import_cb)
        self.profile_combo = QComboBox()
        self.profile_combo.addItem("—", "")
        for pid in profile_ids or []:
            self.profile_combo.addItem(pid, pid)
        profile_row.addWidget(self.profile_combo)
        profile_row.addStretch()
        layout.addLayout(profile_row)
        layout.addWidget(QLabel("Vérifiez ou corrigez l'épisode et la langue pour chaque fichier, puis cliquez Importer."))
        self.table = QTableWidget()
        self.table.setColumnCount(3)
        self.table.setHorizontalHeaderLabels(["Fichier", "Épisode", "Langue"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        for i, (path_str, ep_guess, lang_guess) in enumerate(rows):
            self.table.insertRow(i)
            item = QTableWidgetItem(Path(path_str).name)
            item.setData(Qt.ItemDataRole.UserRole, path_str)
            item.setToolTip(path_str)
            self.table.setItem(i, 0, item)
            combo_ep = QComboBox()
            combo_ep.setEditable(True)
            combo_ep.addItem("—", "")
            if ep_guess and ep_guess not in episode_ids:
                combo_ep.addItem(ep_guess, ep_guess)
            for eid in episode_ids:
                combo_ep.addItem(eid, eid)
            if ep_guess:
                idx = combo_ep.findData(ep_guess)
                if idx >= 0:
                    combo_ep.setCurrentIndex(idx)
                else:
                    combo_ep.setCurrentText(ep_guess)
            self.table.setCellWidget(i, 1, combo_ep)
            combo_lang = QComboBox()
            for lang in langs:
                combo_lang.addItem(lang, lang)
            if lang_guess and lang_guess in langs:
                combo_lang.setCurrentText(lang_guess)
            self.table.setCellWidget(i, 2, combo_lang)
        layout.addWidget(self.table)
        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(self._accept)
        bbox.rejected.connect(self.reject)
        layout.addWidget(bbox)

    def _accept(self) -> None:
        self.profile_id_for_import = None
        if self.apply_profile_on_import_cb.isChecked():
            pid = (self.profile_combo.currentData() or self.profile_combo.currentText() or "").strip()
            if pid:
                self.profile_id_for_import = pid
        self.result = []
        for i in range(self.table.rowCount()):
            path_item = self.table.item(i, 0)
            path_str = (path_item.data(Qt.ItemDataRole.UserRole) or path_item.text() or "").strip() if path_item else ""
            combo_ep = self.table.cellWidget(i, 1)
            combo_lang = self.table.cellWidget(i, 2)
            if not isinstance(combo_ep, QComboBox) or not isinstance(combo_lang, QComboBox):
                continue
            ep = (combo_ep.currentData() or combo_ep.currentText() or "").strip()
            lang = (combo_lang.currentData() or combo_lang.currentText() or "").strip()
            if ep in ("", "—") or not ep:
                ep = ""
            if path_str and ep and lang:
                self.result.append((path_str, ep, lang))
        if not self.result:
            QMessageBox.warning(self, "Import", "Indiquez au moins un fichier avec épisode et langue.")
            return
        self.accept()
