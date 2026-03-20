"""Orchestration des actions batch du workflow Corpus."""

from __future__ import annotations

from typing import Any

from PySide6.QtWidgets import QMessageBox

from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE
from howimetyourcorpus.core.pipeline.tasks import (
    BuildDbIndexStep,
    FetchEpisodeStep,
    NormalizeEpisodeStep,
    SegmentEpisodeStep,
)


class CorpusWorkflowController:
    """Regroupe les actions batch du panneau Normalisation/Segmentation."""

    def __init__(self, tab: Any) -> None:
        self._tab = tab

    def fetch_episodes(self, selection_only: bool) -> None:
        tab = self._tab
        payload = tab._get_project_index_context()  # noqa: SLF001
        if not payload:
            return
        _store, config, index = payload
        if (getattr(config, "source_id", "") or "").strip().lower() == "tvmaze":
            QMessageBox.information(
                tab,
                "Corpus",
                "TVMaze ne fournit pas de transcripts d'épisodes. "
                "Utilisez TVMaze pour découvrir la liste des épisodes, puis importez des fichiers SRT/VTT "
                "ou utilisez une source transcript compatible.",
            )
            return
        ids = tab._resolve_target_episode_ids(index=index, selection_only=selection_only)  # noqa: SLF001
        if not ids:
            return
        steps = [
            FetchEpisodeStep(ref.episode_id, ref.url)
            for ref in index.episodes
            if ref.episode_id in ids
        ]
        if not steps:
            return
        tab._run_job(steps)  # noqa: SLF001

    def normalize_episodes(self, selection_only: bool) -> None:
        tab = self._tab
        payload = tab._get_project_index_context()  # noqa: SLF001
        if not payload:
            return
        store, _config, index = payload
        ids = tab._resolve_target_episode_ids(index=index, selection_only=selection_only)  # noqa: SLF001
        if not ids:
            return
        ref_by_id = {episode.episode_id: episode for episode in index.episodes}
        episode_preferred = store.load_episode_preferred_profiles()
        source_defaults = store.load_source_profile_defaults()
        batch_profile = tab.norm_batch_profile_combo.currentText() or DEFAULT_NORMALIZE_PROFILE
        steps = [
            NormalizeEpisodeStep(
                episode_id,
                tab._resolve_episode_profile(  # noqa: SLF001
                    episode_id=episode_id,
                    ref_by_id=ref_by_id,
                    episode_preferred=episode_preferred,
                    source_defaults=source_defaults,
                    batch_profile=batch_profile,
                ),
            )
            for episode_id in ids
        ]
        tab._run_job(steps)  # noqa: SLF001

    def segment_episodes(self, selection_only: bool) -> None:
        tab = self._tab
        payload = tab._get_project_index_context()  # noqa: SLF001
        if not payload:
            return
        store, config, index = payload
        ids = tab._resolve_target_episode_ids(index=index, selection_only=selection_only)  # noqa: SLF001
        if not ids:
            return
        eids_with_clean = [episode_id for episode_id in ids if store.has_episode_clean(episode_id)]
        if not eids_with_clean:
            QMessageBox.warning(
                tab,
                "Corpus",
                "Aucun épisode sélectionné n'a de fichier CLEAN. Normalisez d'abord la sélection.",
            )
            return
        lang_hint = tab._lang_hint_from_profile(getattr(config, "normalize_profile", None))  # noqa: SLF001
        steps = [SegmentEpisodeStep(episode_id, lang_hint=lang_hint) for episode_id in eids_with_clean]
        tab._run_job(steps)  # noqa: SLF001

    def run_all_for_selection(self) -> None:
        tab = self._tab
        payload = tab._get_project_index_context()  # noqa: SLF001
        if not payload:
            return
        store, config, index = payload
        if (getattr(config, "source_id", "") or "").strip().lower() == "tvmaze":
            QMessageBox.information(
                tab,
                "Corpus",
                "Le workflow « Tout pour la sélection » nécessite des transcripts (fetch + normalisation). "
                "Avec TVMaze, commencez par importer des sous-titres SRT/VTT.",
            )
            return
        ids = tab._resolve_target_episode_ids(index=index, selection_only=True)  # noqa: SLF001
        if not ids:
            return
        ref_by_id = {episode.episode_id: episode for episode in index.episodes}
        episode_preferred = store.load_episode_preferred_profiles()
        source_defaults = store.load_source_profile_defaults()
        batch_profile = tab.norm_batch_profile_combo.currentText() or DEFAULT_NORMALIZE_PROFILE
        lang_hint = tab._lang_hint_from_profile(getattr(config, "normalize_profile", None))  # noqa: SLF001
        fetch_steps = [
            FetchEpisodeStep(ref_by_id[episode_id].episode_id, ref_by_id[episode_id].url)
            for episode_id in ids
            if episode_id in ref_by_id
        ]
        norm_steps = [
            NormalizeEpisodeStep(
                episode_id,
                tab._resolve_episode_profile(  # noqa: SLF001
                    episode_id=episode_id,
                    ref_by_id=ref_by_id,
                    episode_preferred=episode_preferred,
                    source_defaults=source_defaults,
                    batch_profile=batch_profile,
                ),
            )
            for episode_id in ids
        ]
        segment_steps = [SegmentEpisodeStep(episode_id, lang_hint=lang_hint) for episode_id in ids]
        steps = fetch_steps + norm_steps + segment_steps + [BuildDbIndexStep()]
        tab._run_job(steps)  # noqa: SLF001

    def index_db(self) -> None:
        self._tab._run_job([BuildDbIndexStep()])  # noqa: SLF001
