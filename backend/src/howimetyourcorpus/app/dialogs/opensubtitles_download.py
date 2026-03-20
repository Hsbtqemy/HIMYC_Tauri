"""Dialogue pour télécharger des sous-titres depuis OpenSubtitles (P2 §6.2)."""

from __future__ import annotations

from howimetyourcorpus.core.constants import SUPPORTED_LANGUAGES
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QVBoxLayout,
    QWidget,
)


class OpenSubtitlesDownloadDialog(QDialog):
    """
    Collecte : clé API, IMDb série, langue, épisodes sélectionnés.
    Résultat : (api_key, imdb_id, lang, [(episode_id, season, episode), ...]).
    """

    def __init__(
        self,
        parent: QWidget | None,
        episode_refs: list[tuple[str, int, int]],
        api_key: str = "",
        series_imdb_id: str = "",
        languages: list[str] | None = None,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle("Télécharger sous-titres depuis OpenSubtitles")
        self.episode_refs = episode_refs
        self.result: tuple[str, str, str, list[tuple[str, int, int]]] | None = None

        langs = languages if languages else list(SUPPORTED_LANGUAGES)
        layout = QVBoxLayout(self)

        form = QFormLayout()
        self.api_key_edit = QLineEdit()
        self.api_key_edit.setPlaceholderText("Votre clé API OpenSubtitles")
        self.api_key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.api_key_edit.setText(api_key or "")
        self.api_key_edit.setToolTip(
            "Clé API gratuite sur opensubtitles.com (profil développeur). Sauvegardée dans config.toml."
        )
        form.addRow("Clé API:", self.api_key_edit)

        self.imdb_edit = QLineEdit()
        self.imdb_edit.setPlaceholderText("ex. tt0460649 (How I Met Your Mother)")
        self.imdb_edit.setText(series_imdb_id or "")
        self.imdb_edit.setToolTip("IMDb ID de la série (ex. tt0460649). Sauvegardé dans config.toml.")
        form.addRow("IMDb série:", self.imdb_edit)

        self.lang_combo = QComboBox()
        self.lang_combo.addItems(langs)
        form.addRow("Langue:", self.lang_combo)
        layout.addLayout(form)

        layout.addWidget(QLabel("Épisodes à télécharger:"))
        self.episode_list = QListWidget()
        self.episode_list.setSelectionMode(QListWidget.SelectionMode.MultiSelection)
        for ep_id, season, episode in episode_refs:
            item = QListWidgetItem(f"{ep_id} — S{season:02d}E{episode:02d}")
            item.setData(Qt.ItemDataRole.UserRole, (ep_id, season, episode))
            self.episode_list.addItem(item)
        layout.addWidget(self.episode_list)

        self.select_all_cb = QCheckBox("Tout sélectionner")
        self.select_all_cb.stateChanged.connect(self._on_select_all)
        layout.addWidget(self.select_all_cb)

        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(self._accept)
        bbox.rejected.connect(self.reject)
        layout.addWidget(bbox)

    def _on_select_all(self, state: int) -> None:
        for i in range(self.episode_list.count()):
            self.episode_list.item(i).setSelected(state == Qt.CheckState.Checked.value)

    def _accept(self) -> None:
        api_key = self.api_key_edit.text().strip()
        imdb_id = self.imdb_edit.text().strip()
        lang = (self.lang_combo.currentData() or self.lang_combo.currentText() or "en").strip().lower()
        selected = []
        for i in range(self.episode_list.count()):
            item = self.episode_list.item(i)
            if item and item.isSelected():
                data = item.data(Qt.ItemDataRole.UserRole)
                if isinstance(data, (list, tuple)) and len(data) >= 3:
                    selected.append((str(data[0]), int(data[1]), int(data[2])))
        if not api_key:
            QMessageBox.warning(self, "OpenSubtitles", "Indiquez la clé API OpenSubtitles.")
            return
        if not imdb_id:
            QMessageBox.warning(self, "OpenSubtitles", "Indiquez l'IMDb ID de la série.")
            return
        if not selected:
            QMessageBox.warning(self, "OpenSubtitles", "Sélectionnez au moins un épisode.")
            return
        self.result = (api_key, imdb_id, lang, selected)
        self.accept()
