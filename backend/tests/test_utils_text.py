"""Tests pour core.utils.text (extract_episode_id_from_message, etc.)."""

import pytest

from howimetyourcorpus.core.utils.text import (
    extract_episode_id_from_message,
    normalize_whitespace,
)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("", None),
        ("Error: something failed", None),
        ("Fetch failed for S01E01", "S01E01"),
        ("s02e15: timeout", "S02E15"),
        ("Échec S01E01 — connexion refusée", "S01E01"),
        ("Multiple S01E01 and S01E02 failed", "S01E01"),
    ],
)
def test_extract_episode_id_from_message(message: str, expected: str | None) -> None:
    assert extract_episode_id_from_message(message) == expected


def test_normalize_whitespace() -> None:
    assert normalize_whitespace("  a   b  c  ") == "a b c"
