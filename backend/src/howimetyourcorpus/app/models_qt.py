"""Façade de compatibilité pour les modèles Qt (imports historiques)."""

from __future__ import annotations

from howimetyourcorpus.app.models_qt_align import AlignLinksTableModel
from howimetyourcorpus.app.models_qt_episodes import (
    EpisodesFilterProxyModel,
    EpisodesTableModel,
    EpisodesTreeFilterProxyModel,
    EpisodesTreeModel,
)
from howimetyourcorpus.app.models_qt_kwic import KwicTableModel

__all__ = [
    "AlignLinksTableModel",
    "EpisodesFilterProxyModel",
    "EpisodesTableModel",
    "EpisodesTreeFilterProxyModel",
    "EpisodesTreeModel",
    "KwicTableModel",
]
