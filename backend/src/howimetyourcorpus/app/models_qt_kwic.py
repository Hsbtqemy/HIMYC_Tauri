"""Modèle Qt pour les résultats KWIC."""

from __future__ import annotations

from PySide6.QtCore import QAbstractTableModel, QModelIndex, Qt

from howimetyourcorpus.core.storage.db import KwicHit


class KwicTableModel(QAbstractTableModel):
    """Modèle pour les résultats KWIC (épisode, titre, gauche, match, droite)."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._hits: list[KwicHit] = []
        self._search_term: str = ""

    def set_hits(self, hits: list[KwicHit], search_term: str = "") -> None:
        self.beginResetModel()
        self._hits = list(hits)
        self._search_term = search_term
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._hits)

    def columnCount(self, parent=QModelIndex()):
        return 5

    def data(self, index: QModelIndex, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid() or index.row() >= len(self._hits):
            return None
        hit = self._hits[index.row()]
        if role == Qt.ItemDataRole.DisplayRole:
            return [hit.episode_id, hit.title, hit.left, hit.match, hit.right][index.column()]
        if role == Qt.ItemDataRole.UserRole:
            return hit
        if role == Qt.ItemDataRole.BackgroundRole and index.column() == 3:
            from PySide6.QtGui import QBrush, QColor

            return QBrush(QColor("#FFEB3B"))
        if role == Qt.ItemDataRole.ForegroundRole and index.column() == 3:
            from PySide6.QtGui import QBrush, QColor

            return QBrush(QColor("#000000"))
        return None

    def headerData(self, section: int, orientation: Qt.Orientation, role=Qt.ItemDataRole.DisplayRole):
        if orientation == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            return ["Épisode", "Titre", "Contexte gauche", "Match", "Contexte droit"][section]
        return None

    def get_hit_at(self, row: int) -> KwicHit | None:
        if 0 <= row < len(self._hits):
            return self._hits[row]
        return None

    def get_all_hits(self) -> list[KwicHit]:
        """Retourne la liste complète des résultats KWIC (pour export)."""
        return list(self._hits)
