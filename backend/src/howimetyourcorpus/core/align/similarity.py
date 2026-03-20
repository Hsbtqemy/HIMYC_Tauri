"""
Similarité textuelle pour l'alignement (Phase 4).
Utilise rapidfuzz si disponible, sinon fallback token ratio.
"""

from __future__ import annotations

import re

try:
    from rapidfuzz import fuzz
    _HAS_RAPIDFUZZ = True
except ImportError:
    _HAS_RAPIDFUZZ = False


def _tokenize(text: str) -> set[str]:
    """Tokens normalisés (minuscules, non vides)."""
    return {t.lower() for t in re.findall(r"\w+", text) if t}


def text_similarity(a: str, b: str) -> float:
    """
    Retourne un score entre 0 et 1 (1 = identique).
    Utilise rapidfuzz.ratio si disponible, sinon ratio de Jaccard sur les tokens.
    """
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    if _HAS_RAPIDFUZZ:
        return fuzz.ratio(a, b) / 100.0
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0
