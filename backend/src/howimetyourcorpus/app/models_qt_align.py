"""Modèle Qt pour la table des liens d'alignement."""

from __future__ import annotations

from PySide6.QtCore import QAbstractTableModel, QModelIndex, Qt

from howimetyourcorpus.core.storage.db import CorpusDB


def _truncate(text: str, max_len: int = 55) -> str:
    if not text:
        return ""
    normalized = (text or "").replace("\n", " ")
    return (normalized[:max_len] + "…") if len(normalized) > max_len else normalized


class AlignLinksTableModel(QAbstractTableModel):
    """Modèle pour la table des liens d'alignement avec extraits de texte."""

    COLUMNS = ["link_id", "segment_id", "cue_id", "cue_id_target", "lang", "role", "confidence", "status"]
    HEADERS = [
        "Link ID",
        "Segment (extrait)",
        "Cue pivot (extrait)",
        "Cue cible (extrait)",
        "Lang",
        "Rôle",
        "Confiance",
        "Statut",
    ]

    def __init__(self, parent=None):
        super().__init__(parent)
        self._links: list[dict] = []
        self._db: CorpusDB | None = None

    def set_links(
        self,
        links: list[dict],
        db: CorpusDB | None = None,
        episode_id: str | None = None,
    ) -> None:
        self.beginResetModel()
        self._links = list(links)
        self._db = db
        if db and episode_id and links:
            segments_by_id = {
                segment["segment_id"]: (segment.get("text") or "")
                for segment in db.get_segments_for_episode(episode_id)
            }
            cues_en = {
                cue["cue_id"]: (cue.get("text_clean") or cue.get("text_raw") or "")
                for cue in db.get_cues_for_episode_lang(episode_id, "en")
            }
            langs_seen = {((link.get("lang") or "fr") or "fr").lower() for link in links}
            cues_by_lang: dict[str, dict[str, str]] = {"en": cues_en}
            for lang in langs_seen:
                if lang != "en":
                    cues_by_lang[lang] = {
                        cue["cue_id"]: (cue.get("text_clean") or cue.get("text_raw") or "")
                        for cue in db.get_cues_for_episode_lang(episode_id, lang)
                    }
            for link in self._links:
                seg_id = link.get("segment_id")
                cue_id = link.get("cue_id")
                cue_target_id = link.get("cue_id_target")
                pivot_lang = (link.get("lang") or "en").lower() if link.get("role") == "pivot" else "en"
                cue_pivot_map = cues_by_lang.get(pivot_lang, cues_en)
                link["_segment_text"] = _truncate(segments_by_id.get(seg_id, "")) if seg_id else ""
                link["_cue_text"] = _truncate(cue_pivot_map.get(cue_id, "")) if cue_id else ""
                lang = ((link.get("lang") or "fr") or "fr").lower()
                cues_target = cues_by_lang.get(lang, {})
                link["_cue_target_text"] = _truncate(cues_target.get(cue_target_id, "")) if cue_target_id else ""
        self.endResetModel()

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._links)

    def columnCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self.COLUMNS)

    def data(self, index: QModelIndex, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid() or index.row() >= len(self._links):
            return None
        row = self._links[index.row()]
        column = index.column()
        if role == Qt.ItemDataRole.DisplayRole:
            if column == 1:
                return row.get("_segment_text") or str(row.get("segment_id", ""))
            if column == 2:
                return row.get("_cue_text") or str(row.get("cue_id", ""))
            if column == 3:
                return row.get("_cue_target_text") or str(row.get("cue_id_target", ""))
            key = self.COLUMNS[column] if 0 <= column < len(self.COLUMNS) else None
            if key:
                value = row.get(key)
                return str(value) if value is not None else ""
        if role == Qt.ItemDataRole.UserRole:
            return row
        return None

    def headerData(self, section: int, orientation: Qt.Orientation, role=Qt.ItemDataRole.DisplayRole):
        if orientation == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            if 0 <= section < len(self.HEADERS):
                return self.HEADERS[section]
        return None

    def get_link_at(self, row: int) -> dict | None:
        if 0 <= row < len(self._links):
            return self._links[row]
        return None
