"""Utilitaires partagés pour les modèles Qt de l'application."""

from __future__ import annotations

import logging

from howimetyourcorpus.core.models import EpisodeRef
from howimetyourcorpus.core.storage.project_store import ProjectStore

logger = logging.getLogger(__name__)


def compute_episode_text_presence(
    store: ProjectStore | None,
    episode_ids: list[str],
) -> tuple[set[str], set[str]]:
    """Retourne (raw_ids, clean_ids) pour les épisodes demandés, avec fallback robuste."""
    if not store or not episode_ids:
        return set(), set()
    requested = set(episode_ids)
    try:
        raw_ids, clean_ids = store.get_episode_text_presence()
        return raw_ids & requested, clean_ids & requested
    except Exception:
        logger.exception("Batch text presence failed; fallback to per-episode checks")

    raw_ids: set[str] = set()
    clean_ids: set[str] = set()
    for episode_id in requested:
        try:
            if store.has_episode_raw(episode_id):
                raw_ids.add(episode_id)
            if store.has_episode_clean(episode_id):
                clean_ids.add(episode_id)
        except Exception:
            logger.exception("Error while checking text presence for %s", episode_id)
    return raw_ids, clean_ids


def build_episode_series_map(
    episodes: list[EpisodeRef],
    store: ProjectStore | None,
) -> dict[str, str]:
    """Construit une map `episode_id -> libellé série` pour affichage multi-séries."""
    series_map: dict[str, str] = {}
    if not episodes:
        return series_map

    sources = {ep.source_id for ep in episodes if ep.source_id}
    series_title = ""
    if store:
        try:
            index = store.load_series_index()
        except Exception as exc:
            logger.debug("Unable to load series index for series labels: %s", exc)
            index = None
        if index and index.series_title:
            series_title = index.series_title

    if len(sources) <= 1:
        source_name = next(iter(sources)) if sources else ""
        default_name = series_title or source_name or "—"
        for episode in episodes:
            series_map[episode.episode_id] = default_name
        return series_map

    for episode in episodes:
        series_map[episode.episode_id] = episode.source_id or "—"
    return series_map
