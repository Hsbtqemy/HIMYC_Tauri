"""Règles atomiques de normalisation (césure, séparations fortes)."""

from howimetyourcorpus.core.utils.text import (
    ends_with_sentence_boundary,
    looks_like_didascalia,
    looks_like_speaker_line,
)

# Nombre max d'exemples de merges à garder pour le debug
MAX_MERGE_EXAMPLES = 20


def is_strong_break_before(line: str) -> bool:
    """True si la ligne précédente (dans le sens du flux) implique une coupure à garder."""
    return (
        line.strip() == ""
        or looks_like_speaker_line(line)
        or looks_like_didascalia(line)
    )


def should_merge(prev_line: str, next_line: str) -> bool:
    """
    True si on doit fusionner (remplacer \\n par espace) entre prev_line et next_line.
    On fusionne quand ce n'est pas une séparation forte :
    - pas de fin de phrase sur prev_line (.?!)
    - next_line n'est pas une ligne vide, speaker ou didascalie
    """
    if not next_line.strip():
        return False
    if ends_with_sentence_boundary(prev_line):
        return False
    if looks_like_speaker_line(next_line) or looks_like_didascalia(next_line):
        return False
    return True
