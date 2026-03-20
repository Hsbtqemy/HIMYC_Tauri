"""Tests Phase 4 : similarité et alignement segment↔cues, cues↔cues."""


from howimetyourcorpus.core.align import (
    text_similarity,
    align_segments_to_cues,
    align_cues_by_time,
    align_cues_by_order,
    align_cues_by_similarity,
    cues_have_timecodes,
    AlignLink,
)


def test_text_similarity_identical():
    assert text_similarity("Hello world.", "Hello world.") == 1.0


def test_text_similarity_empty():
    assert text_similarity("", "") == 1.0
    assert text_similarity("a", "") == 0.0
    assert text_similarity("", "b") == 0.0


def test_text_similarity_partial():
    s = text_similarity("Hello world.", "Hello")
    assert 0 < s <= 1.0


def test_align_segments_to_cues_one_match():
    segments = [{"segment_id": "S01E01:sentence:0", "text": "Legendary word."}]
    cues = [
        {"cue_id": "S01E01:en:0", "text_clean": "Legendary word.", "start_ms": 1000, "end_ms": 3500},
    ]
    links = align_segments_to_cues(segments, cues, min_confidence=0.3)
    assert len(links) == 1
    assert links[0].segment_id == "S01E01:sentence:0"
    assert links[0].cue_id == "S01E01:en:0"
    assert links[0].role == "pivot"
    assert links[0].confidence >= 0.3


def test_align_segments_to_cues_no_match():
    segments = [{"segment_id": "S01E01:sentence:0", "text": "Completely different."}]
    cues = [{"cue_id": "S01E01:en:0", "text_clean": "Legendary word.", "start_ms": 1000, "end_ms": 3500}]
    links = align_segments_to_cues(segments, cues, min_confidence=0.9)
    assert len(links) == 0


def test_align_cues_by_time():
    cues_en = [{"cue_id": "S01E01:en:0", "start_ms": 1000, "end_ms": 3500}]
    cues_fr = [{"cue_id": "S01E01:fr:0", "start_ms": 1000, "end_ms": 3400, "lang": "fr"}]
    links = align_cues_by_time(cues_en, cues_fr, overlap_ms_threshold=100)
    assert len(links) == 1
    assert links[0].cue_id == "S01E01:en:0"
    assert links[0].cue_id_target == "S01E01:fr:0"
    assert links[0].role == "target"


def test_cues_have_timecodes():
    assert cues_have_timecodes([{"start_ms": 0, "end_ms": 1000}]) is True
    assert cues_have_timecodes([{"start_ms": 0, "end_ms": 0}]) is False
    assert cues_have_timecodes([{"start_ms": 0, "end_ms": 0}, {"start_ms": 0, "end_ms": 500}]) is True
    assert cues_have_timecodes([]) is False


def test_align_cues_by_order():
    cues_en = [
        {"cue_id": "S01E01:en:0", "start_ms": 0, "end_ms": 0},
        {"cue_id": "S01E01:en:1", "start_ms": 0, "end_ms": 0},
    ]
    cues_it = [
        {"cue_id": "S01E01:it:0", "start_ms": 0, "end_ms": 0, "lang": "it"},
        {"cue_id": "S01E01:it:1", "start_ms": 0, "end_ms": 0, "lang": "it"},
    ]
    links = align_cues_by_order(cues_en, cues_it)
    assert len(links) == 2
    assert links[0].cue_id == "S01E01:en:0" and links[0].cue_id_target == "S01E01:it:0"
    assert links[1].cue_id == "S01E01:en:1" and links[1].cue_id_target == "S01E01:it:1"
    assert links[0].confidence == 1.0
    assert links[0].meta.get("align") == "by_order"


def test_align_cues_by_similarity():
    """Alignement EN↔cible par similarité textuelle (sans timecodes)."""
    cues_en = [
        {"cue_id": "S01E01:en:0", "text_clean": "Hello world.", "start_ms": 0, "end_ms": 0},
        {"cue_id": "S01E01:en:1", "text_clean": "Goodbye.", "start_ms": 0, "end_ms": 0},
    ]
    cues_fr = [
        {"cue_id": "S01E01:fr:0", "text_clean": "Hello world.", "lang": "fr"},
        {"cue_id": "S01E01:fr:1", "text_clean": "Goodbye.", "lang": "fr"},
    ]
    links = align_cues_by_similarity(cues_en, cues_fr, min_confidence=0.3)
    assert len(links) == 2
    assert links[0].cue_id == "S01E01:en:0" and links[0].cue_id_target == "S01E01:fr:0"
    assert links[1].cue_id == "S01E01:en:1" and links[1].cue_id_target == "S01E01:fr:1"
    assert all(link.role == "target" for link in links)
    assert all(link.meta.get("align") == "by_similarity" for link in links)


def test_align_cues_by_order_shorter_target():
    cues_en = [{"cue_id": "en:0"}, {"cue_id": "en:1"}, {"cue_id": "en:2"}]
    cues_fr = [{"cue_id": "fr:0", "lang": "fr"}, {"cue_id": "fr:1", "lang": "fr"}]
    links = align_cues_by_order(cues_en, cues_fr)
    assert len(links) == 2
    assert links[0].cue_id_target == "fr:0" and links[1].cue_id_target == "fr:1"


def test_align_link_to_dict():
    link = AlignLink(segment_id="s1", cue_id="c1", role="pivot", confidence=0.8, status="auto")
    d = link.to_dict(link_id="run:0")
    assert d["link_id"] == "run:0"
    assert d["segment_id"] == "s1"
    assert d["cue_id"] == "c1"
    assert d["confidence"] == 0.8


def test_align_no_timecodes_order_first_then_similarity():
    """Backlog §3 : sans timecodes, on utilise l'ordre (cue i ↔ cue i) d'abord, similarité en secours."""
    cues_en = [
        {"cue_id": "S01E01:en:0", "text_clean": "First.", "start_ms": 0, "end_ms": 0},
        {"cue_id": "S01E01:en:1", "text_clean": "Second.", "start_ms": 0, "end_ms": 0},
    ]
    cues_fr = [
        {"cue_id": "S01E01:fr:0", "text_clean": "Premier.", "lang": "fr", "start_ms": 0, "end_ms": 0},
        {"cue_id": "S01E01:fr:1", "text_clean": "Deuxième.", "lang": "fr", "start_ms": 0, "end_ms": 0},
    ]
    assert cues_have_timecodes(cues_en) is False
    assert cues_have_timecodes(cues_fr) is False
    # Politique pipeline : ordre d'abord quand les deux n'ont pas de timecodes
    links_order = align_cues_by_order(cues_en, cues_fr)
    assert len(links_order) == 2
    assert links_order[0].cue_id == "S01E01:en:0" and links_order[0].cue_id_target == "S01E01:fr:0"
    assert links_order[1].cue_id == "S01E01:en:1" and links_order[1].cue_id_target == "S01E01:fr:1"
    assert all(l.meta.get("align") == "by_order" for l in links_order)
