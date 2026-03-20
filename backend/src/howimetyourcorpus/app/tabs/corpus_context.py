"""Helpers de contexte/sélection pour l'onglet Corpus."""

from __future__ import annotations

from typing import Any

from PySide6.QtWidgets import QMessageBox

from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex


def resolve_episode_profile(
    *,
    episode_id: str,
    ref_by_id: dict[str, EpisodeRef],
    episode_preferred: dict[str, str],
    source_defaults: dict[str, str],
    batch_profile: str,
) -> str:
    """Résout le profil effectif d'un épisode avec fallback."""
    ref = ref_by_id.get(episode_id)
    return (
        episode_preferred.get(episode_id)
        or (source_defaults.get(ref.source_id or "") if ref else None)
        or batch_profile
    )


def lang_hint_from_profile(profile_id: str | None) -> str:
    """Déduit une langue probable depuis l'identifiant de profil."""
    profile = (profile_id or "").strip()
    if not profile:
        return "en"
    token = profile.split("_")[0]
    hint = token.replace("default", "en")
    return hint or "en"


class CorpusContextController:
    """Regroupe la résolution de sélection/contexte pour les actions batch."""

    def __init__(self, tab: Any) -> None:
        self._tab = tab

    def get_selected_or_checked_episode_ids(self) -> list[str]:
        """Retourne les episode_id cochés, ou à défaut ceux des lignes sélectionnées."""
        tab = self._tab
        ids = tab.episodes_tree_model.get_checked_episode_ids()
        if not ids:
            proxy_indices = tab.episodes_tree.selectionModel().selectedIndexes()
            source_indices = [tab.episodes_tree_proxy.mapToSource(index) for index in proxy_indices]
            ids = tab.episodes_tree_model.get_episode_ids_selection(source_indices)
        return ids

    def get_project_index_context(self) -> tuple[Any, Any, SeriesIndex] | None:
        """Retourne (store, config, index) pour les actions batch, sinon affiche un warning."""
        tab = self._tab
        store = tab._get_store()  # noqa: SLF001
        context = tab._get_context()  # noqa: SLF001
        if not context or not context.get("config") or not store:
            QMessageBox.warning(tab, "Corpus", "Ouvrez un projet d'abord.")
            return None
        index = store.load_series_index()
        if not index or not index.episodes:
            QMessageBox.warning(tab, "Corpus", "Découvrez d'abord les épisodes.")
            return None
        return store, context["config"], index

    def resolve_target_episode_ids(
        self,
        *,
        index: SeriesIndex,
        selection_only: bool,
    ) -> list[str] | None:
        """Résout la cible épisodes (sélection cochée/lignes ou tout le corpus)."""
        if selection_only:
            ids = self.get_selected_or_checked_episode_ids()
            if not ids:
                QMessageBox.warning(
                    self._tab,
                    "Corpus",
                    "Cochez au moins un épisode ou sélectionnez des lignes.",
                )
                return None
            return ids
        return [episode.episode_id for episode in index.episodes]

    def resume_failed_episodes(self) -> None:
        """Relance les opérations sur les épisodes en échec (téléchargement, normalisation, etc.)."""
        tab = self._tab
        if not tab._failed_episode_ids:  # noqa: SLF001
            QMessageBox.information(
                tab,
                "Reprendre échecs",
                "Aucun échec récent à reprendre.",
            )
            return

        tab.episodes_tree_model.set_checked(tab._failed_episode_ids, True)  # noqa: SLF001
        reply = QMessageBox.question(
            tab,
            "Reprendre les échecs",
            f"{len(tab._failed_episode_ids)} épisode(s) en échec cochés.\n\n"  # noqa: SLF001
            "Relancer maintenant le même type d'opération ?\n"
            "(Télécharger/Normaliser/Segmenter selon ce qui a échoué)",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if reply == QMessageBox.StandardButton.Yes:
            QMessageBox.information(
                tab,
                "Reprendre",
                f"{len(tab._failed_episode_ids)} épisode(s) cochés. Cliquez sur le bouton d'action approprié (Télécharger, Normaliser, etc.).",  # noqa: SLF001
            )
