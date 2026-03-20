"""Tests unitaires des helpers metadata des runs d'alignement."""

from __future__ import annotations

import logging

from howimetyourcorpus.core.align.run_metadata import (
    format_segment_kind_label,
    normalize_segment_kind,
    parse_run_segment_kind,
)


def test_normalize_segment_kind() -> None:
    assert normalize_segment_kind("utterance") == "utterance"
    assert normalize_segment_kind("UtTeRaNcE") == "utterance"
    assert normalize_segment_kind("sentence") == "sentence"
    assert normalize_segment_kind("unknown") == "sentence"
    assert normalize_segment_kind(None) == "sentence"


def test_parse_run_segment_kind_empty_payload() -> None:
    kind, valid = parse_run_segment_kind(None)
    assert kind == "sentence"
    assert valid is False


def test_parse_run_segment_kind_valid_payload() -> None:
    kind, valid = parse_run_segment_kind('{"segment_kind":"utterance"}')
    assert kind == "utterance"
    assert valid is True


def test_parse_run_segment_kind_valid_object_without_key() -> None:
    kind, valid = parse_run_segment_kind('{"foo":"bar"}')
    assert kind == "sentence"
    assert valid is True


def test_parse_run_segment_kind_invalid_payload_logs_debug(caplog) -> None:
    with caplog.at_level(logging.DEBUG):
        kind, valid = parse_run_segment_kind(
            '{"segment_kind":',
            run_id="run-1",
            logger_obj=logging.getLogger("test.align.run_metadata"),
        )
    assert kind == "sentence"
    assert valid is False
    assert "Could not parse align run params_json" in caplog.text


def test_parse_run_segment_kind_non_object_payload_logs_debug(caplog) -> None:
    with caplog.at_level(logging.DEBUG):
        kind, valid = parse_run_segment_kind(
            "[]",
            run_id="run-2",
            logger_obj=logging.getLogger("test.align.run_metadata"),
        )
    assert kind == "sentence"
    assert valid is False
    assert "expected object" in caplog.text


def test_format_segment_kind_label() -> None:
    assert format_segment_kind_label("utterance") == " (tours)"
    assert format_segment_kind_label("sentence") == " (phrases)"
    assert format_segment_kind_label("weird") == " (phrases)"
