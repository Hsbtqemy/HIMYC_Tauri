"""Helpers ProjectStore pour l'I/O épisodes (html/raw/clean/meta/notes)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.constants import CLEAN_TEXT_FILENAME, EPISODES_DIR_NAME, RAW_TEXT_FILENAME
from howimetyourcorpus.core.models import TransformStats

logger = logging.getLogger(__name__)


def episode_dir(store: Any, episode_id: str) -> Path:
    r"""Répertoire d'un épisode avec assainissement de l'ID (anti path traversal)."""
    safe_id = (
        episode_id.replace("\\", "_").replace("/", "_").replace("..", "_").strip("._ ")
    )
    if not safe_id:
        safe_id = "_"
    return Path(store.root_dir) / EPISODES_DIR_NAME / safe_id


def save_episode_html(store: Any, episode_id: str, html: str) -> None:
    """Sauvegarde le HTML brut de la page épisode."""
    directory = episode_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "page.html").write_text(html, encoding="utf-8")


def save_episode_raw(store: Any, episode_id: str, raw_text: str, meta: dict[str, Any]) -> None:
    """Sauvegarde le texte brut extrait + métadonnées parse."""
    directory = episode_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / RAW_TEXT_FILENAME).write_text(raw_text, encoding="utf-8")
    (directory / "parse_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def save_episode_clean(
    store: Any,
    episode_id: str,
    clean_text: str,
    stats: TransformStats,
    debug: dict[str, Any],
) -> None:
    """Sauvegarde le texte normalisé + stats + debug."""
    directory = episode_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / CLEAN_TEXT_FILENAME).write_text(clean_text, encoding="utf-8")
    transform_meta = {
        "raw_lines": stats.raw_lines,
        "clean_lines": stats.clean_lines,
        "merges": stats.merges,
        "kept_breaks": stats.kept_breaks,
        "duration_ms": stats.duration_ms,
        "debug": debug,
    }
    (directory / "transform_meta.json").write_text(
        json.dumps(transform_meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_episode_text(store: Any, episode_id: str, kind: str = "raw") -> str:
    """Charge le texte d'un épisode (kind = 'raw' ou 'clean')."""
    directory = episode_dir(store, episode_id)
    path = directory / CLEAN_TEXT_FILENAME if kind == "clean" else directory / RAW_TEXT_FILENAME
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def has_episode_html(store: Any, episode_id: str) -> bool:
    """True si le HTML brut de l'épisode existe."""
    return (episode_dir(store, episode_id) / "page.html").exists()


def has_episode_raw(store: Any, episode_id: str) -> bool:
    """True si raw.txt existe."""
    return (episode_dir(store, episode_id) / RAW_TEXT_FILENAME).exists()


def has_episode_clean(store: Any, episode_id: str) -> bool:
    """True si clean.txt existe."""
    return (episode_dir(store, episode_id) / CLEAN_TEXT_FILENAME).exists()


def get_episode_text_presence(
    store: Any,
    *,
    logger_obj: logging.Logger,
) -> tuple[set[str], set[str]]:
    """
    Retourne les IDs d'épisodes disposant d'un `raw.txt` et/ou `clean.txt`.

    Permet de calculer les statuts en lot côté UI (évite N appels disque par épisode).
    """
    raw_ids: set[str] = set()
    clean_ids: set[str] = set()
    episodes_dir = Path(store.root_dir) / EPISODES_DIR_NAME
    if not episodes_dir.exists():
        return raw_ids, clean_ids
    try:
        for ep_dir in episodes_dir.iterdir():
            if not ep_dir.is_dir():
                continue
            episode_id = ep_dir.name
            if (ep_dir / RAW_TEXT_FILENAME).exists():
                raw_ids.add(episode_id)
            if (ep_dir / CLEAN_TEXT_FILENAME).exists():
                clean_ids.add(episode_id)
    except OSError as exc:
        logger_obj.warning("Impossible de scanner %s: %s", episodes_dir, exc)
    return raw_ids, clean_ids


def get_episode_transform_meta_path(store: Any, episode_id: str) -> Path:
    """Chemin du fichier transform_meta.json pour un épisode."""
    return episode_dir(store, episode_id) / "transform_meta.json"


def load_episode_transform_meta(store: Any, episode_id: str) -> dict[str, Any] | None:
    """Charge les métadonnées de transformation d'un épisode, ou None si absent."""
    path = get_episode_transform_meta_path(store, episode_id)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("Impossible de charger %s: %s", path, exc)
        return None
    return payload if isinstance(payload, dict) else None


def load_episode_notes(store: Any, episode_id: str) -> str:
    """Charge les notes Inspecteur d'un épisode."""
    path = episode_dir(store, episode_id) / "notes.txt"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def save_episode_notes(store: Any, episode_id: str, text: str) -> None:
    """Sauvegarde les notes Inspecteur d'un épisode."""
    directory = episode_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "notes.txt").write_text(text, encoding="utf-8")
