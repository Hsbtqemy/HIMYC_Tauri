"""Tests d'intégration parcours source-flow — INS-009.

Scénarios couverts :
  A. Parcours transcript-first complet (RAW → CLEAN → segments → CTA prêt alignement).
  B. Parcours SRT-only (tracks, pas de transcript → CTA srt-only).
  C. Changement épisode/fichier avec conservation de contexte (mode Focus, pas de crash).
  D. Handoffs vers Alignement : has_subtitle_panel() + set_subtitle_languages() (INS-007/008).
"""

from __future__ import annotations

import os

import pytest
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.tab_inspecteur import InspectorTabWidget  # noqa: E402
from howimetyourcorpus.app.tabs.tab_inspecteur_sous_titres import (  # noqa: E402
    InspecteurEtSousTitresTabWidget,
)
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex  # noqa: E402
from howimetyourcorpus.core.normalize.profiles import NormalizationProfile  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

_EP_A = EpisodeRef(episode_id="S01E01", season=1, episode=1, title="Pilot", url="u1", source_id="src")
_EP_B = EpisodeRef(episode_id="S01E02", season=1, episode=2, title="Ep2", url="u2", source_id="src")


class _FakeConfig:
    normalize_profile = "default_en_v1"


class _Store:
    """Store configurable par épisode."""

    def __init__(
        self,
        *,
        raw: set[str] | None = None,
        clean: set[str] | None = None,
        episodes: list[EpisodeRef] | None = None,
    ) -> None:
        self._raw = raw or set()
        self._clean = clean or set()
        self._index = SeriesIndex(
            series_title="T",
            series_url="u",
            episodes=episodes if episodes is not None else [_EP_A, _EP_B],
        )

    def load_series_index(self) -> SeriesIndex:
        return self._index

    def load_episode_notes(self, eid: str) -> str:  # noqa: ARG002
        return ""

    def save_episode_notes(self, eid: str, text: str) -> None:  # noqa: ARG002
        pass

    def load_episode_text(self, eid: str, kind: str = "raw") -> str:  # noqa: ARG002
        return "content"

    def load_episode_transform_meta(self, eid: str):  # noqa: ARG002
        return None

    def load_episode_preferred_profiles(self) -> dict:
        return {}

    def save_episode_preferred_profiles(self, p: dict) -> None:  # noqa: ARG002
        pass

    def load_source_profile_defaults(self) -> dict:
        return {}

    def has_episode_raw(self, eid: str) -> bool:
        return eid in self._raw

    def has_episode_clean(self, eid: str) -> bool:
        return eid in self._clean

    def load_custom_profiles(self) -> dict[str, NormalizationProfile]:
        return {}

    def load_episode_subtitle_content(self, eid: str, lang: str):  # noqa: ARG002
        return None


class _Db:
    """DB configurable par épisode."""

    def __init__(
        self,
        *,
        segments: dict[str, list] | None = None,
        tracks: dict[str, list] | None = None,
        align_runs: dict[str, list] | None = None,
    ) -> None:
        self._segments = segments or {}
        self._tracks = tracks or {}
        self._align_runs = align_runs or {}

    def get_segments_for_episode(self, eid: str, kind: str | None = None):  # noqa: ARG002
        return list(self._segments.get(eid, []))

    def get_tracks_for_episode(self, eid: str):
        return list(self._tracks.get(eid, []))

    def get_align_runs_for_episode(self, eid: str):
        return list(self._align_runs.get(eid, []))


def _inspector(store, db) -> InspectorTabWidget:
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _s: None,
        show_status=lambda _m, _t=3000: None,
    )
    tab.refresh()
    return tab


def _combined(store, db) -> InspecteurEtSousTitresTabWidget:
    tab = InspecteurEtSousTitresTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _s: None,
        refresh_episodes=lambda: None,
        show_status=lambda _m, _t=3000: None,
    )
    tab.refresh()
    return tab


def _clear_focus_setting() -> None:
    from PySide6.QtCore import QSettings
    QSettings().remove("inspecteur/focus_mode")


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
# Scénario A — Parcours transcript-first complet
# ---------------------------------------------------------------------------

def test_transcript_first_rien_cta_demarrer(qapp: QApplication) -> None:  # noqa: ARG001
    """Épisode vide → CTA Démarrer, Normaliser désactivé."""
    store = _Store(raw=set(), clean=set())
    db = _Db()
    tab = _inspector(store, db)
    assert "Démarrer" in tab.cta_label.text()
    assert not tab.inspect_norm_btn.isEnabled()


def test_transcript_first_raw_present_cta_normaliser(qapp: QApplication) -> None:  # noqa: ARG001
    """RAW présent → CTA Normaliser, bouton Normaliser actif."""
    store = _Store(raw={"S01E01"}, clean=set())
    db = _Db()
    tab = _inspector(store, db)
    assert "Normaliser" in tab.cta_label.text()
    assert tab.inspect_norm_btn.isEnabled()
    assert not tab.inspect_segment_btn.isEnabled()


def test_transcript_first_clean_present_cta_segmenter(qapp: QApplication) -> None:  # noqa: ARG001
    """CLEAN présent, pas de segments → CTA Segmenter, bouton Segmenter actif."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db()
    tab = _inspector(store, db)
    assert "Segmenter" in tab.cta_label.text()
    assert tab.inspect_segment_btn.isEnabled()
    assert not tab.inspect_export_segments_btn.isEnabled()


def test_transcript_first_complet_cta_pret(qapp: QApplication) -> None:  # noqa: ARG001
    """Épisode complet (CLEAN + segments + tracks) → CTA transcript-first, Prêt: Oui."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(
        segments={"S01E01": [{"kind": "sentence", "n": 1, "text": "x", "start_char": 0, "end_char": 1, "speaker_explicit": ""}]},
        tracks={"S01E01": [{"lang": "fr"}]},
    )
    tab = _inspector(store, db)
    assert "transcript-first" in tab.cta_label.text()
    assert "Oui" in tab.pret_alignement_label.text()
    assert tab.inspect_export_segments_btn.isEnabled()


# ---------------------------------------------------------------------------
# Scénario B — Parcours SRT-only
# ---------------------------------------------------------------------------

def test_srt_only_tracks_sans_transcript_cta_srt_only(qapp: QApplication) -> None:  # noqa: ARG001
    """Tracks présents, pas de transcript → CTA SRT-only."""
    store = _Store(raw=set(), clean=set())
    db = _Db(tracks={"S01E01": [{"lang": "en"}]})
    tab = _inspector(store, db)
    assert "SRT-only" in tab.cta_label.text()


def test_srt_only_source_srt_desactive_normaliser_segmenter(qapp: QApplication) -> None:  # noqa: ARG001
    """Source SRT sélectionnée → Normaliser et Segmenter désactivés."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(tracks={"S01E01": [{"lang": "en"}]})
    tab = _inspector(store, db)
    # Sélectionner la source SRT dans le combo Fichier
    idx = tab.inspect_file_combo.findData("srt_en")
    assert idx >= 0, "Le combo Fichier doit proposer srt_en"
    tab.inspect_file_combo.setCurrentIndex(idx)
    assert not tab.inspect_norm_btn.isEnabled()
    assert not tab.inspect_segment_btn.isEnabled()


def test_srt_only_file_combo_has_srt_option(qapp: QApplication) -> None:  # noqa: ARG001
    """Avec tracks, le combo Fichier expose l'option SRT."""
    store = _Store()
    db = _Db(tracks={"S01E01": [{"lang": "en"}, {"lang": "fr"}]})
    tab = _inspector(store, db)
    data = [tab.inspect_file_combo.itemData(i) for i in range(tab.inspect_file_combo.count())]
    assert "srt_en" in data
    assert "srt_fr" in data


# ---------------------------------------------------------------------------
# Scénario C — Changement épisode/fichier avec brouillon
# ---------------------------------------------------------------------------

def test_episode_change_updates_file_combo(qapp: QApplication) -> None:  # noqa: ARG001
    """Changer d'épisode met à jour le combo Fichier selon les tracks du nouvel épisode."""
    store = _Store()
    db = _Db(tracks={
        "S01E01": [{"lang": "fr"}],
        "S01E02": [],
    })
    tab = _inspector(store, db)
    # S01E01 : doit avoir srt_fr
    assert tab.inspect_file_combo.findData("srt_fr") >= 0
    # Changer vers S01E02
    tab.set_episode_and_load("S01E02")
    assert tab.inspect_file_combo.findData("srt_fr") < 0  # plus disponible
    assert tab.inspect_file_combo.findData("transcript") >= 0  # toujours là


def test_episode_change_cta_updated(qapp: QApplication) -> None:  # noqa: ARG001
    """Changer d'épisode met à jour le CTA correctement."""
    store = _Store(raw={"S01E01"}, clean=set())
    db = _Db()
    tab = _inspector(store, db)
    # S01E01 : RAW présent → Normaliser
    assert "Normaliser" in tab.cta_label.text()
    # S01E02 : rien → Démarrer
    tab.set_episode_and_load("S01E02")
    assert "Démarrer" in tab.cta_label.text()


def test_focus_mode_preserved_across_episode_change(qapp: QApplication) -> None:  # noqa: ARG001
    """Le mode Focus reste actif après changement d'épisode dans le widget combiné."""
    _clear_focus_setting()
    store = _Store()
    db = _Db()
    tab = _combined(store, db)
    assert tab._focus_mode is True
    idx = tab.episode_combo.findData("S01E02")
    tab.episode_combo.setCurrentIndex(idx)
    # Focus non altéré par le changement d'épisode
    assert tab._focus_mode is True


def test_srt_source_resets_to_transcript_when_no_tracks_on_new_episode(qapp: QApplication) -> None:  # noqa: ARG001
    """Si la source SRT n'est plus disponible après changement d'épisode, retour à Transcript."""
    store = _Store()
    db = _Db(tracks={"S01E01": [{"lang": "en"}], "S01E02": []})
    tab = _inspector(store, db)
    # Sélectionner srt_en sur S01E01
    idx = tab.inspect_file_combo.findData("srt_en")
    tab.inspect_file_combo.setCurrentIndex(idx)
    assert tab.inspect_file_combo.currentData() == "srt_en"
    # Changer vers S01E02 (pas de tracks)
    tab.set_episode_and_load("S01E02")
    # Doit être revenu sur transcript
    assert tab.inspect_file_combo.currentData() == "transcript"


# ---------------------------------------------------------------------------
# Scénario D — Handoffs vers Alignement (INS-007/008)
# ---------------------------------------------------------------------------

def test_combined_has_subtitle_panel_returns_true(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-007 — has_subtitle_panel() retourne True sur InspecteurEtSousTitresTabWidget."""
    store = _Store()
    db = _Db()
    tab = _combined(store, db)
    assert tab.has_subtitle_panel() is True


def test_inspector_alone_has_no_subtitle_panel_method(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-008 — InspectorTabWidget seul n'a pas has_subtitle_panel() → couplage propre."""
    store = _Store()
    db = _Db()
    tab = _inspector(store, db)
    assert not hasattr(tab, "has_subtitle_panel")


def test_set_subtitle_languages_no_crash(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-007 — set_subtitle_languages() s'exécute sans crash."""
    store = _Store()
    db = _Db()
    tab = _combined(store, db)
    tab.set_subtitle_languages(["en", "fr", "it"])  # ne doit pas lever d'exception


# ---------------------------------------------------------------------------
# Scénario E — INS-014 : Source pilote le contenu affiché
# ---------------------------------------------------------------------------

class _StoreWithSrt(_Store):
    """Store avec contenu SRT simulé."""

    def load_episode_subtitle_content(self, eid: str, lang: str):
        if eid == "S01E01" and lang == "en":
            return ("1\n00:00:01,000 --> 00:00:02,000\nHello world\n", "srt")
        return None


def test_source_transcript_loads_raw_clean(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-014 — Source Transcript : raw_edit et clean_edit contiennent le texte transcript."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db()
    tab = _inspector(store, db)
    assert tab.inspect_file_combo.currentData() == "transcript"
    # load_episode_text retourne "content" pour tout épisode dans _Store
    assert tab.raw_edit.toPlainText() == "content"
    assert tab.clean_edit.toPlainText() == "content"


def test_source_srt_loads_srt_content(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-014 — Source SRT sélectionnée : raw_edit contient le texte brut SRT."""
    store = _StoreWithSrt(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(tracks={"S01E01": [{"lang": "en"}]})
    tab = _inspector(store, db)
    idx = tab.inspect_file_combo.findData("srt_en")
    tab.inspect_file_combo.setCurrentIndex(idx)
    assert "Hello world" in tab.raw_edit.toPlainText()
    assert tab.clean_edit.toPlainText() == ""


def test_source_srt_no_content_shows_empty(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-014 — Source SRT sans contenu disponible : raw_edit vide, pas de crash."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(tracks={"S01E01": [{"lang": "fr"}]})
    tab = _inspector(store, db)
    idx = tab.inspect_file_combo.findData("srt_fr")
    tab.inspect_file_combo.setCurrentIndex(idx)
    assert tab.raw_edit.toPlainText() == ""


def test_source_switch_back_to_transcript_restores_content(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-014 — Retour à Transcript après SRT : raw/clean rechargés depuis le transcript."""
    store = _StoreWithSrt(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(tracks={"S01E01": [{"lang": "en"}]})
    tab = _inspector(store, db)
    # Passer sur SRT
    idx = tab.inspect_file_combo.findData("srt_en")
    tab.inspect_file_combo.setCurrentIndex(idx)
    assert "Hello world" in tab.raw_edit.toPlainText()
    # Revenir à Transcript
    idx_transcript = tab.inspect_file_combo.findData("transcript")
    tab.inspect_file_combo.setCurrentIndex(idx_transcript)
    assert tab.raw_edit.toPlainText() == "content"
    assert tab.clean_edit.toPlainText() == "content"


# ---------------------------------------------------------------------------
# Scénario F — INS-015 : Guards métier handlers
# ---------------------------------------------------------------------------

def test_run_normalize_blocked_on_srt_source(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-015 — _run_normalize retourne sans appel job quand source SRT est active."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(tracks={"S01E01": [{"lang": "en"}]})
    jobs_called: list = []
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda s: jobs_called.append(s),
        show_status=lambda _m, _t=3000: None,
    )
    tab.refresh()
    # Sélectionner source SRT
    idx = tab.inspect_file_combo.findData("srt_en")
    tab.inspect_file_combo.setCurrentIndex(idx)
    # Appel direct (simulate un appel programmatique direct, hors UI)
    # Le guard doit bloquer avant même le check @require_project
    tab._run_normalize()
    assert jobs_called == [], "Le job ne doit pas être déclenché sur source SRT"


def test_run_segment_blocked_on_srt_source(qapp: QApplication) -> None:  # noqa: ARG001
    """INS-015 — _run_segment retourne sans appel job quand source SRT est active."""
    store = _Store(raw={"S01E01"}, clean={"S01E01"})
    db = _Db(tracks={"S01E01": [{"lang": "en"}]})
    jobs_called: list = []
    tab = InspectorTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda s: jobs_called.append(s),
        show_status=lambda _m, _t=3000: None,
    )
    tab.refresh()
    idx = tab.inspect_file_combo.findData("srt_en")
    tab.inspect_file_combo.setCurrentIndex(idx)
    tab._run_segment()
    assert jobs_called == [], "Le job ne doit pas être déclenché sur source SRT"
