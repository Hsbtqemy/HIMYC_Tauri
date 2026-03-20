"""Alignement transcript ↔ cues (Phase 4)."""

from howimetyourcorpus.core.align.similarity import text_similarity
from howimetyourcorpus.core.align.aligner import (
    AlignLink,
    align_segments_to_cues,
    align_cues_by_time,
    align_cues_by_order,
    align_cues_by_similarity,
    cues_have_timecodes,
)
from howimetyourcorpus.core.align.run_metadata import (
    normalize_segment_kind,
    parse_run_segment_kind,
    format_segment_kind_label,
)

__all__ = [
    "text_similarity",
    "AlignLink",
    "align_segments_to_cues",
    "align_cues_by_time",
    "align_cues_by_order",
    "align_cues_by_similarity",
    "cues_have_timecodes",
    "normalize_segment_kind",
    "parse_run_segment_kind",
    "format_segment_kind_label",
]
