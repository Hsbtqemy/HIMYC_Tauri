"""Helpers ProjectStore pour le domaine personnages (catalogue + assignations)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


def normalize_character_entry(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Normalise une entrée personnage (id/canonical/names_by_lang/aliases) ou None si vide. §8 : aliases = variantes pour assignation semi-auto."""
    if not isinstance(raw, dict):
        return None
    character_id = (str(raw.get("id") or "")).strip()
    canonical = (str(raw.get("canonical") or "")).strip()
    if not character_id and not canonical:
        return None
    character_id = character_id or canonical
    canonical = canonical or character_id

    names_by_lang: dict[str, str] = {}
    raw_names = raw.get("names_by_lang")
    if isinstance(raw_names, dict):
        for lang, name in raw_names.items():
            lang_key = (str(lang or "")).strip().lower()
            label = (str(name or "")).strip()
            if lang_key and label:
                names_by_lang[lang_key] = label

    aliases: list[str] = []
    raw_aliases = raw.get("aliases")
    if isinstance(raw_aliases, list):
        for a in raw_aliases:
            s = (str(a).strip() if a is not None else "").strip()
            if s and s not in aliases:
                aliases.append(s)
    elif isinstance(raw_aliases, str):
        for s in raw_aliases.replace(",", "\n").splitlines():
            s = s.strip()
            if s and s not in aliases:
                aliases.append(s)

    return {
        "id": character_id,
        "canonical": canonical,
        "names_by_lang": names_by_lang,
        "aliases": aliases,
    }


def validate_character_catalog(characters: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Valide le catalogue personnages:
    - id unique (insensible à la casse)
    - alias uniques (id/canonical/names_by_lang) entre personnages
    """
    normalized: list[dict[str, Any]] = []
    id_owner: dict[str, str] = {}
    token_owner: dict[str, str] = {}
    token_owner_display: dict[str, str] = {}
    duplicate_ids: list[str] = []
    token_conflicts: list[tuple[str, str, str]] = []

    for raw in characters or []:
        entry = normalize_character_entry(raw)
        if entry is None:
            continue
        character_id = entry["id"]
        character_id_key = character_id.lower()
        previous_id = id_owner.get(character_id_key)
        if previous_id is not None:
            duplicate_ids.append(character_id)
            continue
        id_owner[character_id_key] = character_id
        normalized.append(entry)

        tokens = {character_id, entry.get("canonical") or ""}
        tokens.update((entry.get("names_by_lang") or {}).values())
        tokens.update(entry.get("aliases") or [])
        for token in tokens:
            token_raw = (token or "").strip()
            if not token_raw:
                continue
            token_key = token_raw.lower()
            previous_owner = token_owner.get(token_key)
            if previous_owner is not None and previous_owner != character_id_key:
                token_conflicts.append(
                    (
                        token_raw,
                        token_owner_display.get(token_key, previous_owner),
                        character_id,
                    )
                )
                continue
            token_owner[token_key] = character_id_key
            token_owner_display[token_key] = character_id

    errors: list[str] = []
    if duplicate_ids:
        errors.append(
            "ID personnages dupliqués: " + ", ".join(sorted({value for value in duplicate_ids if value}))
        )
    if token_conflicts:
        preview = token_conflicts[:6]
        lines = [f"{token!r} ({left} / {right})" for token, left, right in preview]
        suffix = ""
        if len(token_conflicts) > len(preview):
            suffix = f" (+{len(token_conflicts) - len(preview)} autre(s))"
        errors.append("Collision d'alias personnages: " + "; ".join(lines) + suffix)
    if errors:
        raise ValueError("Catalogue personnages invalide: " + " | ".join(errors))
    return normalized


def validate_assignment_references(
    assignments: list[dict[str, Any]],
    valid_character_ids: set[str],
) -> None:
    """Vérifie que toutes les assignations référencent un character_id existant."""
    valid = {character_id.lower() for character_id in valid_character_ids if character_id}
    if not valid:
        orphan_ids = sorted(
            {
                (assignment.get("character_id") or "").strip()
                for assignment in assignments
                if (assignment.get("character_id") or "").strip()
            }
        )
        if orphan_ids:
            raise ValueError(
                "Assignations invalides: aucun personnage défini mais des assignations existent "
                f"({', '.join(orphan_ids[:8])}{'…' if len(orphan_ids) > 8 else ''})."
            )
        return

    orphan_ids = sorted(
        {
            character_id
            for character_id in (
                (assignment.get("character_id") or "").strip()
                for assignment in assignments
            )
            if character_id and character_id.lower() not in valid
        }
    )
    if orphan_ids:
        preview = ", ".join(orphan_ids[:8])
        suffix = "…" if len(orphan_ids) > 8 else ""
        raise ValueError(
            "Assignations invalides: character_id inconnus référencés: "
            f"{preview}{suffix}."
        )


def load_character_names(store: Any, *, logger_obj: logging.Logger) -> list[dict[str, Any]]:
    """
    Charge la liste des personnages du projet (noms canoniques + par langue).
    Format : {"characters": [{"id": "...", "canonical": "...", "names_by_lang": {"en": "...", "fr": "..."}}]}
    """
    path = Path(store.root_dir) / store.CHARACTER_NAMES_JSON
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return []
    return data.get("characters", [])


def save_character_names(store: Any, characters: list[dict[str, Any]]) -> None:
    """
    Sauvegarde la liste des personnages du projet.

    Validation:
    - pas de collisions id/alias entre personnages
    - pas d'assignations référencant un character_id absent
    """
    normalized = validate_character_catalog(characters)
    assignments = load_character_assignments(
        store,
        logger_obj=logging.getLogger("howimetyourcorpus.core.storage.project_store"),
    )
    validate_assignment_references(
        assignments,
        {(character.get("id") or "").strip() for character in normalized},
    )
    path = Path(store.root_dir) / store.CHARACTER_NAMES_JSON
    path.write_text(
        json.dumps({"characters": normalized}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_character_assignments(store: Any, *, logger_obj: logging.Logger) -> list[dict[str, Any]]:
    """Charge les assignations personnage (segment_id ou cue_id -> character_id)."""
    path = Path(store.root_dir) / store.CHARACTER_ASSIGNMENTS_JSON
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger_obj.warning("Impossible de charger %s: %s", path, exc)
        return []
    return data.get("assignments", [])


def save_character_assignments(store: Any, assignments: list[dict[str, Any]]) -> None:
    """Sauvegarde les assignations personnage."""
    path = Path(store.root_dir) / store.CHARACTER_ASSIGNMENTS_JSON
    path.write_text(
        json.dumps({"assignments": assignments}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
