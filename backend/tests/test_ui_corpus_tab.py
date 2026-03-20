"""Tests UI de base pour l'onglet Corpus."""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from howimetyourcorpus.app.tabs.corpus_view import _workflow_next_step_hint
from howimetyourcorpus.app.tabs.tab_corpus import CorpusTabWidget
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex


@pytest.fixture
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


@pytest.mark.parametrize(
    ("n_total", "n_fetched", "n_norm", "n_indexed", "n_with_srt", "n_aligned", "expected_contains"),
    [
        (0, 0, 0, 0, 0, 0, ""),
        (10, 0, 0, 0, 0, 0, "Télécharger"),
        (10, 5, 0, 0, 0, 0, "Normalisez"),
        (10, 10, 5, 0, 0, 0, "Normalisez"),
        (10, 10, 10, 0, 0, 0, "Segmentez"),
        (10, 10, 10, 10, 3, 0, "SRT"),
        (10, 10, 10, 10, 10, 5, "alignez"),
        (10, 10, 10, 10, 10, 10, "à jour"),
    ],
)
def test_workflow_next_step_hint(
    n_total: int,
    n_fetched: int,
    n_norm: int,
    n_indexed: int,
    n_with_srt: int,
    n_aligned: int,
    expected_contains: str,
) -> None:
    hint = _workflow_next_step_hint(
        n_total, n_fetched, n_norm, n_indexed, n_with_srt, n_aligned
    )
    if expected_contains:
        assert expected_contains.lower() in hint.lower()
    else:
        assert hint == ""


def test_corpus_ribbon_is_expanded_by_default_and_toggleable(qapp: QApplication) -> None:
    tab = CorpusTabWidget(
        get_store=lambda: None,
        get_db=lambda: None,
        get_context=lambda: None,
        run_job=lambda steps: None,
        show_status=lambda msg, ms: None,
        refresh_after_episodes_added=lambda: None,
        on_cancel_job=lambda: None,
    )
    assert tab.corpus_ribbon_toggle_btn.isChecked()
    assert not tab.corpus_ribbon_content.isHidden()
    assert tab.corpus_ribbon_toggle_btn.text() == "Masquer le panneau d'actions"

    tab.corpus_ribbon_toggle_btn.click()
    assert not tab.corpus_ribbon_toggle_btn.isChecked()
    assert tab.corpus_ribbon_content.isHidden()
    assert tab.corpus_ribbon_toggle_btn.text() == "Afficher le panneau d'actions"

    tab.corpus_ribbon_toggle_btn.click()
    assert tab.corpus_ribbon_toggle_btn.isChecked()
    assert not tab.corpus_ribbon_content.isHidden()
    assert tab.corpus_ribbon_toggle_btn.text() == "Masquer le panneau d'actions"


def test_corpus_lang_hint_from_profile_handles_default_and_explicit_lang(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    assert CorpusTabWidget._lang_hint_from_profile("default_en_v1") == "en"
    assert CorpusTabWidget._lang_hint_from_profile("fr_custom_v2") == "fr"
    assert CorpusTabWidget._lang_hint_from_profile("") == "en"


def test_corpus_resolve_episode_profile_priority(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    ref_by_id = {
        "S01E01": EpisodeRef(
            episode_id="S01E01",
            season=1,
            episode=1,
            title="Pilot",
            url="https://example.invalid/s01e01",
            source_id="subslikescript",
        )
    }
    profile = CorpusTabWidget._resolve_episode_profile(
        episode_id="S01E01",
        ref_by_id=ref_by_id,
        episode_preferred={"S01E01": "preferred_profile"},
        source_defaults={"subslikescript": "source_default_profile"},
        batch_profile="batch_profile",
    )
    assert profile == "preferred_profile"

    profile = CorpusTabWidget._resolve_episode_profile(
        episode_id="S01E01",
        ref_by_id=ref_by_id,
        episode_preferred={},
        source_defaults={"subslikescript": "source_default_profile"},
        batch_profile="batch_profile",
    )
    assert profile == "source_default_profile"

    profile = CorpusTabWidget._resolve_episode_profile(
        episode_id="S01E01",
        ref_by_id=ref_by_id,
        episode_preferred={},
        source_defaults={},
        batch_profile="batch_profile",
    )
    assert profile == "batch_profile"


def test_corpus_resolve_target_episode_ids_returns_all_when_not_selection_only(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = CorpusTabWidget(
        get_store=lambda: None,
        get_db=lambda: None,
        get_context=lambda: None,
        run_job=lambda steps: None,
        show_status=lambda msg, ms: None,
        refresh_after_episodes_added=lambda: None,
        on_cancel_job=lambda: None,
    )
    index = SeriesIndex(
        series_title="Test",
        series_url="https://example.invalid/series",
        episodes=[
            EpisodeRef(
                episode_id="S01E01",
                season=1,
                episode=1,
                title="Pilot",
                url="https://example.invalid/s01e01",
            ),
            EpisodeRef(
                episode_id="S01E02",
                season=1,
                episode=2,
                title="Purple Giraffe",
                url="https://example.invalid/s01e02",
            ),
        ],
    )
    ids = tab._resolve_target_episode_ids(index=index, selection_only=False)
    assert ids == ["S01E01", "S01E02"]


def test_corpus_get_project_index_context_returns_store_config_and_index(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    index = SeriesIndex(
        series_title="Test",
        series_url="https://example.invalid/series",
        episodes=[
            EpisodeRef(
                episode_id="S01E01",
                season=1,
                episode=1,
                title="Pilot",
                url="https://example.invalid/s01e01",
            )
        ],
    )

    class _Store:
        def load_series_index(self):
            return index

    store = _Store()
    context = {"config": object()}
    tab = CorpusTabWidget(
        get_store=lambda: store,
        get_db=lambda: None,
        get_context=lambda: context,
        run_job=lambda steps: None,
        show_status=lambda msg, ms: None,
        refresh_after_episodes_added=lambda: None,
        on_cancel_job=lambda: None,
    )

    payload = tab._get_project_index_context()
    assert payload is not None
    got_store, got_config, got_index = payload
    assert got_store is store
    assert got_config is context["config"]
    assert got_index is index
