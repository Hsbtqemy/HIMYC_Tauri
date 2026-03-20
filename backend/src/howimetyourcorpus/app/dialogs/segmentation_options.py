"""Dialogue d'options de segmentation utterances (onglet Préparer)."""

from __future__ import annotations

from typing import Any

from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.core.preparer import (
    DEFAULT_SEGMENTATION_OPTIONS,
    normalize_segmentation_options,
    validate_segmentation_options,
)


class SegmentationOptionsDialog(QDialog):
    """Paramètres de segmentation spécifiques au texte/source sélectionné."""

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        initial_options: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(parent)
        self.setWindowTitle("Paramètres segmentation")
        self._build_ui()
        self._set_options(initial_options or DEFAULT_SEGMENTATION_OPTIONS)

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        info = QLabel(
            "Les règles sont enregistrées pour l'épisode/source courant.\n"
            "Elles sont utilisées au prochain clic sur « Segmenter en tours »."
        )
        info.setWordWrap(True)
        info.setStyleSheet("color: #666;")
        layout.addWidget(info)

        form = QFormLayout()
        self.speaker_regex_edit = QLineEdit()
        self.speaker_regex_edit.setPlaceholderText(
            r"^([A-Z][A-Za-z0-9_'\-]{0,24}(?:\s+[A-Z][A-Za-z0-9_'\-]{0,24}){0,2}):\s*(.*)$"
        )
        form.addRow("Regex locuteur:", self.speaker_regex_edit)

        self.enable_dash_cb = QCheckBox("Ligne commençant par tiret = nouveau tour")
        form.addRow("", self.enable_dash_cb)

        self.dash_regex_edit = QLineEdit()
        self.dash_regex_edit.setPlaceholderText(r"^[\-–—]\s*(.*)$")
        form.addRow("Regex tiret:", self.dash_regex_edit)

        self.marker_list_edit = QLineEdit()
        self.marker_list_edit.setPlaceholderText("..., …")
        form.addRow("Marqueurs de continuation:", self.marker_list_edit)

        self.merge_if_marker_cb = QCheckBox("Fusionner avec la ligne précédente si elle finit par un marqueur")
        form.addRow("", self.merge_if_marker_cb)

        self.attach_unmarked_cb = QCheckBox("Rattacher toute ligne non marquée à la précédente")
        form.addRow("", self.attach_unmarked_cb)

        layout.addLayout(form)

        row = QHBoxLayout()
        row.addStretch()
        reset_btn = QPushButton("Réinitialiser")
        reset_btn.clicked.connect(self._reset_defaults)
        row.addWidget(reset_btn)
        layout.addLayout(row)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._accept_with_validation)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _set_options(self, options: dict[str, Any]) -> None:
        normalized = normalize_segmentation_options(options)
        self.speaker_regex_edit.setText(normalized["speaker_regex"])
        self.enable_dash_cb.setChecked(bool(normalized["enable_dash_rule"]))
        self.dash_regex_edit.setText(normalized["dash_regex"])
        self.marker_list_edit.setText(", ".join(normalized["continuation_markers"]))
        self.merge_if_marker_cb.setChecked(bool(normalized["merge_if_prev_ends_with_marker"]))
        self.attach_unmarked_cb.setChecked(bool(normalized["attach_unmarked_to_previous"]))

    def _reset_defaults(self) -> None:
        self._set_options(DEFAULT_SEGMENTATION_OPTIONS)

    def get_options(self) -> dict[str, Any]:
        raw = {
            "speaker_regex": self.speaker_regex_edit.text(),
            "enable_dash_rule": self.enable_dash_cb.isChecked(),
            "dash_regex": self.dash_regex_edit.text(),
            "continuation_markers": self.marker_list_edit.text(),
            "merge_if_prev_ends_with_marker": self.merge_if_marker_cb.isChecked(),
            "attach_unmarked_to_previous": self.attach_unmarked_cb.isChecked(),
        }
        return normalize_segmentation_options(raw)

    def _accept_with_validation(self) -> None:
        options = self.get_options()
        try:
            validate_segmentation_options(options)
        except ValueError as exc:
            QMessageBox.warning(self, "Paramètres segmentation", str(exc))
            return
        self.accept()
