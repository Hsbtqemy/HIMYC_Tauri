"""Modèles Qt pour épisodes (table, arbre) et proxys de filtre."""

from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import QAbstractItemModel, QAbstractTableModel, QModelIndex, QSortFilterProxyModel, Qt

from howimetyourcorpus.app.models_qt_common import (
    build_episode_series_map,
    compute_episode_text_presence,
)
from howimetyourcorpus.core.models import EpisodeRef, EpisodeStatus
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore

logger = logging.getLogger(__name__)


def _node_season(node: tuple) -> int | None:
    """Retourne le numéro de saison si `node == ('season', sn)` sinon None."""
    if isinstance(node, tuple) and len(node) >= 2 and node[0] == "season":
        return node[1]
    return None


def _node_episode(node: tuple) -> EpisodeRef | None:
    """Retourne l'épisode si `node == ('episode', EpisodeRef)` sinon None."""
    if isinstance(node, tuple) and len(node) >= 2 and node[0] == "episode":
        return node[1]
    return None


class EpisodesTreeModel(QAbstractItemModel):
    """Modèle d'arbre : racine → Saisons → Épisodes."""

    COLUMNS = ["checked", "series", "episode_id", "season", "episode", "title", "status", "srt", "aligned"]
    HEADERS = ["", "Série", "ID", "Saison", "Épisode", "Titre", "Statut", "SRT", "Aligné"]
    COL_CHECKED = 0
    COL_SERIES = 1

    def __init__(self, parent=None):
        super().__init__(parent)
        self._episodes: list[EpisodeRef] = []
        self._season_numbers: list[int] = []
        self._season_episodes: dict[int, list[EpisodeRef]] = {}
        self._status_map: dict[str, str] = {}
        self._srt_map: dict[str, str] = {}
        self._align_map: dict[str, str] = {}
        self._series_map: dict[str, str] = {}
        self._checked: set[str] = set()
        self._store: ProjectStore | None = None
        self._db: CorpusDB | None = None

    def set_store(self, store: ProjectStore | None) -> None:
        self._store = store
        self._refresh_status()

    def set_db(self, db: CorpusDB | None) -> None:
        self._db = db
        self._refresh_status()

    def set_episodes(self, episodes: list[EpisodeRef]) -> None:
        self.beginResetModel()
        self._episodes = list(episodes)
        self._season_numbers = sorted({ref.season for ref in self._episodes})
        self._season_episodes = {}
        for ref in self._episodes:
            self._season_episodes.setdefault(ref.season, []).append(ref)
        for season in self._season_episodes:
            self._season_episodes[season].sort(key=lambda ref: (ref.season, ref.episode))
        self._build_series_map()
        self._refresh_status()
        self.endResetModel()

    def _build_series_map(self) -> None:
        self._series_map = build_episode_series_map(self._episodes, self._store)

    def _refresh_status(self) -> None:
        try:
            self._status_map.clear()
            self._srt_map.clear()
            self._align_map.clear()
            if not self._episodes:
                return
            indexed = set(self._db.get_episode_ids_indexed()) if self._db else set()
            episode_ids = [ref.episode_id for ref in self._episodes]
            raw_ids, clean_ids = compute_episode_text_presence(self._store, episode_ids)
            tracks_by_episode = self._db.get_tracks_for_episodes(episode_ids) if self._db else {}
            runs_by_episode = self._db.get_align_runs_for_episodes(episode_ids) if self._db else {}
            for ref in self._episodes:
                status = EpisodeStatus.NEW.value
                if ref.episode_id in raw_ids:
                    status = EpisodeStatus.FETCHED.value
                if ref.episode_id in clean_ids:
                    status = EpisodeStatus.NORMALIZED.value
                if ref.episode_id in indexed:
                    status = EpisodeStatus.INDEXED.value
                self._status_map[ref.episode_id] = status
                if self._db:
                    tracks = tracks_by_episode.get(ref.episode_id, [])
                    langs = sorted({track.get("lang", "") for track in tracks if track.get("lang")})
                    self._srt_map[ref.episode_id] = ", ".join(langs) if langs else "—"
                    runs = runs_by_episode.get(ref.episode_id, [])
                    self._align_map[ref.episode_id] = "oui" if runs else "—"
                else:
                    self._srt_map[ref.episode_id] = "—"
                    self._align_map[ref.episode_id] = "—"
        except Exception:
            logger.exception("Error in EpisodesTreeModel._refresh_status()")

    def _node(self, index: QModelIndex) -> tuple | None:
        if not index.isValid():
            return None
        return index.internalPointer()

    def index(self, row: int, column: int, parent: QModelIndex = QModelIndex()) -> QModelIndex:
        if row < 0 or column < 0 or column >= len(self.COLUMNS):
            return QModelIndex()
        node = self._node(parent)
        if node is None:
            if row >= len(self._season_numbers):
                return QModelIndex()
            return self.createIndex(row, column, ("season", self._season_numbers[row]))
        season_number = _node_season(node)
        if season_number is not None:
            episodes = self._season_episodes.get(season_number, [])
            if row >= len(episodes):
                return QModelIndex()
            return self.createIndex(row, column, ("episode", episodes[row]))
        return QModelIndex()

    def parent(self, index: QModelIndex) -> QModelIndex:
        if not index.isValid():
            return QModelIndex()
        node = index.internalPointer()
        ref = _node_episode(node)
        if ref is not None:
            try:
                row = self._season_numbers.index(ref.season)
                return self.createIndex(row, 0, ("season", ref.season))
            except ValueError as exc:
                logger.debug(
                    "EpisodesTreeModel.parent: season %s introuvable pour %s (%s)",
                    ref.season,
                    ref.episode_id,
                    exc,
                )
        return QModelIndex()

    def rowCount(self, parent: QModelIndex = QModelIndex()) -> int:
        node = self._node(parent)
        if node is None:
            return len(self._season_numbers)
        season_number = _node_season(node)
        if season_number is not None:
            return len(self._season_episodes.get(season_number, []))
        return 0

    def columnCount(self, parent: QModelIndex = QModelIndex()) -> int:
        return len(self.COLUMNS)

    def data(self, index: QModelIndex, role=Qt.ItemDataRole.DisplayRole) -> Any:
        if not index.isValid():
            return None
        node = index.internalPointer()
        column = index.column()
        season_number = _node_season(node)
        ref = _node_episode(node)
        if season_number is not None:
            if role == Qt.ItemDataRole.DisplayRole and column == 2:
                return f"Saison {season_number}"
            return None
        if ref is None:
            return None
        if column == self.COL_CHECKED and role == Qt.ItemDataRole.CheckStateRole:
            return Qt.CheckState.Checked if ref.episode_id in self._checked else Qt.CheckState.Unchecked
        if role == Qt.ItemDataRole.DisplayRole:
            if column == self.COL_SERIES:
                return self._series_map.get(ref.episode_id, "—")
            if column == 2:
                return ref.episode_id
            if column == 3:
                return ref.season
            if column == 4:
                return ref.episode
            if column == 5:
                return ref.title or ""
            if column == 6:
                return self._status_map.get(ref.episode_id, EpisodeStatus.NEW.value)
            if column == 7:
                return self._srt_map.get(ref.episode_id, "—")
            if column == 8:
                return self._align_map.get(ref.episode_id, "—")
        return None

    def setData(self, index: QModelIndex, value: Any, role=Qt.ItemDataRole.EditRole) -> bool:
        if not index.isValid() or index.column() != self.COL_CHECKED or role != Qt.ItemDataRole.CheckStateRole:
            return False
        ref = _node_episode(index.internalPointer())
        if ref is None:
            return False
        if value == Qt.CheckState.Checked.value or value == Qt.CheckState.Checked:
            self._checked.add(ref.episode_id)
        else:
            self._checked.discard(ref.episode_id)
        self.dataChanged.emit(index, index, [Qt.ItemDataRole.CheckStateRole])
        return True

    def flags(self, index: QModelIndex) -> Qt.ItemFlag:
        if not index.isValid():
            return super().flags(index)
        flags = super().flags(index)
        ref = _node_episode(index.internalPointer())
        if ref is not None and index.column() == self.COL_CHECKED:
            return flags | Qt.ItemFlag.ItemIsUserCheckable
        return flags

    def headerData(self, section: int, orientation: Qt.Orientation, role=Qt.ItemDataRole.DisplayRole) -> Any:
        if orientation == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            if 0 <= section < len(self.HEADERS):
                return self.HEADERS[section]
        return None

    def get_episode_id_for_index(self, index: QModelIndex) -> str | None:
        """Retourne l'episode_id pour un index (épisode uniquement)."""
        ref = _node_episode(index.internalPointer() if index.isValid() else None)
        return ref.episode_id if ref else None

    def get_episode_ids_selection(self, indices: list[QModelIndex]) -> list[str]:
        ids: list[str] = []
        for index in indices:
            if index.isValid():
                episode_id = self.get_episode_id_for_index(index)
                if episode_id and episode_id not in ids:
                    ids.append(episode_id)
        return ids

    def get_checked_episode_ids(self) -> list[str]:
        """Ordre des épisodes dans l'arbre (par saison puis numéro)."""
        selected: list[str] = []
        for season_number in self._season_numbers:
            for ref in self._season_episodes.get(season_number, []):
                if ref.episode_id in self._checked:
                    selected.append(ref.episode_id)
        return selected

    def get_episode_ids_for_season(self, season: int | None) -> list[str]:
        if season is None:
            return [ref.episode_id for ref in self._episodes]
        return [ref.episode_id for ref in self._season_episodes.get(season, [])]

    def get_season_numbers(self) -> list[int]:
        return list(self._season_numbers)

    def set_checked(self, episode_ids: set[str] | None = None, checked: bool = True) -> None:
        if episode_ids is None:
            episode_ids = {ref.episode_id for ref in self._episodes}
        if checked:
            self._checked |= episode_ids
        else:
            self._checked -= episode_ids
        self._emit_checked_changed()

    def set_all_checked(self, checked: bool) -> None:
        if checked:
            self._checked = {ref.episode_id for ref in self._episodes}
        else:
            self._checked.clear()
        self._emit_checked_changed()

    def _emit_checked_changed(self) -> None:
        if not self._episodes:
            return
        for season_number in self._season_numbers:
            season_index = self._season_numbers.index(season_number)
            for row, _ref in enumerate(self._season_episodes.get(season_number, [])):
                index = self.index(row, self.COL_CHECKED, self.index(season_index, 0, QModelIndex()))
                self.dataChanged.emit(index, index, [Qt.ItemDataRole.CheckStateRole])

    def get_season_at_root_row(self, row: int) -> int | None:
        """Pour le proxy : numéro de saison à la ligne root donnée."""
        if 0 <= row < len(self._season_numbers):
            return self._season_numbers[row]
        return None

    def _key_episode(self, ref: EpisodeRef, column: int) -> Any:
        """Valeur de tri pour un épisode (colonne donnée)."""
        if column == self.COL_SERIES:
            return (self._series_map.get(ref.episode_id, "") or "").lower()
        if column == 2:
            return (ref.episode_id or "").lower()
        if column == 3:
            return ref.season
        if column == 4:
            return ref.episode
        if column == 5:
            return (ref.title or "").lower()
        if column == 6:
            return (self._status_map.get(ref.episode_id, "") or "").lower()
        if column == 7:
            return (self._srt_map.get(ref.episode_id, "—") or "—").lower()
        if column == 8:
            return (self._align_map.get(ref.episode_id, "—") or "—").lower()
        return (ref.episode_id or "").lower()

    def sort(self, column: int, order: Qt.SortOrder = Qt.SortOrder.AscendingOrder) -> None:
        """Tri par colonne : saisons en racine, épisodes en enfants."""
        self.layoutAboutToBeChanged.emit([], QAbstractItemModel.VerticalSortHint)
        reverse = order == Qt.SortOrder.DescendingOrder
        self._season_numbers = sorted(self._season_numbers, reverse=reverse)
        for season_number in self._season_episodes:
            episodes = self._season_episodes[season_number]
            self._season_episodes[season_number] = sorted(
                episodes,
                key=lambda ref: self._key_episode(ref, column),
                reverse=reverse,
            )
        self.layoutChanged.emit([], QAbstractItemModel.VerticalSortHint)


class EpisodesTreeFilterProxyModel(QSortFilterProxyModel):
    """Proxy qui filtre l'arbre par saison."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._season_filter: int | None = None

    def set_season_filter(self, season: int | None) -> None:
        self._season_filter = season
        self.invalidate()

    def filterAcceptsRow(self, source_row: int, source_parent: QModelIndex) -> bool:
        if self._season_filter is None:
            return True
        source_model = self.sourceModel()
        if not isinstance(source_model, EpisodesTreeModel):
            return True
        if not source_parent.isValid():
            return source_model.get_season_at_root_row(source_row) == self._season_filter
        return True


class EpisodesTableModel(QAbstractTableModel):
    """Modèle pour la table des épisodes."""

    COLUMNS = ["checked", "series", "episode_id", "season", "episode", "title", "status", "srt", "aligned"]
    HEADERS = ["", "Série", "ID", "Saison", "Épisode", "Titre", "Statut", "SRT", "Aligné"]
    COL_CHECKED = 0
    COL_SERIES = 1

    def __init__(self, parent=None):
        super().__init__(parent)
        self._episodes: list[EpisodeRef] = []
        self._status_map: dict[str, str] = {}
        self._srt_map: dict[str, str] = {}
        self._align_map: dict[str, str] = {}
        self._series_map: dict[str, str] = {}
        self._checked: set[str] = set()
        self._store: ProjectStore | None = None
        self._db: CorpusDB | None = None

    def set_store(self, store: ProjectStore | None) -> None:
        self._store = store
        self._refresh_status()

    def set_db(self, db: CorpusDB | None) -> None:
        self._db = db
        self._refresh_status()

    def set_episodes(self, episodes: list[EpisodeRef]) -> None:
        self.beginResetModel()
        self._episodes = list(episodes)
        self._build_series_map()
        self._refresh_status()
        self.endResetModel()

    def _build_series_map(self) -> None:
        self._series_map = build_episode_series_map(self._episodes, self._store)

    def _refresh_status(self) -> None:
        self._status_map.clear()
        self._srt_map.clear()
        self._align_map.clear()
        if not self._episodes:
            return
        indexed = set(self._db.get_episode_ids_indexed()) if self._db else set()
        episode_ids = [ref.episode_id for ref in self._episodes]
        raw_ids, clean_ids = compute_episode_text_presence(self._store, episode_ids)
        tracks_by_episode = self._db.get_tracks_for_episodes(episode_ids) if self._db else {}
        runs_by_episode = self._db.get_align_runs_for_episodes(episode_ids) if self._db else {}
        for ref in self._episodes:
            status = EpisodeStatus.NEW.value
            if ref.episode_id in clean_ids:
                status = EpisodeStatus.NORMALIZED.value
            elif ref.episode_id in raw_ids:
                status = EpisodeStatus.FETCHED.value
            if ref.episode_id in indexed:
                status = EpisodeStatus.INDEXED.value
            self._status_map[ref.episode_id] = status
            if self._db:
                tracks = tracks_by_episode.get(ref.episode_id, [])
                langs = sorted({track.get("lang", "") for track in tracks if track.get("lang")})
                self._srt_map[ref.episode_id] = ", ".join(langs) if langs else "—"
                runs = runs_by_episode.get(ref.episode_id, [])
                self._align_map[ref.episode_id] = "oui" if runs else "—"
            else:
                self._srt_map[ref.episode_id] = "—"
                self._align_map[ref.episode_id] = "—"

    def rowCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self._episodes)

    def columnCount(self, parent=QModelIndex()):
        if parent.isValid():
            return 0
        return len(self.COLUMNS)

    def data(self, index: QModelIndex, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid() or index.row() >= len(self._episodes):
            return None
        ref = self._episodes[index.row()]
        column = index.column()
        if column == self.COL_CHECKED and role == Qt.ItemDataRole.CheckStateRole:
            return Qt.CheckState.Checked if ref.episode_id in self._checked else Qt.CheckState.Unchecked
        if role == Qt.ItemDataRole.DisplayRole:
            if column == self.COL_SERIES:
                return self._series_map.get(ref.episode_id, "—")
            if column == 2:
                return ref.episode_id
            if column == 3:
                return ref.season
            if column == 4:
                return ref.episode
            if column == 5:
                return ref.title or ""
            if column == 6:
                return self._status_map.get(ref.episode_id, EpisodeStatus.NEW.value)
            if column == 7:
                return self._srt_map.get(ref.episode_id, "—")
            if column == 8:
                return self._align_map.get(ref.episode_id, "—")
        return None

    def setData(self, index: QModelIndex, value: Any, role=Qt.ItemDataRole.EditRole) -> bool:
        if not index.isValid() or index.column() != self.COL_CHECKED or role != Qt.ItemDataRole.CheckStateRole:
            return False
        if index.row() >= len(self._episodes):
            return False
        ref = self._episodes[index.row()]
        if value == Qt.CheckState.Checked.value or value == Qt.CheckState.Checked:
            self._checked.add(ref.episode_id)
        else:
            self._checked.discard(ref.episode_id)
        self.dataChanged.emit(index, index, [Qt.ItemDataRole.CheckStateRole])
        return True

    def flags(self, index: QModelIndex) -> Qt.ItemFlag:
        if not index.isValid():
            return super().flags(index)
        flags = super().flags(index)
        if index.column() == self.COL_CHECKED:
            return flags | Qt.ItemFlag.ItemIsUserCheckable
        return flags

    def headerData(self, section: int, orientation: Qt.Orientation, role=Qt.ItemDataRole.DisplayRole):
        if orientation == Qt.Orientation.Horizontal and role == Qt.ItemDataRole.DisplayRole:
            if 0 <= section < len(self.HEADERS):
                return self.HEADERS[section]
        return None

    def get_episode_at(self, row: int) -> EpisodeRef | None:
        if 0 <= row < len(self._episodes):
            return self._episodes[row]
        return None

    def get_episode_id_for_index(self, index: QModelIndex) -> str | None:
        """Retourne l'episode_id pour un index (ligne de la table)."""
        ref = self.get_episode_at(index.row()) if index.isValid() else None
        return ref.episode_id if ref else None

    def get_episode_ids_selection(self, indices: list[QModelIndex]) -> list[str]:
        rows = sorted({index.row() for index in indices if index.isValid()})
        return [self._episodes[row].episode_id for row in rows if 0 <= row < len(self._episodes)]

    def get_checked_episode_ids(self) -> list[str]:
        """Retourne les episode_id des lignes cochées (ordre de la table)."""
        return [ref.episode_id for ref in self._episodes if ref.episode_id in self._checked]

    def get_episode_ids_for_season(self, season: int | None) -> list[str]:
        if season is None:
            return [ref.episode_id for ref in self._episodes]
        return [ref.episode_id for ref in self._episodes if ref.season == season]

    def get_season_numbers(self) -> list[int]:
        return sorted({ref.season for ref in self._episodes})

    def set_checked(self, episode_ids: set[str] | None = None, checked: bool = True) -> None:
        if episode_ids is None:
            episode_ids = {ref.episode_id for ref in self._episodes}
        if checked:
            self._checked |= episode_ids
        else:
            self._checked -= episode_ids
        self._emit_checked_changed()

    def set_all_checked(self, checked: bool) -> None:
        if checked:
            self._checked = {ref.episode_id for ref in self._episodes}
        else:
            self._checked.clear()
        self._emit_checked_changed()

    def _emit_checked_changed(self) -> None:
        if not self._episodes:
            return
        top_left = self.index(0, self.COL_CHECKED)
        bottom_right = self.index(len(self._episodes) - 1, self.COL_CHECKED)
        self.dataChanged.emit(top_left, bottom_right, [Qt.ItemDataRole.CheckStateRole])


class EpisodesFilterProxyModel(QSortFilterProxyModel):
    """Proxy qui filtre les épisodes par saison."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._season_filter: int | None = None

    def set_season_filter(self, season: int | None) -> None:
        self._season_filter = season
        self.invalidate()

    def filterAcceptsRow(self, source_row: int, source_parent: QModelIndex) -> bool:
        if self._season_filter is None:
            return True
        source_model = self.sourceModel()
        if not isinstance(source_model, EpisodesTableModel):
            return True
        ref = source_model.get_episode_at(source_row)
        if ref is None:
            return True
        return ref.season == self._season_filter
