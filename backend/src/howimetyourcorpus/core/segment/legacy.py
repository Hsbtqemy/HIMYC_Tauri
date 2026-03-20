"""Legacy segmentation (Utterance/Phrase) pour exports — conservé pour compatibilité."""

from __future__ import annotations

import re
from dataclasses import dataclass

from howimetyourcorpus.core.utils.text import (
    looks_like_didascalia,
    looks_like_speaker_line,
)

SPEAKER_PREFIX = re.compile(r"^([A-Z][A-Za-z0-9_ '\-]{0,24}):\s*(.*)$", re.DOTALL)
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z]|\Z)")


@dataclass
class Utterance:
    """Un tour de parole : locuteur optionnel + texte."""

    speaker: str | None
    text: str
    index: int = 0


@dataclass
class Phrase:
    """Une phrase (délimitée par . ? !)."""

    text: str
    index: int = 0
    speaker: str | None = None


def segment_utterances(clean_text: str) -> list[Utterance]:
    """Segmente le texte normalisé en utterances (tours de parole)."""
    utterances: list[Utterance] = []
    lines = [ln for ln in clean_text.splitlines()]
    idx = 0
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if looks_like_speaker_line(line):
            m = SPEAKER_PREFIX.match(s)
            if m:
                speaker = m.group(1).strip()
                text = m.group(2).strip()
                utterances.append(Utterance(speaker=speaker, text=text, index=idx))
                idx += 1
            else:
                utterances.append(Utterance(speaker=None, text=s, index=idx))
                idx += 1
        elif looks_like_didascalia(line):
            utterances.append(Utterance(speaker=None, text=s, index=idx))
            idx += 1
        else:
            utterances.append(Utterance(speaker=None, text=s, index=idx))
            idx += 1
    return utterances


def segment_phrases(text: str, speaker: str | None = None) -> list[Phrase]:
    """Segmente un bloc de texte en phrases (séparation sur . ? !)."""
    text = text.strip()
    if not text:
        return []
    parts = SENTENCE_BOUNDARY.split(text)
    return [
        Phrase(text=p.strip(), index=i, speaker=speaker)
        for i, p in enumerate(parts)
        if p.strip()
    ]


def segment_utterances_into_phrases(clean_text: str) -> list[Phrase]:
    """Segmente le texte en utterances puis chaque utterance en phrases."""
    phrases: list[Phrase] = []
    utterances = segment_utterances(clean_text)
    global_idx = 0
    for u in utterances:
        for ph in segment_phrases(u.text, speaker=u.speaker):
            phrases.append(Phrase(text=ph.text, index=global_idx, speaker=ph.speaker))
            global_idx += 1
    return phrases
