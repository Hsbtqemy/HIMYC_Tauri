"""Onglet Corpus : arbre épisodes, filtre saison, workflow (découvrir, télécharger, normaliser, indexer, exporter)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QModelIndex
from PySide6.QtWidgets import (
    QFileDialog,
    QGroupBox,
    QMessageBox,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex
from howimetyourcorpus.core.normalize.profiles import get_all_profile_ids
from howimetyourcorpus.core.pipeline.tasks import (
    FetchSeriesIndexStep,
)
from howimetyourcorpus.app.tabs.corpus_export import (
    build_clean_episodes_data,
    export_corpus_by_filter,
)
from howimetyourcorpus.app.tabs.corpus_sources import CorpusSourcesController
from howimetyourcorpus.app.tabs.corpus_context import (
    CorpusContextController,
    lang_hint_from_profile,
    resolve_episode_profile,
)
from howimetyourcorpus.app.tabs.corpus_ui import CorpusUiBuilder
from howimetyourcorpus.app.tabs.corpus_view import CorpusViewController
from howimetyourcorpus.app.tabs.corpus_workflow import CorpusWorkflowController
from howimetyourcorpus.app.ui_utils import require_project, require_project_and_db

logger = logging.getLogger(__name__)


class CorpusTabWidget(QWidget):
    """Widget de l'onglet Corpus : arbre épisodes, saison, cases à cocher, boutons workflow, progression."""

    def __init__(
        self,
        get_store: Callable[[], Any],
        get_db: Callable[[], Any],
        get_context: Callable[[], Any],
        run_job: Callable[[list], None],
        show_status: Callable[[str, int], None],
        refresh_after_episodes_added: Callable[[], None],
        on_cancel_job: Callable[[], None],
        on_open_inspector: Callable[[str], None] | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._get_context = get_context
        self._run_job = run_job
        self._show_status = show_status
        self._refresh_after_episodes_added = refresh_after_episodes_added
        self._on_cancel_job = on_cancel_job
        self._on_open_inspector = on_open_inspector
        self._failed_episode_ids: set[str] = set()  # Stocke les episode_id en échec
        self._sources_controller = CorpusSourcesController(self)
        self._context_controller = CorpusContextController(self)
        self._workflow_controller = CorpusWorkflowController(self)
        self._view_controller = CorpusViewController(self, logger)
        self._ui_builder = CorpusUiBuilder(self)

        layout = QVBoxLayout(self)
        self._build_filter_row(layout)
        self._build_episodes_view(layout)
        ribbon_layout = self._build_ribbon_container(layout)
        self._build_sources_group(ribbon_layout)
        self._build_normalization_group(ribbon_layout)
        self._build_status_block(ribbon_layout)
        self._on_corpus_ribbon_toggled(True)

    def _build_filter_row(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_filter_row(layout)

    def _build_episodes_view(self, layout: QVBoxLayout) -> None:
        self._ui_builder.build_episodes_view(layout)

    def _build_ribbon_container(self, layout: QVBoxLayout) -> QVBoxLayout:
        return self._ui_builder.build_ribbon_container(layout)

    def _build_sources_group(self, ribbon_layout: QVBoxLayout) -> None:
        self._ui_builder.build_sources_group(ribbon_layout)

    def _build_transcripts_group(self) -> QGroupBox:
        return self._ui_builder.build_transcripts_group()

    def _build_subtitles_group(self) -> QGroupBox:
        return self._ui_builder.build_subtitles_group()

    def _build_normalization_group(self, ribbon_layout: QVBoxLayout) -> None:
        self._ui_builder.build_normalization_group(ribbon_layout)

    def _build_status_block(self, ribbon_layout: QVBoxLayout) -> None:
        self._ui_builder.build_status_block(ribbon_layout)

    def _on_corpus_ribbon_toggled(self, expanded: bool) -> None:
        self._view_controller.on_corpus_ribbon_toggled(expanded)

    def set_progress(self, value: int) -> None:
        self.corpus_progress.setValue(value)

    def set_cancel_btn_enabled(self, enabled: bool) -> None:
        self.cancel_job_btn.setEnabled(enabled)

    def set_resume_failed_btn_enabled(self, enabled: bool) -> None:
        """Active/désactive le bouton 'Reprendre les échecs'."""
        self.resume_failed_btn.setEnabled(enabled)

    def store_failed_episodes(self, failed_ids: set[str]) -> None:
        """Stocke les episode_id en échec pour la reprise."""
        self._failed_episode_ids = failed_ids
        self.set_resume_failed_btn_enabled(len(failed_ids) > 0)

    def _emit_cancel_job(self) -> None:
        self._on_cancel_job()

    def _get_selected_or_checked_episode_ids(self) -> list[str]:
        """Retourne les episode_id cochés, ou à défaut ceux des lignes sélectionnées."""
        return self._context_controller.get_selected_or_checked_episode_ids()

    def _get_project_index_context(self) -> tuple[Any, Any, SeriesIndex] | None:
        """Retourne (store, config, index) pour les actions batch, sinon affiche un warning."""
        return self._context_controller.get_project_index_context()

    def _resolve_target_episode_ids(
        self,
        *,
        index: SeriesIndex,
        selection_only: bool,
    ) -> list[str] | None:
        """Résout la cible épisodes (sélection cochée/lignes ou tout le corpus)."""
        return self._context_controller.resolve_target_episode_ids(
            index=index,
            selection_only=selection_only,
        )

    @staticmethod
    def _resolve_episode_profile(
        *,
        episode_id: str,
        ref_by_id: dict[str, EpisodeRef],
        episode_preferred: dict[str, str],
        source_defaults: dict[str, str],
        batch_profile: str,
    ) -> str:
        return resolve_episode_profile(
            episode_id=episode_id,
            ref_by_id=ref_by_id,
            episode_preferred=episode_preferred,
            source_defaults=source_defaults,
            batch_profile=batch_profile,
        )

    @staticmethod
    def _lang_hint_from_profile(profile_id: str | None) -> str:
        return lang_hint_from_profile(profile_id)

    def _set_no_project_state(self) -> None:
        """Met l'UI dans l'état « pas de projet » (labels vides, boutons désactivés)."""
        self._view_controller.set_no_project_state()

    def _resume_failed_episodes(self) -> None:
        """Relance les opérations sur les épisodes en échec (téléchargement, normalisation, etc.)."""
        self._context_controller.resume_failed_episodes()

    def refresh(self) -> None:
        """Recharge l'arbre et le statut depuis le store (appelé après ouverture projet / fin de job)."""
        self._view_controller.refresh()

    def refresh_profile_combo(self, profile_ids: list[str], current: str | None) -> None:
        """Met à jour le combo profil batch (après ouverture projet ou dialogue profils)."""
        current_batch = self.norm_batch_profile_combo.currentText()
        self.norm_batch_profile_combo.clear()
        self.norm_batch_profile_combo.addItems(profile_ids)
        if current_batch in profile_ids:
            self.norm_batch_profile_combo.setCurrentText(current_batch)
        elif current and current in profile_ids:
            self.norm_batch_profile_combo.setCurrentText(current)

    def _refresh_season_filter_combo(self) -> None:
        self._view_controller.refresh_season_filter_combo()

    def _on_season_filter_changed(self) -> None:
        self._view_controller.on_season_filter_changed()

    def _on_episode_double_clicked(self, proxy_index: QModelIndex) -> None:
        """Double-clic sur un épisode : ouvrir l'Inspecteur sur cet épisode (comme Concordance)."""
        self._view_controller.on_episode_double_clicked(proxy_index)

    def _on_check_season_clicked(self) -> None:
        self._view_controller.on_check_season_clicked()

    def _on_uncheck_season_clicked(self) -> None:
        self._view_controller.on_uncheck_season_clicked()

    @require_project_and_db
    def _discover_episodes(self) -> None:
        context = self._get_context()
        if not context or not context.get("config"):
            QMessageBox.warning(self, "Corpus", "Ouvrez un projet d'abord.")
            return
        config = context["config"]
        step = FetchSeriesIndexStep(config.series_url, config.user_agent)
        self._run_job([step])
    
    @require_project
    def _open_profiles_dialog(self) -> None:
        """Ouvre le dialogue de gestion des profils de normalisation."""
        store = self._get_store()
        assert store is not None  # garanti par @require_project
        from howimetyourcorpus.app.dialogs import ProfilesDialog
        dlg = ProfilesDialog(self, store)
        dlg.exec()
        custom_profiles = store.load_custom_profiles()
        self.refresh_profile_combo(
            get_all_profile_ids(custom_profiles),
            self.norm_batch_profile_combo.currentText(),
        )

    @require_project_and_db
    def _discover_merge(self) -> None:
        self._sources_controller.discover_merge()

    @require_project
    def _add_episodes_manually(self) -> None:
        self._sources_controller.add_episodes_manually()
    
    @require_project_and_db
    def _import_srt_selection(self) -> None:
        self._sources_controller.import_srt_selection()
    
    @require_project_and_db
    def _import_srt_batch(self) -> None:
        self._sources_controller.import_srt_batch()
    
    @require_project
    def _open_subtitles_manager(self) -> None:
        self._sources_controller.open_subtitles_manager()


    @require_project_and_db
    def _fetch_episodes(self, selection_only: bool) -> None:
        self._workflow_controller.fetch_episodes(selection_only)

    @require_project
    def _normalize_episodes(self, selection_only: bool) -> None:
        self._workflow_controller.normalize_episodes(selection_only)

    @require_project
    def _segment_episodes(self, selection_only: bool) -> None:
        """Bloc 2 — Segmente les épisodes (sélection ou tout) ayant clean.txt."""
        self._workflow_controller.segment_episodes(selection_only)

    @require_project_and_db
    def _run_all_for_selection(self) -> None:
        """§5 — Enchaînement : Télécharger → Normaliser → Segmenter → Indexer DB pour les épisodes cochés."""
        self._workflow_controller.run_all_for_selection()

    @require_project_and_db
    def _index_db(self) -> None:
        self._workflow_controller.index_db()

    @require_project
    def _export_corpus(self) -> None:
        store = self._get_store()
        assert store is not None  # garanti par @require_project
        index = store.load_series_index()
        if not index or not index.episodes:
            QMessageBox.warning(self, "Corpus", "Découvrez d'abord les épisodes.")
            return
        
        # Demander si on exporte tout ou seulement la sélection
        selected_ids = self._get_selected_or_checked_episode_ids()
        export_selection_only = False
        if selected_ids:
            reply = QMessageBox.question(
                self,
                "Export corpus",
                f"Exporter uniquement la sélection ({len(selected_ids)} épisode(s) cochés) ?\n\n"
                f"Oui = sélection uniquement\nNon = tout le corpus normalisé",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No | QMessageBox.StandardButton.Cancel,
                QMessageBox.StandardButton.No,
            )
            if reply == QMessageBox.StandardButton.Cancel:
                return
            export_selection_only = (reply == QMessageBox.StandardButton.Yes)

        selected_set = set(selected_ids) if export_selection_only else None
        episodes_data = build_clean_episodes_data(
            store=store,
            episodes=index.episodes,
            selected_ids=selected_set,
        )
        if not episodes_data:
            QMessageBox.warning(
                self, "Corpus", "Aucun épisode normalisé (CLEAN) à exporter."
            )
            return
        path, selected_filter = QFileDialog.getSaveFileName(
            self,
            "Exporter le corpus",
            "",
            "TXT (*.txt);;CSV (*.csv);;JSON (*.json);;Word (*.docx);;"
            "JSONL - Utterances (*.jsonl);;JSONL - Phrases (*.jsonl);;"
            "CSV - Utterances (*.csv);;CSV - Phrases (*.csv)",
        )
        if not path:
            return
        output_path = Path(path)
        selected_filter = selected_filter or ""
        try:
            if not export_corpus_by_filter(episodes_data, output_path, selected_filter):
                QMessageBox.warning(
                    self,
                    "Export",
                    "Format non reconnu. Utilisez .txt, .csv, .json ou .jsonl (segmenté).",
                )
                return
            QMessageBox.information(self, "Export", f"Corpus exporté : {len(episodes_data)} épisode(s).")
        except Exception as e:
            logger.exception("Export corpus")
            QMessageBox.critical(
                self,
                "Export corpus",
                f"L'export du corpus a échoué : {e}\n\n"
                "Vérifiez les droits d'écriture sur le dossier cible et que le fichier n'est pas ouvert ailleurs.",
            )
