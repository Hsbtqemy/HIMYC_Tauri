"""Helpers ProjectStore pour l'I/O des artefacts d'alignement."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


def safe_run_id(run_id: str) -> str:
    """Normalise un run_id pour en faire un nom de fichier sûr."""
    return (run_id or "").replace(":", "_").strip() or "_"


def align_dir(store: Any, episode_id: str) -> Path:
    """Répertoire episodes/<id>/align/ pour les runs d'alignement."""
    return store._episode_dir(episode_id) / "align"  # noqa: SLF001


def save_align_audit(
    store: Any,
    episode_id: str,
    run_id: str,
    links_audit: list[dict],
    report: dict,
) -> None:
    """Sauvegarde l'audit d'un run : align/<run_id>.jsonl + report.json."""
    directory = align_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    file_run_id = run_id.replace(":", "_")
    with (directory / f"{file_run_id}.jsonl").open("w", encoding="utf-8") as file_obj:
        for row in links_audit:
            file_obj.write(json.dumps(row, ensure_ascii=False) + "\n")
    (directory / f"{file_run_id}_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def align_grouping_path(store: Any, episode_id: str, run_id: str) -> Path:
    """Chemin de stockage du grouping multi-langues d'un run."""
    return align_dir(store, episode_id) / f"{safe_run_id(run_id)}_groups.json"


def save_align_grouping(store: Any, episode_id: str, run_id: str, grouping: dict[str, Any]) -> None:
    """Sauvegarde un regroupement multi-langues non destructif d'un run d'alignement."""
    directory = align_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = align_grouping_path(store, episode_id, run_id)
    path.write_text(json.dumps(grouping, ensure_ascii=False, indent=2), encoding="utf-8")


def load_align_grouping(
    store: Any,
    episode_id: str,
    run_id: str,
    *,
    logger_obj: logging.Logger,
) -> dict[str, Any] | None:
    """Charge un regroupement multi-langues sauvegardé pour un run, si présent."""
    path = align_grouping_path(store, episode_id, run_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return None
    if not isinstance(data, dict):
        return None
    return data
