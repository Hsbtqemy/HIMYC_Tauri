"""Contrôleur vue/refresh pour l'onglet Corpus."""

from __future__ import annotations

import logging
from typing import Any

from PySide6.QtCore import QModelIndex, Qt
from PySide6.QtWidgets import QMessageBox, QTreeView


def _workflow_next_step_hint(
    n_total: int,
    n_fetched: int,
    n_norm: int,
    n_indexed: int,
    n_with_srt: int,
    n_aligned: int,
) -> str:
    """Retourne une phrase de recommandation pour la prochaine étape du workflow."""
    if n_total == 0:
        return ""
    if n_fetched == 0:
        return "Prochaine étape : cochez des épisodes puis Télécharger (ou Découvrir d'abord)."
    if n_fetched < n_total:
        return "Prochaine étape : téléchargez les épisodes manquants ou Normalisez la sélection."
    if n_norm < n_fetched:
        return "Prochaine étape : Normalisez la sélection (ou Normaliser tout)."
    if n_indexed < n_norm:
        return "Prochaine étape : Segmentez la sélection (ou Segmenter tout) puis Indexer DB."
    if n_with_srt < n_total:
        return "Prochaine étape : importez les SRT (onglet Sous-titres)."
    if n_aligned < n_with_srt and n_with_srt > 0:
        return "Prochaine étape : alignez (onglet Alignement)."
    return "Workflow à jour. Export ou Concordance selon besoin."


class CorpusViewController:
    """Regroupe les comportements de vue (filtres, refresh, navigation)."""

    def __init__(self, tab: Any, logger_obj: logging.Logger) -> None:
        self._tab = tab
        self._logger = logger_obj

    def on_corpus_ribbon_toggled(self, expanded: bool) -> None:
        tab = self._tab
        tab.corpus_ribbon_content.setVisible(bool(expanded))
        if expanded:
            tab.corpus_ribbon_toggle_btn.setArrowType(Qt.ArrowType.DownArrow)
            tab.corpus_ribbon_toggle_btn.setText("Masquer le panneau d'actions")
        else:
            tab.corpus_ribbon_toggle_btn.setArrowType(Qt.ArrowType.RightArrow)
            tab.corpus_ribbon_toggle_btn.setText("Afficher le panneau d'actions")

    def set_no_project_state(self) -> None:
        """Met l'UI dans l'état « pas de projet » (labels vides, boutons désactivés)."""
        tab = self._tab
        tab.season_filter_combo.clear()
        tab.season_filter_combo.addItem("Toutes les saisons", None)
        tab.corpus_status_label.setText("")
        if hasattr(tab, "workflow_next_step_label"):
            tab.workflow_next_step_label.setText("")
            tab.workflow_next_step_label.setVisible(False)
        tab.transcripts_status_label.setText("Status : 0/0 téléchargés")
        tab.subtitles_status_label.setText("Status : 0/0 importés")
        tab.norm_sel_btn.setEnabled(False)
        tab.norm_all_btn.setEnabled(False)
        tab.segment_sel_btn.setEnabled(False)
        tab.segment_all_btn.setEnabled(False)
        tab.all_in_one_btn.setEnabled(False)

    def refresh(self) -> None:
        """Recharge l'arbre et le statut depuis le store."""
        tab = self._tab
        try:
            store = tab._get_store()  # noqa: SLF001
            db = tab._get_db()  # noqa: SLF001
            if not store:
                self.set_no_project_state()
                return
            index = store.load_series_index()
            if not index or not index.episodes:
                self.set_no_project_state()
                return
            n_total = len(index.episodes)
            n_fetched = sum(1 for episode in index.episodes if store.has_episode_raw(episode.episode_id))
            n_norm = sum(1 for episode in index.episodes if store.has_episode_clean(episode.episode_id))
            n_indexed = len(db.get_episode_ids_indexed()) if db else 0
            n_with_srt = 0
            n_aligned = 0
            if db and index.episodes:
                episode_ids = [episode.episode_id for episode in index.episodes]
                tracks_by_ep = db.get_tracks_for_episodes(episode_ids)
                runs_by_ep = db.get_align_runs_for_episodes(episode_ids)
                n_with_srt = sum(1 for episode in index.episodes if tracks_by_ep.get(episode.episode_id))
                n_aligned = sum(1 for episode in index.episodes if runs_by_ep.get(episode.episode_id))

            tab.corpus_status_label.setText(
                f"Workflow : Découverts {n_total} | Téléchargés {n_fetched} | Normalisés {n_norm} | Segmentés {n_indexed} | SRT {n_with_srt} | Alignés {n_aligned}"
            )

            next_step = _workflow_next_step_hint(
                n_total, n_fetched, n_norm, n_indexed, n_with_srt, n_aligned
            )
            tab.workflow_next_step_label.setText(next_step)
            tab.workflow_next_step_label.setVisible(bool(next_step))

            missing_transcripts = n_total - n_fetched
            if missing_transcripts > 0:
                tab.transcripts_status_label.setText(
                    f"Status : {n_fetched}/{n_total} téléchargés ⚠️ ({missing_transcripts} manquants)"
                )
                tab.transcripts_status_label.setStyleSheet("color: orange; font-style: italic;")
            else:
                tab.transcripts_status_label.setText(f"Status : {n_fetched}/{n_total} téléchargés ✅")
                tab.transcripts_status_label.setStyleSheet("color: green; font-style: italic;")

            missing_srt = n_total - n_with_srt
            if missing_srt > 0:
                tab.subtitles_status_label.setText(
                    f"Status : {n_with_srt}/{n_total} importés ⚠️ ({missing_srt} manquants)"
                )
                tab.subtitles_status_label.setStyleSheet("color: orange; font-style: italic;")
            else:
                tab.subtitles_status_label.setText(f"Status : {n_with_srt}/{n_total} importés ✅")
                tab.subtitles_status_label.setStyleSheet("color: green; font-style: italic;")

            tab.norm_sel_btn.setEnabled(n_fetched > 0 or n_with_srt > 0)
            tab.norm_all_btn.setEnabled(n_fetched > 0 or n_with_srt > 0)
            tab.segment_sel_btn.setEnabled(n_norm > 0)
            tab.segment_all_btn.setEnabled(n_norm > 0)
            tab.all_in_one_btn.setEnabled(n_total > 0)

            self._logger.debug("Corpus refresh: updating tree model with %d episodes", len(index.episodes))
            tab.episodes_tree_model.set_store(store)
            tab.episodes_tree_model.set_db(db)
            tab.episodes_tree_model.set_episodes(index.episodes)
            self.refresh_season_filter_combo()
            self._logger.debug("Corpus refresh completed successfully")
        except Exception as exc:
            self._logger.exception("Error in corpus_tab.refresh()")
            QMessageBox.critical(
                tab,
                "Erreur Corpus",
                f"Erreur lors du rafraîchissement du corpus:\n\n{type(exc).__name__}: {exc}\n\nVoir l'onglet Logs pour plus de détails.",
            )

    def refresh_season_filter_combo(self) -> None:
        tab = self._tab
        tab.season_filter_combo.blockSignals(True)
        tab.season_filter_combo.clear()
        tab.season_filter_combo.addItem("Toutes les saisons", None)
        for season_number in tab.episodes_tree_model.get_season_numbers():
            tab.season_filter_combo.addItem(f"Saison {season_number}", season_number)
        tab.season_filter_combo.blockSignals(False)
        self.on_season_filter_changed()

    def on_season_filter_changed(self) -> None:
        tab = self._tab
        season = tab.season_filter_combo.currentData()
        tab.episodes_tree_proxy.set_season_filter(season)
        if season is not None and isinstance(tab.episodes_tree, QTreeView):
            try:
                row = tab.episodes_tree_model.get_season_numbers().index(season)
                source_ix = tab.episodes_tree_model.index(row, 0, QModelIndex())
                proxy_ix = tab.episodes_tree_proxy.mapFromSource(source_ix)
                if proxy_ix.isValid():
                    tab.episodes_tree.expand(proxy_ix)
            except (ValueError, AttributeError) as exc:
                self._logger.debug("Season expand skipped for %r: %s", season, exc)

    def on_episode_double_clicked(self, proxy_index: QModelIndex) -> None:
        """Double-clic sur un épisode : ouvrir l'Inspecteur sur cet épisode."""
        tab = self._tab
        if not proxy_index.isValid() or not tab._on_open_inspector:  # noqa: SLF001
            return
        source_index = tab.episodes_tree_proxy.mapToSource(proxy_index)
        episode_id = tab.episodes_tree_model.get_episode_id_for_index(source_index)
        if episode_id:
            tab._on_open_inspector(episode_id)  # noqa: SLF001

    def on_check_season_clicked(self) -> None:
        tab = self._tab
        season = tab.season_filter_combo.currentData()
        episode_ids = tab.episodes_tree_model.get_episode_ids_for_season(season)
        if not episode_ids:
            return
        tab.episodes_tree_model.set_checked(set(episode_ids), True)
        label = f"Saison {season}" if season is not None else "Tous"
        tab._show_status(f"{label} : {len(episode_ids)} épisode(s) coché(s).", 3000)  # noqa: SLF001

    def on_uncheck_season_clicked(self) -> None:
        tab = self._tab
        season = tab.season_filter_combo.currentData()
        episode_ids = tab.episodes_tree_model.get_episode_ids_for_season(season)
        if not episode_ids:
            return
        tab.episodes_tree_model.set_checked(set(episode_ids), False)
        label = f"Saison {season}" if season is not None else "Tous"
        tab._show_status(f"{label} : {len(episode_ids)} épisode(s) décoché(s).", 3000)  # noqa: SLF001
