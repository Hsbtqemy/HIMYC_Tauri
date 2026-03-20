"""Helpers ProjectStore pour la persistance des profils custom."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.normalize.profiles import NormalizationProfile


def load_custom_profiles(store: Any) -> dict[str, NormalizationProfile]:
    """
    Charge les profils personnalisés du projet (fichier profiles.json à la racine).
    Lève ValueError si le JSON ou son schéma est invalide.
    """
    from howimetyourcorpus.core.normalize.profiles import ProfileValidationError, validate_profiles_json

    path = Path(store.root_dir) / store.PROFILES_JSON
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Fichier profiles.json invalide (syntaxe JSON) : {exc}") from exc

    try:
        validate_profiles_json(data)
    except ProfileValidationError as exc:
        raise ValueError(f"Fichier profiles.json invalide : {exc}") from exc

    out: dict[str, NormalizationProfile] = {}
    for profile_data in data.get("profiles", []):
        profile_id = profile_data.get("id") or ""
        if not profile_id or not isinstance(profile_data.get("merge_subtitle_breaks"), bool):
            continue

        custom_regex_rules = []
        if "custom_regex_rules" in profile_data and isinstance(profile_data["custom_regex_rules"], list):
            for rule in profile_data["custom_regex_rules"]:
                if isinstance(rule, dict) and "pattern" in rule and "replacement" in rule:
                    custom_regex_rules.append((rule["pattern"], rule["replacement"]))

        out[profile_id] = NormalizationProfile(
            id=profile_id,
            merge_subtitle_breaks=bool(profile_data.get("merge_subtitle_breaks", True)),
            max_merge_examples_in_debug=int(profile_data.get("max_merge_examples_in_debug", 20)),
            fix_double_spaces=bool(profile_data.get("fix_double_spaces", True)),
            fix_french_punctuation=bool(profile_data.get("fix_french_punctuation", False)),
            normalize_apostrophes=bool(profile_data.get("normalize_apostrophes", False)),
            normalize_quotes=bool(profile_data.get("normalize_quotes", False)),
            strip_line_spaces=bool(profile_data.get("strip_line_spaces", True)),
            case_transform=str(profile_data.get("case_transform", "none")),
            custom_regex_rules=custom_regex_rules,
        )
    return out


def save_custom_profiles(store: Any, profiles: list[dict[str, Any]]) -> None:
    """Sauvegarde les profils personnalisés du projet (profiles.json)."""
    path = Path(store.root_dir) / store.PROFILES_JSON
    path.write_text(
        json.dumps({"profiles": profiles}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
