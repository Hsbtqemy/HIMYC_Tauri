"""Tests unitaires du moteur CTA — US-301 matrice (1 test par action_id, requis DoR US-302)."""

from __future__ import annotations

import pytest

from howimetyourcorpus.app.tabs.cta_recommender import (
    CtaMode,
    EpisodeState,
    recommend,
)


# ---------------------------------------------------------------------------
# Règle 1 — Déjà aligné (priorité max)
# ---------------------------------------------------------------------------

def test_already_aligned_wins_over_everything() -> None:
    state = EpisodeState(has_alignment_run=True, use_similarity=True,
                         has_clean=True, has_segments=True, has_tracks=True)
    rec = recommend(state)
    assert rec.action_id == "consult_alignment"
    assert rec.mode == CtaMode.ALIGNED


# ---------------------------------------------------------------------------
# Règle 2 — Similarité forcée (transcript = N/A possible)
# ---------------------------------------------------------------------------

def test_similarity_with_tracks_recommends_similarity() -> None:
    state = EpisodeState(has_tracks=True, use_similarity=True)
    rec = recommend(state)
    assert rec.action_id == "run_alignment_similarity"
    assert rec.mode == CtaMode.SIMILARITY


def test_similarity_without_tracks_falls_through() -> None:
    """Similarité ignorée si pas de tracks — on tombe sur une règle inférieure."""
    state = EpisodeState(has_raw=True, use_similarity=True)
    rec = recommend(state)
    assert rec.action_id == "normalize_episode"


# ---------------------------------------------------------------------------
# Règle 3 — Transcript-first complet
# ---------------------------------------------------------------------------

def test_transcript_first_when_complete() -> None:
    state = EpisodeState(has_clean=True, has_segments=True, has_tracks=True)
    rec = recommend(state)
    assert rec.action_id == "run_alignment_transcript_first"
    assert rec.mode == CtaMode.TRANSCRIPT_FIRST


# ---------------------------------------------------------------------------
# Règle 4 — CLEAN + segments, pas de tracks
# ---------------------------------------------------------------------------

def test_import_srt_when_no_tracks() -> None:
    state = EpisodeState(has_clean=True, has_segments=True, has_tracks=False)
    rec = recommend(state)
    assert rec.action_id == "import_srt"
    assert "tracks SRT" in rec.missing


# ---------------------------------------------------------------------------
# Règle 5a — CLEAN présent, pas de segments, tracks présents
# ---------------------------------------------------------------------------

def test_segment_or_srt_only_when_clean_no_segments_with_tracks() -> None:
    state = EpisodeState(has_clean=True, has_segments=False, has_tracks=True)
    rec = recommend(state)
    assert rec.action_id == "segment_or_srt_only"
    assert rec.mode == CtaMode.SRT_ONLY


# ---------------------------------------------------------------------------
# Règle 5b — CLEAN présent, pas de segments, pas de tracks
# ---------------------------------------------------------------------------

def test_segment_episode_when_clean_no_segments_no_tracks() -> None:
    state = EpisodeState(has_clean=True, has_segments=False, has_tracks=False)
    rec = recommend(state)
    assert rec.action_id == "segment_episode"
    assert "segments" in rec.missing


# ---------------------------------------------------------------------------
# Règle 6 — SRT-only pur (transcript = N/A)
# ---------------------------------------------------------------------------

def test_srt_only_when_tracks_no_transcript() -> None:
    state = EpisodeState(has_tracks=True, has_clean=False, has_segments=False)
    rec = recommend(state)
    assert rec.action_id == "run_alignment_srt_only"
    assert rec.mode == CtaMode.SRT_ONLY


# ---------------------------------------------------------------------------
# Règle 7 — RAW seul, pas de CLEAN
# ---------------------------------------------------------------------------

def test_normalize_when_raw_only() -> None:
    state = EpisodeState(has_raw=True, has_clean=False)
    rec = recommend(state)
    assert rec.action_id == "normalize_episode"
    assert "CLEAN" in rec.missing


# ---------------------------------------------------------------------------
# Règle 8 — Rien du tout
# ---------------------------------------------------------------------------

def test_start_when_nothing() -> None:
    state = EpisodeState()
    rec = recommend(state)
    assert rec.action_id == "start"
    assert rec.mode == CtaMode.INCOMPLETE


# ---------------------------------------------------------------------------
# Cas limites DoR US-302
# ---------------------------------------------------------------------------

def test_similarity_forced_with_existing_run_keeps_consult() -> None:
    """Run existant prioritaire même avec similarité cochée."""
    state = EpisodeState(has_alignment_run=True, use_similarity=True, has_tracks=True)
    rec = recommend(state)
    assert rec.action_id == "consult_alignment"


def test_episode_state_missing_returns_correct_list() -> None:
    state = EpisodeState(has_raw=True, has_clean=False, has_segments=False, has_tracks=False)
    assert set(state.missing()) == {"CLEAN", "segments", "tracks SRT"}


def test_episode_state_missing_empty_when_alignable() -> None:
    state = EpisodeState(has_clean=True, has_segments=True, has_tracks=True)
    assert state.missing() == []
