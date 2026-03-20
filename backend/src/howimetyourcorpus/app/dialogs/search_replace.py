"""Dialogue simple de recherche/remplacement."""

from __future__ import annotations

from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)


class SearchReplaceDialog(QDialog):
    """Dialogue simple de recherche/remplacement."""

    def __init__(self, parent: QWidget | None = None):
        super().__init__(parent)
        self.setWindowTitle("Rechercher / Remplacer")
        layout = QVBoxLayout(self)

        row_find = QHBoxLayout()
        row_find.addWidget(QLabel("Rechercher:"))
        self.find_edit = QLineEdit()
        row_find.addWidget(self.find_edit)
        layout.addLayout(row_find)

        row_replace = QHBoxLayout()
        row_replace.addWidget(QLabel("Remplacer par:"))
        self.replace_edit = QLineEdit()
        row_replace.addWidget(self.replace_edit)
        layout.addLayout(row_replace)

        options_row = QHBoxLayout()
        self.case_sensitive_cb = QCheckBox("Respecter la casse")
        self.regex_cb = QCheckBox("Regex")
        options_row.addWidget(self.case_sensitive_cb)
        options_row.addWidget(self.regex_cb)
        options_row.addStretch()
        layout.addLayout(options_row)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def get_params(self) -> tuple[str, str, bool, bool]:
        return (
            self.find_edit.text(),
            self.replace_edit.text(),
            self.case_sensitive_cb.isChecked(),
            self.regex_cb.isChecked(),
        )
