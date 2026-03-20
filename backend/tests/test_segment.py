"""Tests Phase 2 : segmentation phrases / utterances (segmenters)."""


from howimetyourcorpus.core.segment import (
    Segment,
    segmenter_sentences,
    segmenter_utterances,
)


def test_segment_dataclass():
    s = Segment(episode_id="S01E01", kind="sentence", n=0, start_char=0, end_char=5, text="Hello")
    assert s.segment_id == "S01E01:sentence:0"
    assert s.speaker_explicit is None


def test_segmenter_sentences_basic():
    text = "Hello world. How are you?"
    segs = segmenter_sentences(text, "en")
    assert len(segs) >= 2
    assert all(s.kind == "sentence" for s in segs)
    assert segs[0].text == "Hello world."
    assert segs[0].start_char >= 0 and segs[0].end_char <= len(text)
    texts = [s.text for s in segs]
    assert "Hello world." in texts
    assert "How are you?" in texts


def test_segmenter_sentences_punctuation():
    text = "First. Second! Third?"
    segs = segmenter_sentences(text, "en")
    assert len(segs) == 3
    assert segs[0].text.strip() == "First."
    assert segs[1].text.strip() == "Second!"
    assert segs[2].text.strip() == "Third?"


def test_segmenter_sentences_empty():
    assert segmenter_sentences("", "en") == []
    assert segmenter_sentences("   ", "en") == []


def test_segmenter_utterances_lines():
    text = "Line one.\nLine two.\nLine three."
    segs = segmenter_utterances(text)
    assert len(segs) == 3
    assert all(s.kind == "utterance" for s in segs)
    assert segs[0].text == "Line one."
    assert segs[1].text == "Line two."
    assert segs[2].text == "Line three."


def test_segmenter_utterances_speaker_marker():
    text = "TED: So this is the story.\nMARSHALL: Legendary."
    segs = segmenter_utterances(text)
    assert len(segs) >= 2
    ted = next((s for s in segs if s.speaker_explicit == "TED"), None)
    if ted:
        assert "story" in ted.text
    marshall = next((s for s in segs if s.speaker_explicit == "MARSHALL"), None)
    if marshall:
        assert "Legendary" in marshall.text


def test_segmenter_utterances_double_blank():
    text = "A\n\nB\n\nC"
    segs = segmenter_utterances(text)
    assert len(segs) == 3
    assert [s.text for s in segs] == ["A", "B", "C"]


def test_segmenter_utterances_no_speaker_invented():
    text = "Just a line without speaker."
    segs = segmenter_utterances(text)
    assert len(segs) == 1
    assert segs[0].speaker_explicit is None
