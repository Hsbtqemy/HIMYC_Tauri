"""Constantes de statut pour le workflow Préparer."""

from __future__ import annotations

PREP_STATUS_CHOICES: list[tuple[str, str]] = [
    ("Brut", "raw"),
    ("Normalisé", "normalized"),
    ("Édité", "edited"),
    ("Vérifié", "verified"),
    ("À revoir", "to_review"),
]
PREP_STATUS_VALUES = {value for _, value in PREP_STATUS_CHOICES}


def normalize_prep_status(value: str | None, *, default: str = "raw") -> str:
    """Normalise un statut en valeur valide."""
    raw = (value or "").strip().lower()
    if raw in PREP_STATUS_VALUES:
        return raw
    return default if default in PREP_STATUS_VALUES else "raw"
