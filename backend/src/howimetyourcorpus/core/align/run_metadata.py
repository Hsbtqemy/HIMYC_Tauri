"""Helpers de métadonnées des runs d'alignement."""

from __future__ import annotations

import json
import logging


def normalize_segment_kind(value: str | None, *, default: str = "sentence") -> str:
    """Normalise le type de segment alignement (`sentence` ou `utterance`)."""
    candidate = (value or default).strip().lower()
    return "utterance" if candidate == "utterance" else "sentence"


def parse_run_segment_kind(
    params_json: str | None,
    *,
    default: str = "sentence",
    run_id: str | None = None,
    logger_obj: logging.Logger | None = None,
) -> tuple[str, bool]:
    """
    Lit `segment_kind` depuis `params_json`.

    Retourne `(segment_kind, is_valid_payload)`:
    - `is_valid_payload=False` si `params_json` absent/invalide,
    - `is_valid_payload=True` si JSON objet valide (même sans clé `segment_kind`).
    """
    fallback = normalize_segment_kind(default, default=default)
    raw = (params_json or "").strip()
    if not raw:
        return fallback, False

    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        if logger_obj is not None:
            logger_obj.debug("Could not parse align run params_json for %s: %s", run_id or "?", exc)
        return fallback, False

    if not isinstance(payload, dict):
        if logger_obj is not None:
            logger_obj.debug(
                "Invalid align run params_json payload for %s: expected object, got %s",
                run_id or "?",
                type(payload).__name__,
            )
        return fallback, False

    return normalize_segment_kind(payload.get("segment_kind"), default=default), True


def format_segment_kind_label(segment_kind: str) -> str:
    """Suffixe lisible pour les combos de run."""
    return " (tours)" if normalize_segment_kind(segment_kind) == "utterance" else " (phrases)"
