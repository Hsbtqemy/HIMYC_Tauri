"""Tests non-régression Sprint 3 — US-302 (CTA intégré dans l'Inspecteur)."""

from __future__ import annotations

import os

import pytest
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.tab_inspecteur import InspectorTabWidget  # noqa: E402
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex  # noqa: E402
from howimetyourcorpus.core.normalize.profiles import NormalizationProfile  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeConfig:
    normalize_profile = "default_en_v1"


class _FakeStore:
    def __init__(self, *, has_raw: bool = False, has_clean: bool = False) -> None:
        self._has_raw = has_raw
        self._has_clean = has_clean
        self._index = SeriesIndex(
            series_title="T", series_url="u",
            episodes=[EpisodeRef(episode_id="S01E01", season=1, episode=1,
                                 title="Pilot", url="u", source_id="src")],
        )

    def load_series_index(self) -> SeriesIndex:
        return self._index

    def load_episode_notes(self, eid: str) -> str:  # noqa: ARG002
        return ""

    def save_episode_notes(self, eid: str, t: str) -> None:  # noqa: ARG002
        pass

    def load_episode_text(self, eid: str, kind: str = "raw") -> str:  # noqa: ARG002
        return ""

    def load_episode_transform_meta(self, eid: str):  # noqa: ARG002
        return None

    def load_episode_preferred_profiles(self) -> dict:
        return {}

    def save_episode_preferred_profiles(self, p: dict) -> None:  # noqa: ARG002
        pass

    def load_source_profile_defaults(self) -> dict:
        return {}

    def has_episode_raw(self, eid: str) -> bool:  # noqa: ARG002
        return self._has_raw

    def has_episode_clean(self, eid: str) -> bool:  # noqa: ARG002
        return self._has_clean

    def load_custom_profiles(self) -> dict:
        return {}


class _FakeDb:
    def __init__(
        self,
        *,
        has_segments: bool = False,
        has_tracks: bool = False,
        has_alignment_run: bool = False,
    ) -> None:
        self._has_segments = has_segments
        self._has_tracks = has_tracks
        self._has_alignment_run = has_alignment_run

    def get_segments_for_episode(self, eid: str, kind: str | None = None):  # noqa: ARG002
        return [{"kind": "sentence", "n": 1, "text": "x", "start_char": 0, "end_char": 1,
                 "speaker_explicit": ""}] if self._has_segments else []

    def get_tracks_for_episode(self, eid: str):  # noqa: ARG002
        return [{"lang": "en", "format": "srt", "nb_cues": 5}] if self._has_tracks else []

    def get_align_runs_for_episode(self, eid: str):  # noqa: ARG002
        return [{"align_run_id": "r1"}] if self._has_alignment_run else []


def _tab(
    *,
    has_raw: bool = False,
    has_clean: bool = False,
    has_segments: bool = False,
    has_tracks: bool = False,
    has_alignment_run: bool = False,
    use_similarity: bool = False,
) -> InspectorTabWidget:
    store = _FakeStore(has_raw=has_raw, has_clean=has_clean)
    db = _FakeDb(has_segments=has_segments, has_tracks=has_tracks,
                 has_alignment_run=has_alignment_run)
    t = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _s: None,
        show_status=lambda _m, _t=3000: None,
        get_similarity_mode=lambda: use_similarity,
    )
    t.refresh()
    return t


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


# ---------------------------------------------------------------------------
# US-302 — CTA conforme à la matrice US-301
# ---------------------------------------------------------------------------

def test_cta_start_when_nothing(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab()
    assert "Démarrer" in t.cta_label.text()


def test_cta_normalize_when_raw_only(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_raw=True)
    assert "Normaliser" in t.cta_label.text()


def test_cta_segment_when_clean_no_segments_no_tracks(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_raw=True, has_clean=True)
    assert "Segmenter" in t.cta_label.text()


def test_cta_import_srt_when_clean_segments_no_tracks(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_raw=True, has_clean=True, has_segments=True)
    assert "SRT" in t.cta_label.text()


def test_cta_srt_only_when_tracks_no_transcript(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_tracks=True)
    assert "SRT-only" in t.cta_label.text()


def test_cta_transcript_first_when_complete(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_raw=True, has_clean=True, has_segments=True, has_tracks=True)
    assert "transcript-first" in t.cta_label.text()


def test_cta_similarity_when_flag_and_tracks(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_tracks=True, use_similarity=True)
    assert "similarité" in t.cta_label.text()


def test_cta_consult_when_aligned(qapp: QApplication) -> None:  # noqa: ARG001
    t = _tab(has_raw=True, has_clean=True, has_segments=True,
              has_tracks=True, has_alignment_run=True)
    assert "Consulter" in t.cta_label.text()


def test_cta_neutral_without_episode(qapp: QApplication) -> None:  # noqa: ARG001
    """Sans épisode chargé, le CTA affiche '—'."""
    store = _FakeStore.__new__(_FakeStore)
    store._has_raw = False
    store._has_clean = False
    from howimetyourcorpus.core.models import SeriesIndex
    store._index = SeriesIndex(series_title="T", series_url="u", episodes=[])
    store.load_series_index = lambda: store._index
    store.load_episode_notes = lambda e: ""
    store.save_episode_notes = lambda e, t: None
    store.load_episode_text = lambda e, kind="raw": ""
    store.load_episode_transform_meta = lambda e: None
    store.load_episode_preferred_profiles = lambda: {}
    store.save_episode_preferred_profiles = lambda p: None
    store.load_source_profile_defaults = lambda: {}
    store.has_episode_raw = lambda e: False
    store.has_episode_clean = lambda e: False
    store.load_custom_profiles = lambda: {}

    db = _FakeDb()
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _s: None,
        show_status=lambda _m, _t=3000: None,
    )
    tab.refresh()
    assert "—" in tab.cta_label.text()


def test_cta_tooltip_is_detail_text(qapp: QApplication) -> None:  # noqa: ARG001
    """Le tooltip du label CTA contient le détail de la recommandation."""
    t = _tab(has_raw=True, has_clean=True, has_segments=True, has_tracks=True)
    assert len(t.cta_label.toolTip()) > 10


def test_cta_updates_on_episode_change(qapp: QApplication) -> None:  # noqa: ARG001
    """Le CTA se met à jour quand on change d'épisode."""
    from howimetyourcorpus.core.models import SeriesIndex, EpisodeRef

    class _TwoEpStore:
        _index = SeriesIndex(series_title="T", series_url="u", episodes=[
            EpisodeRef(episode_id="S01E01", season=1, episode=1, title="P1", url="u1", source_id="s"),
            EpisodeRef(episode_id="S01E02", season=1, episode=2, title="P2", url="u2", source_id="s"),
        ])
        def load_series_index(self): return self._index
        def load_episode_notes(self, e): return ""
        def save_episode_notes(self, e, t): pass
        def load_episode_text(self, e, kind="raw"): return ""
        def load_episode_transform_meta(self, e): return None
        def load_episode_preferred_profiles(self): return {}
        def save_episode_preferred_profiles(self, p): pass
        def load_source_profile_defaults(self): return {}
        def has_episode_raw(self, e): return e == "S01E01"
        def has_episode_clean(self, e): return False
        def load_custom_profiles(self): return {}

    store = _TwoEpStore()
    db = _FakeDb()
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _s: None,
        show_status=lambda _m, _t=3000: None,
    )
    tab.refresh()

    # S01E01 : has raw → Normaliser
    assert "Normaliser" in tab.cta_label.text()

    # Passer à S01E02 : rien → Démarrer
    tab.set_episode_and_load("S01E02")
    assert "Démarrer" in tab.cta_label.text()
