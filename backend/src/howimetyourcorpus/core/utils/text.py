"""Utilitaires texte."""

import re


def extract_episode_id_from_message(message: str) -> str | None:
    """Extrait l'ID épisode (ex. S01E01) depuis un message d'erreur ou de log."""
    match = re.search(r"S\d+E\d+", message, re.IGNORECASE)
    return match.group(0).upper() if match else None


def normalize_whitespace(text: str) -> str:
    """Remplace les séquences d'espaces/blancs par un seul espace."""
    return " ".join(text.split())


# Pattern pour ligne type "Name:" (speaker-like) : première lettre majuscule, puis lettres/car. nom (ex. Marshall:, Ted:, MARSHALL:)
SPEAKER_LIKE_PATTERN = re.compile(r"^[A-Z][A-Za-z0-9_ '\-]{0,24}:")


def looks_like_speaker_line(line: str) -> bool:
    """True si la ligne ressemble à un préfixe de locuteur (ex: Marshall:, TED:)."""
    return bool(line.strip() and SPEAKER_LIKE_PATTERN.match(line.strip()))


def ends_with_sentence_boundary(line: str) -> bool:
    """True si la ligne se termine par . ? ! (séparation forte)."""
    s = line.rstrip()
    return bool(s and s[-1] in ".?!")


def looks_like_didascalia(line: str) -> bool:
    """True si la ligne ressemble à une didascalie () ou []."""
    s = line.strip()
    if not s:
        return False
    return (s.startswith("(") and s.endswith(")")) or (
        s.startswith("[") and s.endswith("]")
    )
