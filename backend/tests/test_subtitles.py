"""Tests Phase 3 : parsing SRT/VTT, Cue, normalisation."""

import pytest
from pathlib import Path

from howimetyourcorpus.core.subtitles import Cue, cues_to_audit_rows, parse_srt, parse_vtt, parse_subtitle_file


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def test_cue_dataclass():
    c = Cue(episode_id="S01E01", lang="en", n=0, start_ms=1000, end_ms=3500, text_raw="Hi", text_clean="Hi")
    assert c.cue_id == "S01E01:en:0"


def test_parse_srt_basic():
    content = """1
00:00:01,000 --> 00:00:03,500
Hello world.
2
00:00:04,000 --> 00:00:06,000
How are you?
"""
    cues = parse_srt(content)
    assert len(cues) == 2
    assert cues[0].n == 0
    assert cues[0].start_ms == 1000
    assert cues[0].end_ms == 3500
    assert cues[0].text_raw == "Hello world."
    assert cues[0].text_clean == "Hello world."
    assert cues[1].text_clean == "How are you?"


def test_parse_srt_multi_line():
    content = """1
00:00:01,000 --> 00:00:03,500
Line one.
Line two.
"""
    cues = parse_srt(content)
    assert len(cues) == 1
    assert "Line one" in cues[0].text_raw
    assert "Line two" in cues[0].text_raw
    assert cues[0].text_clean == "Line one. Line two."


def test_parse_vtt_basic():
    content = """WEBVTT

00:00:01.000 --> 00:00:03.500
Hello world.
"""
    cues = parse_vtt(content)
    assert len(cues) == 1
    assert cues[0].start_ms == 1000
    assert cues[0].end_ms == 3500
    assert cues[0].text_clean == "Hello world."


def test_parse_vtt_italics():
    content = """WEBVTT

00:00:01.000 --> 00:00:03.500
<i>Italic text</i> here.
"""
    cues = parse_vtt(content)
    assert len(cues) == 1
    assert "Italic" in cues[0].text_clean
    assert "<i>" not in cues[0].text_clean


def test_parse_subtitle_file_srt():
    path = FIXTURES_DIR / "sample.srt"
    if not path.exists():
        pytest.skip("fixture sample.srt missing")
    cues, fmt = parse_subtitle_file(path)
    assert fmt == "srt"
    assert len(cues) >= 2
    assert any("Legendary" in c.text_clean for c in cues)


def test_parse_subtitle_file_vtt():
    path = FIXTURES_DIR / "sample.vtt"
    if not path.exists():
        pytest.skip("fixture sample.vtt missing")
    cues, fmt = parse_subtitle_file(path)
    assert fmt == "vtt"
    assert len(cues) >= 2
    assert any("Legendary" in c.text_clean for c in cues)


def test_cues_to_audit_rows():
    cues = [
        Cue(episode_id="S01E01", lang="en", n=0, start_ms=1000, end_ms=2000, text_raw="Hi", text_clean="Hi"),
        Cue(episode_id="S01E01", lang="en", n=1, start_ms=2100, end_ms=3000, text_raw="There", text_clean="There"),
    ]
    rows = cues_to_audit_rows(cues)
    assert len(rows) == 2
    assert rows[0]["cue_id"] == "S01E01:en:0"
    assert rows[0]["start_ms"] == 1000
    assert rows[1]["cue_id"] == "S01E01:en:1"
    assert rows[1]["text_clean"] == "There"
