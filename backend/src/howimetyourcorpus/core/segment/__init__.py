"""Segmentation phrases / utterances (Phase 2 post-MVP)."""

from howimetyourcorpus.core.segment.segmenters import (
    Segment,
    segmenter_sentences,
    segmenter_utterances,
)
from howimetyourcorpus.core.segment.legacy import (
    Phrase,
    Utterance,
    segment_utterances,
    segment_phrases,
    segment_utterances_into_phrases,
)

__all__ = [
    "Segment",
    "segmenter_sentences",
    "segmenter_utterances",
    "Utterance",
    "Phrase",
    "segment_utterances",
    "segment_phrases",
    "segment_utterances_into_phrases",
]
