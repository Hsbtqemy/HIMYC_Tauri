"""Tests de segmentation/regroupement pour l'onglet Préparer."""

from __future__ import annotations

import pytest

from howimetyourcorpus.core.preparer.segmentation import (
    regroup_utterance_rows_by_character,
    segment_text_to_utterance_rows,
    validate_segmentation_options,
)


def test_segment_text_to_utterance_rows_merges_continuation_marker() -> None:
    text = "TED: Hello...\nthere\nROBIN: Hi"
    rows = segment_text_to_utterance_rows(text)
    assert len(rows) == 2
    assert rows[0]["speaker_explicit"] == "TED"
    assert rows[0]["text"] == "Hello...\nthere"
    assert rows[1]["speaker_explicit"] == "ROBIN"
    assert rows[1]["text"] == "Hi"


def test_validate_segmentation_options_rejects_invalid_regex() -> None:
    with pytest.raises(ValueError):
        validate_segmentation_options(
            {
                "speaker_regex": "(",
                "enable_dash_rule": False,
            }
        )


def test_regroup_unknown_speakers_do_not_collapse_into_single_block() -> None:
    rows = [
        {"segment_id": "", "n": 0, "speaker_explicit": "L1 TED", "text": "A"},
        {"segment_id": "", "n": 1, "speaker_explicit": "L2 ROBIN", "text": "B"},
        {"segment_id": "", "n": 2, "speaker_explicit": "L3 TED", "text": "C"},
    ]
    grouped = regroup_utterance_rows_by_character(
        rows,
        character_lookup={"ted": "ted", "robin": "robin"},
        assignment_by_segment_id={},
        tolerant=True,
    )
    assert len(grouped) == 3
    assert [row["text"] for row in grouped] == ["A", "B", "C"]


def test_regroup_prefers_assignments_when_present() -> None:
    rows = [
        {"segment_id": "S01E01:utterance:0", "n": 0, "speaker_explicit": "L1 TED", "text": "A"},
        {"segment_id": "S01E01:utterance:1", "n": 1, "speaker_explicit": "L2 TED", "text": "B"},
        {"segment_id": "S01E01:utterance:2", "n": 2, "speaker_explicit": "L3 ROBIN", "text": "C"},
    ]
    grouped = regroup_utterance_rows_by_character(
        rows,
        character_lookup={},
        assignment_by_segment_id={
            "S01E01:utterance:0": "ted",
            "S01E01:utterance:1": "ted",
            "S01E01:utterance:2": "robin",
        },
        tolerant=True,
    )
    assert len(grouped) == 2
    assert grouped[0]["text"] == "A\nB"
    assert grouped[1]["text"] == "C"


def test_regroup_tolerant_merges_unmarked_rows_after_character() -> None:
    rows = [
        {"segment_id": "", "n": 0, "speaker_explicit": "Ted", "text": "A"},
        {"segment_id": "", "n": 1, "speaker_explicit": "", "text": "B"},
        {"segment_id": "", "n": 2, "speaker_explicit": "", "text": "C"},
        {"segment_id": "", "n": 3, "speaker_explicit": "Robin", "text": "D"},
    ]
    grouped = regroup_utterance_rows_by_character(
        rows,
        character_lookup={"ted": "ted", "robin": "robin"},
        assignment_by_segment_id={},
        tolerant=True,
    )
    assert len(grouped) == 2
    assert grouped[0]["text"] == "A\nB\nC"
    assert grouped[1]["text"] == "D"
