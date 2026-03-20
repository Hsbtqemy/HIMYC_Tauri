"""Helpers ProjectStore pour le domaine Préparer (status/options/langues)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.preparer import (
    DEFAULT_SEGMENTATION_OPTIONS,
    normalize_segmentation_options,
    validate_segmentation_options,
)


def load_episode_prep_status(
    store: Any,
    *,
    logger_obj: logging.Logger,
) -> dict[str, dict[str, str]]:
    """Charge les statuts de préparation par fichier."""
    path = Path(store.root_dir) / store.EPISODE_PREP_STATUS_JSON
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return {}
    raw_statuses = data.get("statuses", data if isinstance(data, dict) else {})
    if not isinstance(raw_statuses, dict):
        return {}
    statuses: dict[str, dict[str, str]] = {}
    for episode_id, by_source in raw_statuses.items():
        if not isinstance(episode_id, str) or not isinstance(by_source, dict):
            continue
        clean_by_source: dict[str, str] = {}
        for source_key, status in by_source.items():
            if not isinstance(source_key, str) or not isinstance(status, str):
                continue
            normalized_status = status.strip().lower()
            if normalized_status in store.PREP_STATUS_VALUES:
                clean_by_source[source_key.strip()] = normalized_status
        if clean_by_source:
            statuses[episode_id.strip()] = clean_by_source
    return statuses


def save_episode_prep_status(store: Any, statuses: dict[str, dict[str, str]]) -> None:
    """Sauvegarde les statuts de préparation par fichier."""
    clean: dict[str, dict[str, str]] = {}
    for episode_id, by_source in (statuses or {}).items():
        if not isinstance(episode_id, str) or not isinstance(by_source, dict):
            continue
        clean_by_source: dict[str, str] = {}
        for source_key, status in by_source.items():
            if not isinstance(source_key, str) or not isinstance(status, str):
                continue
            normalized_status = status.strip().lower()
            if normalized_status in store.PREP_STATUS_VALUES:
                clean_by_source[source_key.strip()] = normalized_status
        if clean_by_source:
            clean[episode_id.strip()] = clean_by_source
    path = Path(store.root_dir) / store.EPISODE_PREP_STATUS_JSON
    path.write_text(
        json.dumps({"statuses": clean}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_episode_prep_status(store: Any, episode_id: str, source_key: str, default: str = "raw") -> str:
    """Retourne le statut de préparation pour (épisode, source)."""
    statuses = load_episode_prep_status(store, logger_obj=logging.getLogger("howimetyourcorpus.core.storage.project_store"))
    status = (
        statuses.get((episode_id or "").strip(), {})
        .get((source_key or "").strip(), "")
        .strip()
        .lower()
    )
    if status in store.PREP_STATUS_VALUES:
        return status
    normalized_default = (default or "raw").strip().lower()
    return normalized_default if normalized_default in store.PREP_STATUS_VALUES else "raw"


def set_episode_prep_status(store: Any, episode_id: str, source_key: str, status: str) -> None:
    """Définit le statut de préparation pour (épisode, source)."""
    episode = (episode_id or "").strip()
    source = (source_key or "").strip()
    normalized_status = (status or "").strip().lower()
    if not episode or not source:
        return
    if normalized_status == "absent":
        # "absent" = supprimer la clé du dict (source supprimée)
        statuses = load_episode_prep_status(store, logger_obj=logging.getLogger("howimetyourcorpus.core.storage.project_store"))
        if episode in statuses and source in statuses[episode]:
            del statuses[episode][source]
            if not statuses[episode]:
                del statuses[episode]
            save_episode_prep_status(store, statuses)
        return
    if normalized_status not in store.PREP_STATUS_VALUES:
        raise ValueError(f"Statut de préparation invalide: {status!r}")
    statuses = load_episode_prep_status(store, logger_obj=logging.getLogger("howimetyourcorpus.core.storage.project_store"))
    if episode not in statuses:
        statuses[episode] = {}
    statuses[episode][source] = normalized_status
    save_episode_prep_status(store, statuses)


def load_episode_segmentation_options(
    store: Any,
    *,
    logger_obj: logging.Logger,
) -> dict[str, dict[str, dict[str, Any]]]:
    """Charge les options de segmentation par (épisode, source)."""
    path = Path(store.root_dir) / store.EPISODE_SEGMENTATION_OPTIONS_JSON
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return {}
    raw = data.get("options", data if isinstance(data, dict) else {})
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for episode_id, by_source in raw.items():
        if not isinstance(episode_id, str) or not isinstance(by_source, dict):
            continue
        clean_by_source: dict[str, dict[str, Any]] = {}
        for source_key, options in by_source.items():
            if not isinstance(source_key, str) or not isinstance(options, dict):
                continue
            normalized = normalize_segmentation_options(options)
            try:
                validate_segmentation_options(normalized)
            except ValueError:
                continue
            clean_by_source[source_key.strip()] = normalized
        if clean_by_source:
            out[episode_id.strip()] = clean_by_source
    return out


def save_episode_segmentation_options(
    store: Any,
    options_map: dict[str, dict[str, dict[str, Any]]],
) -> None:
    """Sauvegarde les options de segmentation par (épisode, source)."""
    clean: dict[str, dict[str, dict[str, Any]]] = {}
    for episode_id, by_source in (options_map or {}).items():
        if not isinstance(episode_id, str) or not isinstance(by_source, dict):
            continue
        clean_by_source: dict[str, dict[str, Any]] = {}
        for source_key, options in by_source.items():
            if not isinstance(source_key, str) or not isinstance(options, dict):
                continue
            normalized = normalize_segmentation_options(options)
            validate_segmentation_options(normalized)
            clean_by_source[source_key.strip()] = normalized
        if clean_by_source:
            clean[episode_id.strip()] = clean_by_source
    path = Path(store.root_dir) / store.EPISODE_SEGMENTATION_OPTIONS_JSON
    path.write_text(
        json.dumps({"options": clean}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_episode_segmentation_options(
    store: Any,
    episode_id: str,
    source_key: str,
    default: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Retourne les options de segmentation pour (épisode, source), normalisées."""
    episode = (episode_id or "").strip()
    source = (source_key or "").strip()
    options_map = load_episode_segmentation_options(
        store,
        logger_obj=logging.getLogger("howimetyourcorpus.core.storage.project_store"),
    )
    source_options = options_map.get(episode, {}).get(source, {})
    merged = dict(DEFAULT_SEGMENTATION_OPTIONS)
    merged.update(normalize_segmentation_options(default))
    if isinstance(source_options, dict):
        merged.update(normalize_segmentation_options(source_options))
    return normalize_segmentation_options(merged)


def set_episode_segmentation_options(
    store: Any,
    episode_id: str,
    source_key: str,
    options: dict[str, Any],
) -> None:
    """Définit les options de segmentation pour (épisode, source)."""
    episode = (episode_id or "").strip()
    source = (source_key or "").strip()
    if not episode or not source:
        return
    normalized = normalize_segmentation_options(options)
    validate_segmentation_options(normalized)
    options_map = load_episode_segmentation_options(
        store,
        logger_obj=logging.getLogger("howimetyourcorpus.core.storage.project_store"),
    )
    options_map.setdefault(episode, {})[source] = normalized
    save_episode_segmentation_options(store, options_map)


def load_project_languages(
    store: Any,
    *,
    logger_obj: logging.Logger,
) -> list[str]:
    """Charge la liste des langues du projet."""
    path = Path(store.root_dir) / store.LANGUAGES_JSON
    if not path.exists():
        return list(store.DEFAULT_LANGUAGES)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        languages = data.get("languages", data if isinstance(data, list) else [])
        return [str(value).strip().lower() for value in languages if str(value).strip()]
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return list(store.DEFAULT_LANGUAGES)


def save_project_languages(store: Any, languages: list[str]) -> None:
    """Sauvegarde la liste des langues du projet."""
    path = Path(store.root_dir) / store.LANGUAGES_JSON
    path.write_text(
        json.dumps(
            {"languages": [str(value).strip().lower() for value in languages if str(value).strip()]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
