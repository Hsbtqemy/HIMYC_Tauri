"""Tests du parsing des noms de fichiers SRT/VTT pour l'import en masse."""

from __future__ import annotations

from pathlib import Path

import pytest

from howimetyourcorpus.app.tabs.tab_sous_titres import (
    _normalize_episode_id,
    _parse_subtitle_filename,
)


@pytest.mark.parametrize(
    ("s", "expected"),
    [
        ("S01E01", "S01E01"),
        ("s01e01", "S01E01"),
        ("S1E1", "S01E01"),
        ("1x01", "S01E01"),
        ("1x1", "S01E01"),
        ("10x05", "S10E05"),
        ("", None),
        ("invalid", None),
    ],
)
def test_normalize_episode_id(s: str, expected: str | None) -> None:
    assert _normalize_episode_id(s) == expected


@pytest.mark.parametrize(
    ("path_name", "expected_ep", "expected_lang"),
    [
        ("S01E01_en.srt", "S01E01", "en"),
        ("s01e01_fr.srt", "S01E01", "fr"),
        ("S01E01.fr.vtt", "S01E01", "fr"),
        ("Show - 1x01 - Title.en.srt", "S01E01", "en"),
        ("Something_2x03_extra.it.srt", "S02E03", "it"),
        ("en.srt", None, None),
        ("random.srt", None, None),
    ],
)
def test_parse_subtitle_filename(
    path_name: str, expected_ep: str | None, expected_lang: str | None
) -> None:
    path = Path("/tmp") / path_name
    ep, lang = _parse_subtitle_filename(path)
    assert ep == expected_ep
    assert lang == expected_lang
