"""Modèle de données : dataclasses typées pour projet, série, épisodes, runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE


@dataclass(frozen=True)
class ProjectConfig:
    """Configuration d'un projet de corpus."""

    project_name: str
    """Nom du projet."""
    root_dir: Path
    """Répertoire racine du projet."""
    source_id: str
    """Identifiant de la source (ex: subslikescript)."""
    series_url: str
    """URL de la page série sur la source."""
    rate_limit_s: float = 2.0
    """Délai minimal entre requêtes HTTP (secondes)."""
    user_agent: str = "HowIMetYourCorpus/0.1 (research)"
    """User-Agent pour les requêtes HTTP."""
    normalize_profile: str = DEFAULT_NORMALIZE_PROFILE
    """Profil de normalisation à appliquer."""


@dataclass
class EpisodeRef:
    """Référence canonique à un épisode."""

    episode_id: str
    """Identifiant canonique (ex: S01E01)."""
    season: int
    episode: int
    title: str
    url: str
    source_id: str | None = None
    """Source adapteur pour cet épisode (optionnel ; sinon config.source_id)."""


@dataclass
class SeriesIndex:
    """Index d'une série : métadonnées + liste d'épisodes."""

    series_title: str
    series_url: str
    episodes: list[EpisodeRef] = field(default_factory=list)


class EpisodeStatus(str, Enum):
    """État de traitement d'un épisode."""

    NEW = "new"
    FETCHED = "fetched"
    NORMALIZED = "normalized"
    INDEXED = "indexed"
    ERROR = "error"


@dataclass
class TransformStats:
    """Statistiques d'une transformation (normalisation)."""

    raw_lines: int = 0
    clean_lines: int = 0
    merges: int = 0
    kept_breaks: int = 0
    duration_ms: int = 0


@dataclass
class RunMeta:
    """Métadonnées d'une exécution du pipeline."""

    tool_version: str
    timestamp_utc: str
    params: dict[str, Any]
    notes: str | None = None
