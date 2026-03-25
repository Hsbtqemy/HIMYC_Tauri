"""Segmentation phrases / utterances (Phase 2 post-MVP)."""

from howimetyourcorpus.core.segment.segmenters import (
    Segment,
    segmenter_sentences,
    segmenter_utterances,
    segmenter_utterances_with_options,
    utterance_rows_to_segments,
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
    "segmenter_utterances_with_options",
    "utterance_rows_to_segments",
    "Utterance",
    "Phrase",
    "segment_utterances",
    "segment_phrases",
    "segment_utterances_into_phrases",
]
