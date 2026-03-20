"""Helpers ProjectStore pour la persistance de l'index série."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex

logger = logging.getLogger(__name__)


def save_series_index(store: Any, series_index: SeriesIndex) -> None:
    """Sauvegarde l'index série en JSON."""
    path = Path(store.root_dir) / "series_index.json"
    payload = {
        "series_title": series_index.series_title,
        "series_url": series_index.series_url,
        "episodes": [
            {
                "episode_id": episode.episode_id,
                "season": episode.season,
                "episode": episode.episode,
                "title": episode.title,
                "url": episode.url,
                **({"source_id": episode.source_id} if episode.source_id else {}),
            }
            for episode in series_index.episodes
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_series_index(store: Any) -> SeriesIndex | None:
    """Charge l'index série depuis JSON. Retourne None si absent."""
    path = Path(store.root_dir) / "series_index.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("Impossible de charger %s: %s", path, exc)
        return None
    if not isinstance(payload, dict):
        logger.warning("Impossible de charger %s: structure inattendue (%s)", path, type(payload).__name__)
        return None
    episodes: list[EpisodeRef] = []
    raw_episodes = payload.get("episodes", [])
    if not isinstance(raw_episodes, list):
        logger.warning("Impossible de charger %s: clé 'episodes' invalide", path)
        return None
    for row in raw_episodes:
        if not isinstance(row, dict):
            continue
        episode_id = str(row.get("episode_id", "") or "").strip()
        if not episode_id:
            continue
        try:
            season = int(row.get("season", 0))
            episode_num = int(row.get("episode", 0))
        except (TypeError, ValueError):
            continue
        episodes.append(
            EpisodeRef(
                episode_id=episode_id,
                season=season,
                episode=episode_num,
                title=row.get("title", "") or "",
                url=row.get("url", "") or "",
                source_id=row.get("source_id"),
            )
        )
    return SeriesIndex(
        series_title=payload.get("series_title", ""),
        series_url=payload.get("series_url", ""),
        episodes=episodes,
    )
