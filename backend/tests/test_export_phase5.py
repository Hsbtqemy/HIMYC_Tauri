"""Tests Phase 5 : export concordancier parallèle et rapport HTML."""

import pytest
from pathlib import Path
import tempfile

from howimetyourcorpus.core.export_utils import (
    export_parallel_concordance_csv,
    export_parallel_concordance_tsv,
    export_parallel_concordance_jsonl,
    export_parallel_concordance_txt,
    export_align_report_html,
    export_segments_srt_like,
    PARALLEL_CONCORDANCE_COLUMNS,
)


@pytest.fixture
def sample_rows():
    return [
        {
            "segment_id": "S01E01:sentence:0",
            "text_segment": "Hello world",
            "text_en": "Hello world",
            "confidence_pivot": 0.9,
            "text_fr": "Bonjour le monde",
            "confidence_fr": 1.0,
            "text_it": "Ciao mondo",
            "confidence_it": 0.95,
        },
    ]


@pytest.fixture
def sample_stats():
    return {
        "episode_id": "S01E01",
        "run_id": "S01E01:align:20250212",
        "nb_links": 10,
        "nb_pivot": 5,
        "nb_target": 5,
        "by_status": {"auto": 8, "accepted": 2},
        "avg_confidence": 0.85,
    }


def test_export_parallel_concordance_csv(sample_rows):
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as f:
        path = Path(f.name)
    try:
        export_parallel_concordance_csv(sample_rows, path)
        text = path.read_text(encoding="utf-8")
        assert "segment_id" in text
        assert "Hello world" in text
        assert "Bonjour le monde" in text
    finally:
        path.unlink(missing_ok=True)


def test_export_parallel_concordance_tsv(sample_rows):
    with tempfile.NamedTemporaryFile(suffix=".tsv", delete=False) as f:
        path = Path(f.name)
    try:
        export_parallel_concordance_tsv(sample_rows, path)
        text = path.read_text(encoding="utf-8")
        assert "segment_id" in text
        assert "\t" in text
    finally:
        path.unlink(missing_ok=True)


def test_export_parallel_concordance_jsonl(sample_rows):
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
        path = Path(f.name)
    try:
        export_parallel_concordance_jsonl(sample_rows, path)
        lines = path.read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 1
        import json
        row = json.loads(lines[0])
        assert row["text_segment"] == "Hello world"
        assert row["text_fr"] == "Bonjour le monde"
    finally:
        path.unlink(missing_ok=True)


def test_export_parallel_concordance_txt_accepts_numeric_confidence(sample_rows):
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        path = Path(f.name)
    try:
        export_parallel_concordance_txt(sample_rows, path)
        text = path.read_text(encoding="utf-8")
        assert "0.9" in text
        assert "Bonjour le monde" in text
    finally:
        path.unlink(missing_ok=True)


def test_export_align_report_html(sample_stats, sample_rows):
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as f:
        path = Path(f.name)
    try:
        export_align_report_html(sample_stats, sample_rows, "S01E01", "run1", path)
        text = path.read_text(encoding="utf-8")
        assert "Statistiques" in text
        assert "Liens totaux" in text
        assert "10" in text
        assert "Échantillon" in text or "concordancier" in text.lower()
    finally:
        path.unlink(missing_ok=True)


def test_parallel_concordance_columns():
    assert "segment_id" in PARALLEL_CONCORDANCE_COLUMNS
    assert "text_segment" in PARALLEL_CONCORDANCE_COLUMNS
    assert "text_en" in PARALLEL_CONCORDANCE_COLUMNS
    assert "text_fr" in PARALLEL_CONCORDANCE_COLUMNS
    assert "text_it" in PARALLEL_CONCORDANCE_COLUMNS


def test_export_segments_srt_like():
    segments = [
        {"text": "First segment.", "n": 0},
        {"text": "Second segment.", "n": 1},
    ]
    with tempfile.NamedTemporaryFile(suffix=".srt", delete=False) as f:
        path = Path(f.name)
    try:
        export_segments_srt_like(segments, path)
        text = path.read_text(encoding="utf-8")
        assert "1\n" in text
        assert "00:00:00,000 --> 00:00:00,000" in text
        assert "First segment." in text
        assert "2\n" in text
        assert "Second segment." in text
    finally:
        path.unlink(missing_ok=True)
