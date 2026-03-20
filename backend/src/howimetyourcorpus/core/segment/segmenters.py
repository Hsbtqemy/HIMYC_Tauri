"""
Segmentation phrases / utterances (Phase 2 post-MVP).
Segment dataclass + segmenter_sentences / segmenter_utterances avec start_char, end_char.
Ne jamais inventer de speaker ; speaker_explicit uniquement si détecté (ex. "Marshall:", "TED:").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from howimetyourcorpus.core.utils.text import (
    looks_like_didascalia,
    looks_like_speaker_line,
)

# Pattern pour extraire "Name:" du début d'une ligne (majuscule + lettres/nom, ex. Marshall:, Ted:)
SPEAKER_PREFIX = re.compile(r"^([A-Z][A-Za-z0-9_ '\-]{0,24}):\s*(.*)$", re.DOTALL)

# Découpage en phrases : . ? ! suivis d'un espace ou fin
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z]|\Z)")


@dataclass
class Segment:
    """
    Un segment (phrase ou tour de parole) avec positions et métadonnées.
    segment_id = "{episode_id}:{kind}:{n}" (à définir côté appelant si episode_id connu).
    """

    episode_id: str = ""
    kind: str = "sentence"  # "sentence" | "utterance"
    n: int = 0
    start_char: int = 0
    end_char: int = 0
    text: str = ""
    speaker_explicit: str | None = None  # uniquement si détecté (ex. "Marshall:", "Ted:"), sinon None
    speaker_confidence: float | None = None  # réservé phase 4+
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def segment_id(self) -> str:
        if self.episode_id:
            return f"{self.episode_id}:{self.kind}:{self.n}"
        return f":{self.kind}:{self.n}"


def segmenter_sentences(text: str, lang_hint: str = "en") -> list[Segment]:
    """
    Segmente le texte en phrases (séparation sur . ? !).
    Retourne des Segment avec kind="sentence", start_char, end_char.
    lang_hint réservé pour règles locales (abréviations, etc.).
    """
    text = text.strip()
    if not text:
        return []
    segments: list[Segment] = []
    parts = SENTENCE_BOUNDARY.split(text)
    pos = 0
    for n, part in enumerate(parts):
        p = part.strip()
        if not p:
            continue
        start = text.find(p, pos)
        if start == -1:
            start = pos
        end = start + len(p)
        pos = end
        segments.append(
            Segment(
                kind="sentence",
                n=n,
                start_char=start,
                end_char=end,
                text=p,
                speaker_explicit=None,
                meta={"lang_hint": lang_hint},
            )
        )
    return segments


def segmenter_utterances(text: str) -> list[Segment]:
    """
    Segmente le texte en utterances (tours de parole).
    Découpage structurel : lignes, séparateurs, speaker markers si présents.
    Ne PAS inventer de speaker ; si pattern "Name:" détecté => speaker_explicit=nom (ex. "Marshall", "Ted").
    """
    segments: list[Segment] = []
    lines = text.splitlines()
    pos = 0
    n = 0
    for line in lines:
        s = line.strip()
        if not s:
            pos += len(line) + 1
            continue
        start = text.find(s, pos)
        if start == -1:
            start = pos
        end = start + len(s)
        next_nl = text.find("\n", end)
        pos = (next_nl + 1) if next_nl != -1 else len(text)
        if start > len(text):
            break

        speaker_explicit = None
        if looks_like_speaker_line(line):
            m = SPEAKER_PREFIX.match(s)
            if m:
                speaker_explicit = m.group(1).strip()
                seg_text = m.group(2).strip()
                # Position du texte seul dans le document (après "SPEAKER:")
                prefix_len = len(m.group(0)) - len(seg_text)
                start_inner = start + prefix_len
                end_inner = start_inner + len(seg_text)
                segments.append(
                    Segment(
                        kind="utterance",
                        n=n,
                        start_char=start_inner,
                        end_char=end_inner,
                        text=seg_text,
                        speaker_explicit=speaker_explicit,
                        meta={},
                    )
                )
            else:
                segments.append(
                    Segment(
                        kind="utterance",
                        n=n,
                        start_char=start,
                        end_char=end,
                        text=s,
                        speaker_explicit=None,
                        meta={},
                    )
                )
        elif looks_like_didascalia(line):
            segments.append(
                Segment(
                    kind="utterance",
                    n=n,
                    start_char=start,
                    end_char=end,
                    text=s,
                    speaker_explicit=None,
                    meta={"didascalia": True},
                )
            )
        else:
            segments.append(
                Segment(
                    kind="utterance",
                    n=n,
                    start_char=start,
                    end_char=end,
                    text=s,
                    speaker_explicit=None,
                    meta={},
                )
            )
        n += 1
    return segments
