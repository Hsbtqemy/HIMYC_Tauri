"""Tests non-régression Sprint 1 — US-101/103/104 (blocs, disabled reasons, Prêt alignement)."""

from __future__ import annotations

import os

import pytest
from PySide6.QtWidgets import QApplication, QGroupBox

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
    """Store configurable : contrôle fin de has_raw / has_clean."""

    def __init__(self, *, has_raw: bool = True, has_clean: bool = True) -> None:
        self._has_raw = has_raw
        self._has_clean = has_clean
        self._index = SeriesIndex(
            series_title="TEST",
            series_url="https://example.test",
            episodes=[
                EpisodeRef(
                    episode_id="S01E01",
                    season=1,
                    episode=1,
                    title="Pilot",
                    url="https://example.test/S01E01",
                    source_id="test_src",
                ),
            ],
        )

    def load_series_index(self) -> SeriesIndex:
        return self._index

    def load_episode_notes(self, episode_id: str) -> str:  # noqa: ARG002
        return ""

    def save_episode_notes(self, episode_id: str, text: str) -> None:  # noqa: ARG002
        pass

    def load_episode_text(self, episode_id: str, kind: str = "raw") -> str:  # noqa: ARG002
        return "text"

    def load_episode_transform_meta(self, episode_id: str):  # noqa: ARG002
        return None

    def load_episode_preferred_profiles(self) -> dict[str, str]:
        return {}

    def save_episode_preferred_profiles(self, preferred: dict[str, str]) -> None:  # noqa: ARG002
        pass

    def load_source_profile_defaults(self) -> dict[str, str]:
        return {}

    def has_episode_raw(self, episode_id: str) -> bool:  # noqa: ARG002
        return self._has_raw

    def has_episode_clean(self, episode_id: str) -> bool:  # noqa: ARG002
        return self._has_clean

    def load_custom_profiles(self) -> dict[str, NormalizationProfile]:
        return {}


class _FakeDb:
    """DB configurable : contrôle de has_segments / has_tracks."""

    def __init__(self, *, has_segments: bool = True, has_tracks: bool = True) -> None:
        self._has_segments = has_segments
        self._has_tracks = has_tracks

    def get_segments_for_episode(self, episode_id: str, kind: str | None = None):  # noqa: ARG002
        if not self._has_segments:
            return []
        return [{"kind": "sentence", "n": 1, "speaker_explicit": "", "text": "hello", "start_char": 0, "end_char": 5}]

    def get_tracks_for_episode(self, episode_id: str):  # noqa: ARG002
        if not self._has_tracks:
            return []
        return [{"track_id": "t1", "lang": "en"}]


def _make_tab(
    *,
    has_raw: bool = True,
    has_clean: bool = True,
    has_segments: bool = True,
    has_tracks: bool = True,
) -> InspectorTabWidget:
    store = _FakeStore(has_raw=has_raw, has_clean=has_clean)
    db = _FakeDb(has_segments=has_segments, has_tracks=has_tracks)
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _steps: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    tab.refresh()
    return tab


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


# ---------------------------------------------------------------------------
# US-101 — 3 blocs visuels
# ---------------------------------------------------------------------------

def test_inspecteur_has_three_blocs(qapp: QApplication) -> None:  # noqa: ARG001
    """Les blocs Consulter / Produire / Avancé sont présents dans le layout."""
    tab = _make_tab()
    group_titles = {w.title() for w in tab.findChildren(QGroupBox)}
    assert "Consulter" in group_titles
    assert "Produire" in group_titles
    # Avancé est devenu un toggle : vérifier via l'attribut dédié
    assert hasattr(tab, "_avance_toggle_btn")
    assert "Avancé" in tab._avance_toggle_btn.text()


def test_inspecteur_no_extra_unintended_groups(qapp: QApplication) -> None:  # noqa: ARG001
    """Aucun groupe résiduel inattendu (ex: 'Normalisation (transcript)' supprimé)."""
    tab = _make_tab()
    group_titles = {w.title() for w in tab.findChildren(QGroupBox)}
    assert "Normalisation (transcript)" not in group_titles


# ---------------------------------------------------------------------------
# US-103 — Disabled reasons
# ---------------------------------------------------------------------------

def test_norm_btn_enabled_with_raw(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_raw=True)
    assert tab.inspect_norm_btn.isEnabled()


def test_norm_btn_disabled_without_raw(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_raw=False)
    assert not tab.inspect_norm_btn.isEnabled()
    assert "RAW" in tab.inspect_norm_btn.toolTip()


def test_segment_btn_enabled_with_clean(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_clean=True)
    assert tab.inspect_segment_btn.isEnabled()


def test_segment_btn_disabled_without_clean(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_clean=False)
    assert not tab.inspect_segment_btn.isEnabled()
    assert "CLEAN" in tab.inspect_segment_btn.toolTip()


def test_export_btn_enabled_with_segments(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_segments=True)
    assert tab.inspect_export_segments_btn.isEnabled()


def test_export_btn_disabled_without_segments(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_segments=False)
    assert not tab.inspect_export_segments_btn.isEnabled()
    assert "segment" in tab.inspect_export_segments_btn.toolTip().lower()


def test_all_action_buttons_disabled_without_episode(qapp: QApplication) -> None:  # noqa: ARG001
    """Sans épisode chargé (store vide), tous les boutons d'action sont désactivés."""
    store = _FakeStore.__new__(_FakeStore)
    store._has_raw = False
    store._has_clean = False
    from howimetyourcorpus.core.models import SeriesIndex
    store._index = SeriesIndex(series_title="T", series_url="u", episodes=[])
    store.load_series_index = lambda: store._index
    store.load_episode_notes = lambda eid: ""
    store.save_episode_notes = lambda eid, t: None
    store.load_episode_text = lambda eid, kind="raw": ""
    store.load_episode_transform_meta = lambda eid: None
    store.load_episode_preferred_profiles = lambda: {}
    store.save_episode_preferred_profiles = lambda p: None
    store.load_source_profile_defaults = lambda: {}
    store.has_episode_raw = lambda eid: False
    store.has_episode_clean = lambda eid: False
    store.load_custom_profiles = lambda: {}

    db = _FakeDb(has_segments=False, has_tracks=False)
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _steps: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    tab.refresh()

    assert not tab.inspect_norm_btn.isEnabled()
    assert not tab.inspect_segment_btn.isEnabled()
    assert not tab.inspect_export_segments_btn.isEnabled()


# ---------------------------------------------------------------------------
# US-104 — Statut Prêt alignement
# ---------------------------------------------------------------------------

def test_pret_alignement_oui_when_all_present(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_raw=True, has_clean=True, has_segments=True, has_tracks=True)
    assert "Oui" in tab.pret_alignement_label.text()


def test_pret_alignement_non_missing_clean(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_clean=False, has_segments=False, has_tracks=False)
    text = tab.pret_alignement_label.text()
    assert "Non" in text
    assert "CLEAN" in text


def test_pret_alignement_non_missing_segments(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_clean=True, has_segments=False, has_tracks=True)
    text = tab.pret_alignement_label.text()
    assert "Non" in text
    assert "segments" in text


def test_pret_alignement_non_missing_tracks(qapp: QApplication) -> None:  # noqa: ARG001
    tab = _make_tab(has_clean=True, has_segments=True, has_tracks=False)
    text = tab.pret_alignement_label.text()
    assert "Non" in text
    assert "tracks SRT" in text


def test_pret_alignement_neutral_without_episode(qapp: QApplication) -> None:  # noqa: ARG001
    """Sans épisode, le statut affiche '—' (pas de verdict)."""
    tab = _make_tab.__wrapped__() if hasattr(_make_tab, "__wrapped__") else None
    # Instanciation directe sans épisode
    store = _FakeStore.__new__(_FakeStore)
    from howimetyourcorpus.core.models import SeriesIndex
    store._index = SeriesIndex(series_title="T", series_url="u", episodes=[])
    store.load_series_index = lambda: store._index
    store.load_episode_notes = lambda eid: ""
    store.save_episode_notes = lambda eid, t: None
    store.load_episode_text = lambda eid, kind="raw": ""
    store.load_episode_transform_meta = lambda eid: None
    store.load_episode_preferred_profiles = lambda: {}
    store.save_episode_preferred_profiles = lambda p: None
    store.load_source_profile_defaults = lambda: {}
    store.has_episode_raw = lambda eid: False
    store.has_episode_clean = lambda eid: False
    store.load_custom_profiles = lambda: {}

    db = _FakeDb(has_segments=False, has_tracks=False)
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _steps: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    tab.refresh()
    assert "—" in tab.pret_alignement_label.text()


# ---------------------------------------------------------------------------
# Garde-fous UX layout (non-régression comportements visuels)
# ---------------------------------------------------------------------------

def test_avance_hidden_by_default(qapp: QApplication) -> None:  # noqa: ARG001
    """Le bloc Avancé est replié par défaut (US-303)."""
    tab = _make_tab()
    assert not tab._avance_expanded
    assert "▸" in tab._avance_toggle_btn.text()


def test_avance_toggle_shows_and_hides(qapp: QApplication) -> None:  # noqa: ARG001
    """Cliquer le toggle alterne l'état _avance_expanded."""
    tab = _make_tab()
    assert not tab._avance_expanded
    tab._avance_toggle_btn.click()
    assert tab._avance_expanded
    tab._avance_toggle_btn.click()
    assert not tab._avance_expanded


def test_avance_toggle_label_reflects_state(qapp: QApplication) -> None:  # noqa: ARG001
    """Le libellé du toggle contient ▸ (replié) ou ▾ (déplié)."""
    tab = _make_tab()
    assert "▸" in tab._avance_toggle_btn.text()
    tab._avance_toggle_btn.click()
    assert "▾" in tab._avance_toggle_btn.text()
    tab._avance_toggle_btn.click()
    assert "▸" in tab._avance_toggle_btn.text()


def test_kind_goto_hidden_in_episode_view(qapp: QApplication) -> None:  # noqa: ARG001
    """En vue Épisode, Kind / Aller à ne sont pas visibles."""
    tab = _make_tab()
    tab.show()  # nécessaire pour que isVisible() reflète l'état réel (offscreen)
    assert tab.inspect_view_combo.currentData() == "episode"
    assert not tab.inspect_kind_combo.isVisible()
    assert not tab._kind_label.isVisible()
    assert not tab.segment_goto_edit.isVisible()
    assert not tab.segment_goto_btn.isVisible()
    assert not tab._goto_label.isVisible()


def test_kind_goto_visible_in_segments_view(qapp: QApplication) -> None:  # noqa: ARG001
    """En vue Segments, Kind / Aller à deviennent visibles."""
    tab = _make_tab()
    tab.show()  # nécessaire pour que isVisible() reflète l'état réel (offscreen)
    idx = tab.inspect_view_combo.findData("segments")
    tab.inspect_view_combo.setCurrentIndex(idx)
    assert tab.inspect_kind_combo.isVisible()
    assert tab._kind_label.isVisible()
    assert tab.segment_goto_edit.isVisible()
    assert tab.segment_goto_btn.isVisible()
    assert tab._goto_label.isVisible()


def test_main_split_has_stretch(qapp: QApplication) -> None:  # noqa: ARG001
    """Le splitter externe (_outer_split) a un stretch > 0 pour occuper l'espace disponible."""
    tab = _make_tab()
    vbox = tab.layout()
    idx = vbox.indexOf(tab._outer_split)
    assert idx >= 0
    assert vbox.stretch(idx) > 0
