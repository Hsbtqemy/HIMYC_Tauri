"""Contrat typé du contexte passé au pipeline (runner et steps)."""

from __future__ import annotations

from typing import Any, Callable, TypedDict

from howimetyourcorpus.core.models import ProjectConfig
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore


class _PipelineContextOptional(TypedDict, total=False):
    """Clés optionnelles du contexte pipeline."""

    db: CorpusDB | None
    """Base de données du corpus (optionnelle ; absente en mode SRT only)."""
    custom_profiles: dict[str, Any] | None
    """Profils de normalisation personnalisés chargés depuis le projet (nom → profil)."""
    is_cancelled: Callable[[], bool] | None
    """If present, steps may check this in loops to abort early (e.g. on user cancel)."""


class PipelineContext(_PipelineContextOptional):
    """
    Contexte passé à chaque étape du pipeline et au runner.

    Clés requises :
        config : configuration du projet (ProjectConfig).
        store : stockage projet (ProjectStore, series_index, épisodes, SRT, etc.).

    Clés optionnelles :
        db : base SQLite du corpus (segments, subtitle_tracks, align_runs). Absente si projet SRT only.
        custom_profiles : dictionnaire de profils de normalisation personnalisés (nom → profil).
        is_cancelled : callable sans argument retournant True si l'utilisateur a annulé (pour sortie anticipée dans les boucles).
    """

    config: ProjectConfig
    store: ProjectStore
