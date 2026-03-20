"""Contrôleur de construction/navigation des onglets de la fenêtre principale."""

from __future__ import annotations

import logging
from typing import Any

from howimetyourcorpus.app.tabs import (
    AlignmentTabWidget,
    ConcordanceTabWidget,
    CorpusTabWidget,
    ExpertTransverseTabWidget,
    InspecteurEtSousTitresTabWidget,
    LogsTabWidget,
    PersonnagesTabWidget,
    PreparerTabWidget,
    ProjectTabWidget,
)


class MainWindowTabsController:
    """Regroupe la construction des onglets et les actions de navigation associées."""

    def __init__(
        self,
        window: Any,
        logger_obj: logging.Logger,
        *,
        tab_projet: int,
        tab_corpus: int,
        tab_inspecteur: int,
        tab_preparer: int,
        tab_alignement: int,
        tab_concordance: int,
        tab_personnages: int,
    ) -> None:
        self._window = window
        self._logger = logger_obj
        self._tab_projet = tab_projet
        self._tab_corpus = tab_corpus
        self._tab_inspecteur = tab_inspecteur
        self._tab_preparer = tab_preparer
        self._tab_alignement = tab_alignement
        self._tab_concordance = tab_concordance
        self._tab_personnages = tab_personnages

    def build_tab_projet(self) -> None:
        win = self._window
        win.project_tab = ProjectTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            on_validate_clicked=win._validate_and_init_project_from_tab,  # noqa: SLF001
            on_save_config=win._save_project_config,  # noqa: SLF001
            on_open_profiles_dialog=win._open_profiles_dialog,  # noqa: SLF001
            on_refresh_language_combos=win._refresh_language_combos,  # noqa: SLF001
            show_status=lambda msg, timeout=3000: win.statusBar().showMessage(msg, timeout),
        )
        win.tabs.addTab(win.project_tab, "Projet")

    def build_tab_corpus(self) -> None:
        win = self._window
        win.corpus_tab = CorpusTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            get_db=lambda: win._db,  # noqa: SLF001
            get_context=win._get_context,  # noqa: SLF001
            run_job=win._run_job,  # noqa: SLF001
            show_status=lambda msg, timeout=3000: win.statusBar().showMessage(msg, timeout),
            refresh_after_episodes_added=lambda: (
                win._refresh_episodes_from_store(),  # noqa: SLF001
                win._refresh_inspecteur_episodes(),  # noqa: SLF001
                win._refresh_preparer(),  # noqa: SLF001
                win._refresh_personnages(),  # noqa: SLF001
            ),
            on_cancel_job=win._cancel_job,  # noqa: SLF001
            on_open_inspector=win._kwic_open_inspector_impl,  # noqa: SLF001
        )
        win.tabs.addTab(win.corpus_tab, "Corpus")
        win.tabs.setTabToolTip(
            self._tab_corpus,
            "Workflow §14 — Bloc 1 (Import) + Bloc 2 (Normalisation / segmentation) : découverte, téléchargement, normaliser, indexer.",
        )
        # §15.3 — Projet = lieu du téléchargement : connecter les boutons Projet à la logique Corpus
        win.project_tab.set_acquisition_callbacks(
            on_discover_episodes=lambda: win.corpus_tab._discover_episodes(),  # noqa: SLF001
            on_fetch_all=lambda: win.corpus_tab._fetch_episodes(False),  # noqa: SLF001
        )

    def build_tab_inspecteur(self) -> None:
        win = self._window
        win.inspector_tab = InspecteurEtSousTitresTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            get_db=lambda: win._db,  # noqa: SLF001
            get_config=lambda: win._config,  # noqa: SLF001
            run_job=win._run_job,  # noqa: SLF001
            refresh_episodes=win._refresh_episodes_from_store,  # noqa: SLF001
            show_status=lambda msg, timeout=3000: win.statusBar().showMessage(msg, timeout),
            undo_stack=win.undo_stack,
        )
        win.tabs.addTab(win.inspector_tab, "Inspecteur")
        win.tabs.setTabToolTip(
            self._tab_inspecteur,
            "§15.4 — Transcript (RAW/CLEAN, segments) + Sous-titres (pistes, import, normaliser) pour l'épisode courant.",
        )

    def build_tab_preparer(self) -> None:
        win = self._window
        win.preparer_tab = PreparerTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            get_db=lambda: win._db,  # noqa: SLF001
            show_status=lambda msg, timeout=3000: win.statusBar().showMessage(msg, timeout),
            on_go_alignement=win.open_alignement_for_episode,
            undo_stack=win.undo_stack,
        )
        win.tabs.addTab(win.preparer_tab, "Préparer")
        win.tabs.setTabToolTip(
            self._tab_preparer,
            "Préparer un fichier (transcript/SRT): normaliser explicitement, éditer, segmenter en tours, puis passer à l'alignement.",
        )

    def build_tab_alignement(self) -> None:
        win = self._window
        win.alignment_tab = AlignmentTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            get_db=lambda: win._db,  # noqa: SLF001
            run_job=win._run_job,  # noqa: SLF001
            undo_stack=win.undo_stack,
        )
        win.tabs.addTab(win.alignment_tab, "Alignement")
        win.tabs.setTabToolTip(
            self._tab_alignement,
            "Workflow §14 — Bloc 3 : Alignement transcript↔cues, liens, export concordancier.",
        )

    def build_tab_concordance(self) -> None:
        win = self._window
        win.concordance_tab = ConcordanceTabWidget(
            get_db=lambda: win._db,  # noqa: SLF001
            on_open_inspector=win._kwic_open_inspector_impl,  # noqa: SLF001
        )
        win.tabs.addTab(win.concordance_tab, "Concordance")
        win.tabs.setTabToolTip(
            self._tab_concordance,
            "Workflow §14 — Bloc 3 : Concordancier parallèle (segment | EN | FR…), export KWIC.",
        )

    def build_tab_personnages(self) -> None:
        win = self._window
        win.personnages_tab = PersonnagesTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            get_db=lambda: win._db,  # noqa: SLF001
            show_status=lambda msg, timeout=3000: win.statusBar().showMessage(msg, timeout),
        )
        win.tabs.addTab(win.personnages_tab, "Personnages")
        win.tabs.setTabToolTip(
            self._tab_personnages,
            "Workflow §14 — Bloc 3 : Assignation segment/cue→personnage, propagation (après alignement).",
        )

    def build_tab_logs(self) -> None:
        win = self._window
        widget = LogsTabWidget(on_open_log=win._open_log_file)  # noqa: SLF001
        win.tabs.addTab(widget, "Logs")

    def build_tab_expert(self) -> None:
        win = self._window
        win.expert_tab = ExpertTransverseTabWidget(
            get_store=lambda: win._store,  # noqa: SLF001
            get_db=lambda: win._db,  # noqa: SLF001
            get_inspector_tab=lambda: getattr(win, "inspector_tab", None),
            get_preparer_tab=lambda: getattr(win, "preparer_tab", None),
            get_alignment_tab=lambda: getattr(win, "alignment_tab", None),
            get_personnages_tab=lambda: getattr(win, "personnages_tab", None),
            get_undo_stack=lambda: getattr(win, "undo_stack", None),
        )
        win.tabs.addTab(win.expert_tab, "Expert")
        win.tabs.setTabToolTip(
            win.tabs.indexOf(win.expert_tab),
            "Vue transverse d'expertise : contexte multi-onglets, run alignement, propagation et etat undo/redo.",
        )

    def refresh_episodes_from_store(self) -> None:
        win = self._window
        if hasattr(win, "corpus_tab") and win.corpus_tab:
            win.corpus_tab.refresh()

    def refresh_inspecteur_episodes(self) -> None:
        win = self._window
        if hasattr(win, "inspector_tab") and win.inspector_tab:
            win.inspector_tab.refresh()

    def refresh_subs_tracks(self) -> None:
        win = self._window
        if hasattr(win, "inspector_tab") and win.inspector_tab:
            win.inspector_tab.refresh()

    def refresh_preparer(self, *, force: bool = False) -> None:
        win = self._window
        if not (hasattr(win, "preparer_tab") and win.preparer_tab):
            return
        if not force and win.preparer_tab.has_unsaved_changes():
            self._logger.info("Skip preparer refresh: unsaved draft in progress")
            win.statusBar().showMessage(
                "Préparer: brouillon non enregistré conservé (rafraîchissement ignoré).",
                4000,
            )
            return
        win.preparer_tab.refresh()

    def refresh_align_runs(self) -> None:
        win = self._window
        if hasattr(win, "alignment_tab") and win.alignment_tab:
            win.alignment_tab.refresh()

    def refresh_personnages(self) -> None:
        win = self._window
        if hasattr(win, "personnages_tab") and win.personnages_tab:
            win.personnages_tab.refresh()

    def refresh_concordance(self) -> None:
        win = self._window
        if hasattr(win, "concordance_tab") and win.concordance_tab:
            win.concordance_tab.refresh_speakers()

    def refresh_expert(self) -> None:
        win = self._window
        if hasattr(win, "expert_tab") and win.expert_tab:
            win.expert_tab.refresh()

    def kwic_open_inspector(self, episode_id: str) -> None:
        win = self._window
        win.tabs.setCurrentIndex(self._tab_inspecteur)
        if win.tabs.currentIndex() != self._tab_inspecteur:
            return
        if hasattr(win, "inspector_tab") and win.inspector_tab:
            win.inspector_tab.set_episode_and_load(episode_id)

    def open_preparer_for_episode(self, episode_id: str, source: str | None = None) -> None:
        win = self._window
        if hasattr(win, "preparer_tab") and win.preparer_tab and win.preparer_tab.has_unsaved_changes():
            if not win.preparer_tab.prompt_save_if_dirty():
                return
        win.tabs.setCurrentIndex(self._tab_preparer)
        if hasattr(win, "preparer_tab") and win.preparer_tab:
            win.preparer_tab.refresh()
            win.preparer_tab.set_episode_and_load(episode_id, source_key=source or "transcript")

    def open_alignement_for_episode(self, episode_id: str, segment_kind: str = "sentence") -> None:
        win = self._window
        win.tabs.setCurrentIndex(self._tab_alignement)
        if hasattr(win, "alignment_tab") and win.alignment_tab:
            win.alignment_tab.refresh()
            win.alignment_tab.set_episode_and_segment_kind(episode_id, segment_kind=segment_kind)
