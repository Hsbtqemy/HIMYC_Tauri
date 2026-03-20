"""Tests utilitaires timecodes de l'onglet Préparer."""

from __future__ import annotations

import pytest

from howimetyourcorpus.app.tabs.tab_preparer import format_ms_to_srt_time, parse_srt_time_to_ms


def test_parse_srt_time_to_ms_accepts_comma_and_dot() -> None:
    assert parse_srt_time_to_ms("00:00:01,250") == 1250
    assert parse_srt_time_to_ms("00:00:01.250") == 1250


def test_parse_srt_time_to_ms_rejects_invalid_ranges() -> None:
    with pytest.raises(ValueError):
        parse_srt_time_to_ms("00:61:00,000")
    with pytest.raises(ValueError):
        parse_srt_time_to_ms("00:00:61,000")


def test_format_ms_to_srt_time_roundtrip() -> None:
    ms = 3723456
    tc = format_ms_to_srt_time(ms)
    assert tc == "01:02:03,456"
    assert parse_srt_time_to_ms(tc) == ms
