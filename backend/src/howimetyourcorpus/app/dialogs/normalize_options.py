"""Dialogue d'options explicites de normalisation pour l'onglet Préparer."""

from __future__ import annotations

from typing import Any

from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QSpinBox,
    QVBoxLayout,
)

from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE
from howimetyourcorpus.core.normalize.profiles import get_all_profile_ids, get_profile


class NormalizeOptionsDialog(QDialog):
    """Sélection explicite des règles de normalisation (avec preset profil)."""

    def __init__(
        self,
        parent=None,
        *,
        store: Any = None,
        default_profile_id: str = DEFAULT_NORMALIZE_PROFILE,
    ):
        super().__init__(parent)
        self.setWindowTitle("Options de normalisation")
        self._store = store
        self._custom_profiles = store.load_custom_profiles() if store else {}

        layout = QVBoxLayout(self)
        info = QLabel(
            "Choisissez un preset puis ajustez les règles avant application.\n"
            "Le résultat remplace le transcript clean de l'épisode."
        )
        info.setWordWrap(True)
        layout.addWidget(info)

        form = QFormLayout()
        self.profile_combo = QComboBox()
        self.profile_combo.addItems(get_all_profile_ids(self._custom_profiles))
        form.addRow("Preset:", self.profile_combo)

        self.merge_subtitle_breaks_cb = QCheckBox("Fusionner les césures de sous-titres")
        form.addRow(self.merge_subtitle_breaks_cb)

        self.fix_double_spaces_cb = QCheckBox("Espaces doubles → espace simple")
        form.addRow(self.fix_double_spaces_cb)

        self.fix_french_punctuation_cb = QCheckBox("Ponctuation française (; : ! ?)")
        form.addRow(self.fix_french_punctuation_cb)

        self.normalize_apostrophes_cb = QCheckBox("Normaliser les apostrophes")
        form.addRow(self.normalize_apostrophes_cb)

        self.normalize_quotes_cb = QCheckBox("Normaliser les guillemets")
        form.addRow(self.normalize_quotes_cb)

        self.strip_line_spaces_cb = QCheckBox("Supprimer espaces début/fin de ligne")
        form.addRow(self.strip_line_spaces_cb)

        self.max_merge_examples_spin = QSpinBox()
        self.max_merge_examples_spin.setRange(0, 1000)
        form.addRow("Exemples debug (max):", self.max_merge_examples_spin)

        self.case_combo = QComboBox()
        self.case_combo.addItem("Aucune", "none")
        self.case_combo.addItem("Minuscules", "lowercase")
        self.case_combo.addItem("MAJUSCULES", "UPPERCASE")
        self.case_combo.addItem("Title Case", "Title Case")
        self.case_combo.addItem("Sentence case", "Sentence case")
        form.addRow("Casse:", self.case_combo)
        layout.addLayout(form)

        self.profile_combo.currentTextChanged.connect(self._load_profile_defaults)
        self._load_profile_defaults(default_profile_id)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _load_profile_defaults(self, profile_id: str) -> None:
        profile = get_profile(profile_id, self._custom_profiles)
        if profile is None:
            return
        self.merge_subtitle_breaks_cb.setChecked(bool(profile.merge_subtitle_breaks))
        self.fix_double_spaces_cb.setChecked(bool(profile.fix_double_spaces))
        self.fix_french_punctuation_cb.setChecked(bool(profile.fix_french_punctuation))
        self.normalize_apostrophes_cb.setChecked(bool(profile.normalize_apostrophes))
        self.normalize_quotes_cb.setChecked(bool(profile.normalize_quotes))
        self.strip_line_spaces_cb.setChecked(bool(profile.strip_line_spaces))
        self.max_merge_examples_spin.setValue(int(profile.max_merge_examples_in_debug))
        idx = self.case_combo.findData(profile.case_transform)
        if idx >= 0:
            self.case_combo.setCurrentIndex(idx)

    def get_options(self) -> dict[str, Any]:
        """Retourne les options explicites choisies par l'utilisateur."""
        return {
            "profile_id": self.profile_combo.currentText() or DEFAULT_NORMALIZE_PROFILE,
            "merge_subtitle_breaks": self.merge_subtitle_breaks_cb.isChecked(),
            "fix_double_spaces": self.fix_double_spaces_cb.isChecked(),
            "fix_french_punctuation": self.fix_french_punctuation_cb.isChecked(),
            "normalize_apostrophes": self.normalize_apostrophes_cb.isChecked(),
            "normalize_quotes": self.normalize_quotes_cb.isChecked(),
            "strip_line_spaces": self.strip_line_spaces_cb.isChecked(),
            "max_merge_examples_in_debug": self.max_merge_examples_spin.value(),
            "case_transform": self.case_combo.currentData() or "none",
        }
