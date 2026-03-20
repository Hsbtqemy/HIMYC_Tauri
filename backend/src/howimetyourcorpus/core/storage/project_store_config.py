"""Helpers ProjectStore pour la configuration TOML du projet."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from howimetyourcorpus.core.constants import EPISODES_DIR_NAME
from howimetyourcorpus.core.models import ProjectConfig


def read_toml(path: Path) -> dict[str, Any]:
    """Lit un fichier TOML (stdlib tomllib en 3.11+)."""
    try:
        import tomllib
    except ImportError:
        import tomli as tomllib  # type: ignore
    with open(path, "rb") as file_obj:
        return tomllib.load(file_obj)


def write_toml(path: Path, data: dict[str, Any]) -> None:
    """Écrit un fichier TOML (écriture manuelle pour éviter une dépendance)."""
    lines: list[str] = []
    for key, value in data.items():
        if isinstance(value, str):
            escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
            lines.append(f'{key} = "{escaped}"')
        elif isinstance(value, bool):
            lines.append(f"{key} = {str(value).lower()}")
        elif isinstance(value, (int, float)):
            lines.append(f"{key} = {value}")
        else:
            lines.append(f'{key} = "{value!s}"')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def load_project_config(path: Path) -> dict[str, Any]:
    """API publique: charge la config projet depuis un fichier TOML."""
    return read_toml(path)


def init_project(config: ProjectConfig) -> None:
    """Crée le layout du projet et écrit config.toml."""
    root = Path(config.root_dir)
    root.mkdir(parents=True, exist_ok=True)
    (root / "runs").mkdir(exist_ok=True)
    (root / EPISODES_DIR_NAME).mkdir(exist_ok=True)
    (root / ".cache").mkdir(exist_ok=True)  # Cache HTTP pour éviter requêtes répétées.

    data = {
        "project_name": config.project_name,
        "source_id": config.source_id,
        "series_url": config.series_url,
        "rate_limit_s": config.rate_limit_s,
        "user_agent": config.user_agent,
        "normalize_profile": config.normalize_profile,
    }
    write_toml(root / "config.toml", data)


def load_config_extra(store: Any) -> dict[str, Any]:
    """Charge config.toml en dict (clés optionnelles : opensubtitles_api_key, series_imdb_id, etc.)."""
    path = Path(store.root_dir) / "config.toml"
    if not path.exists():
        return {}
    return read_toml(path)


def save_config_extra(store: Any, updates: dict[str, str | int | float | bool]) -> None:
    """Met à jour des clés dans config.toml (ex. opensubtitles_api_key, series_imdb_id)."""
    path = Path(store.root_dir) / "config.toml"
    data = dict(load_config_extra(store))
    for key, value in updates.items():
        if value is not None and value != "":
            data[key] = value
    if data:
        write_toml(path, data)


def save_config_main(
    store: Any,
    *,
    series_url: str = "",
    source_id: str | None = None,
    rate_limit_s: float | None = None,
    normalize_profile: str | None = None,
    project_name: str | None = None,
) -> None:
    """Met à jour les champs principaux de config.toml sans écraser les clés extra."""
    path = Path(store.root_dir) / "config.toml"
    if not path.exists():
        return
    data = dict(read_toml(path))
    if series_url is not None:
        data["series_url"] = series_url
    if source_id is not None:
        data["source_id"] = source_id
    if rate_limit_s is not None:
        data["rate_limit_s"] = rate_limit_s
    if normalize_profile is not None:
        data["normalize_profile"] = normalize_profile
    if project_name is not None:
        data["project_name"] = project_name
    write_toml(path, data)
