"""Helpers ProjectStore pour les mappings de profils (source/épisode)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


def load_source_profile_defaults(
    store: Any,
    *,
    logger_obj: logging.Logger,
) -> dict[str, str]:
    """Charge le mapping source_id -> profile_id."""
    path = Path(store.root_dir) / store.SOURCE_PROFILE_DEFAULTS_JSON
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return dict(data) if isinstance(data, dict) else {}
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return {}


def save_source_profile_defaults(store: Any, defaults: dict[str, str]) -> None:
    """Sauvegarde le mapping source_id -> profile_id."""
    path = Path(store.root_dir) / store.SOURCE_PROFILE_DEFAULTS_JSON
    path.write_text(json.dumps(defaults, ensure_ascii=False, indent=2), encoding="utf-8")


def load_episode_preferred_profiles(
    store: Any,
    *,
    logger_obj: logging.Logger,
) -> dict[str, str]:
    """Charge le mapping episode_id -> profile_id."""
    path = Path(store.root_dir) / store.EPISODE_PREFERRED_PROFILES_JSON
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return dict(data) if isinstance(data, dict) else {}
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return {}


def save_episode_preferred_profiles(store: Any, preferred: dict[str, str]) -> None:
    """Sauvegarde le mapping episode_id -> profile_id."""
    path = Path(store.root_dir) / store.EPISODE_PREFERRED_PROFILES_JSON
    path.write_text(json.dumps(preferred, ensure_ascii=False, indent=2), encoding="utf-8")
