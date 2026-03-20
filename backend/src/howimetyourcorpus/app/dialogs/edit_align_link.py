"""Dialogue d'édition manuelle d'un lien d'alignement."""

from __future__ import annotations

from typing import Any

from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QVBoxLayout,
    QWidget,
)


def _cue_display(cue: dict[str, Any], max_len: int = 60) -> str:
    """Texte affiché pour une cue dans les listes (n + extrait)."""
    n = cue.get("n") or ""
    text = (cue.get("text_clean") or cue.get("text_raw") or "").replace("\n", " ").strip()
    if len(text) > max_len:
        text = text[:max_len] + "…"
    return f"#{n}: {text}" if text else str(cue.get("cue_id", ""))


class EditAlignLinkDialog(QDialog):
    """Dialogue pour modifier manuellement la réplique EN et/ou cible d'un lien d'alignement."""

    def __init__(
        self,
        link: dict[str, Any],
        episode_id: str,
        db: Any,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._link = link
        self._episode_id = episode_id
        self._db = db
        self.setWindowTitle("Modifier le lien d'alignement")
        layout = QVBoxLayout(self)
        form = QFormLayout()
        role = (link.get("role") or "").lower()

        cues_en = db.get_cues_for_episode_lang(episode_id, "en")
        self._combo_en = QComboBox()
        for cue in cues_en:
            self._combo_en.addItem(_cue_display(cue), cue["cue_id"])
        current_cue = link.get("cue_id")
        idx_en = next(
            (i for i in range(self._combo_en.count()) if self._combo_en.itemData(i) == current_cue),
            0,
        )
        self._combo_en.setCurrentIndex(idx_en)
        form.addRow("Réplique EN (pivot):", self._combo_en)

        self._combo_target: QComboBox | None = None
        if role == "target":
            lang = (link.get("lang") or "fr").lower()
            cues_target = db.get_cues_for_episode_lang(episode_id, lang)
            self._combo_target = QComboBox()
            for cue in cues_target:
                self._combo_target.addItem(_cue_display(cue), cue["cue_id"])
            current_target = link.get("cue_id_target")
            idx_t = next(
                (
                    i
                    for i in range(self._combo_target.count())
                    if self._combo_target.itemData(i) == current_target
                ),
                0,
            )
            self._combo_target.setCurrentIndex(idx_t)
            form.addRow(f"Réplique cible ({lang}):", self._combo_target)
        layout.addLayout(form)

        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(self._on_ok)
        bbox.rejected.connect(self.reject)
        layout.addWidget(bbox)

    def _on_ok(self) -> None:
        self.apply()
        self.accept()

    def selected_cue_id(self) -> str | None:
        return self._combo_en.itemData(self._combo_en.currentIndex())

    def selected_cue_id_target(self) -> str | None:
        if self._combo_target is not None:
            return self._combo_target.itemData(self._combo_target.currentIndex())
        return None

    def apply(self) -> None:
        """Applique l'édition du lien dans la DB."""
        link_id = self._link.get("link_id")
        if not link_id or not self._db:
            return
        cue_id = self.selected_cue_id()
        cue_id_target = self.selected_cue_id_target()
        self._db.update_align_link_cues(link_id, cue_id=cue_id, cue_id_target=cue_id_target or None)
