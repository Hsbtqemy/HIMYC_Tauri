"""Tests UI du prototype de vue transverse Expert."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.ui_mainwindow import MainWindow  # noqa: E402
from howimetyourcorpus.core.models import EpisodeRef, ProjectConfig, SeriesIndex  # noqa: E402
from howimetyourcorpus.core.storage.db import CorpusDB  # noqa: E402
from howimetyourcorpus.core.storage.project_store import ProjectStore  # noqa: E402


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


@pytest.fixture
def main_window_with_project(tmp_path: Path, qapp: QApplication):
    root = tmp_path / "project"
    config = ProjectConfig(
        project_name="test_project",
        root_dir=root,
        source_id="subslikescript",
        series_url="https://example.invalid/series",
    )
    ProjectStore.init_project(config)
    store = ProjectStore(root)
    db = CorpusDB(store.get_db_path())
    db.init()
    store.save_series_index(
        SeriesIndex(
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
    )

    win = MainWindow()
    win._config = config
    win._store = store
    win._db = db
    win._refresh_inspecteur_episodes()
    win._refresh_preparer()
    win._refresh_align_runs()
    win._refresh_personnages()
    win._refresh_expert()
    yield win
    win.close()


def test_expert_tab_reports_core_cross_context(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    assert hasattr(win, "expert_tab")

    win._kwic_open_inspector_impl("S01E01")
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.open_alignement_for_episode("S01E01", segment_kind="utterance")
    personnages_combo = win.personnages_tab.personnages_episode_combo
    personnages_idx = personnages_combo.findData("S01E01")
    if personnages_idx >= 0:
        personnages_combo.setCurrentIndex(personnages_idx)
    win._refresh_expert()

    text = win.expert_tab.summary_edit.toPlainText()
    assert "Project loaded: yes" in text
    assert "Context consistent: yes" in text
    assert "Context complete: yes" in text
    assert "Inspecteur: S01E01" in text
    assert "Preparer: S01E01" in text
    assert "Alignement: S01E01" in text
    assert "Personnages: S01E01" in text
    assert "Segment filter: utterance" in text
    assert "Undo actions: 0" in text
    assert "KPI legend:" in text
    assert "Project loaded: yes" in win.expert_tab.kpi_project_label.text()
    assert "Context consistent: yes" in win.expert_tab.kpi_context_label.text()
    assert "Episode focus: S01E01" in win.expert_tab.kpi_episode_label.text()


def test_expert_tab_detects_context_mismatch(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    win._kwic_open_inspector_impl("S01E01")
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.open_alignement_for_episode("S01E01", segment_kind="sentence")
    personnages_combo = win.personnages_tab.personnages_episode_combo
    personnages_idx = personnages_combo.findData("S01E01")
    if personnages_idx >= 0:
        personnages_combo.setCurrentIndex(personnages_idx)

    monkeypatch.setattr(win.preparer_tab, "current_episode_id", lambda: "S99E99")
    win._refresh_expert()
    text = win.expert_tab.summary_edit.toPlainText()
    assert "Context consistent: no" in text
    assert "Context complete: yes" in text


def test_expert_tab_detects_context_incomplete(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    win._kwic_open_inspector_impl("S01E01")
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.open_alignement_for_episode("S01E01", segment_kind="sentence")
    personnages_combo = win.personnages_tab.personnages_episode_combo
    personnages_idx = personnages_combo.findData("S01E01")
    if personnages_idx >= 0:
        personnages_combo.setCurrentIndex(personnages_idx)

    win.preparer_tab.prep_episode_combo.setCurrentIndex(-1)
    monkeypatch.setattr(win.preparer_tab, "current_episode_id", lambda: "")
    win._refresh_expert()
    text = win.expert_tab.summary_edit.toPlainText()
    assert "Context consistent: yes" in text
    assert "Context complete: no" in text


def test_expert_tab_project_loaded_requires_valid_store_db_binding(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    # Faux positif historique: store+db non nuls mais DB hors projet.
    win._db.db_path = win._store.root_dir / "orphan" / "corpus.db"
    win._refresh_expert()
    text = win.expert_tab.summary_edit.toPlainText()
    assert "Project loaded: no" in text


def test_expert_tab_auto_refresh_toggle_starts_and_stops_timer(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    tab = win.expert_tab
    assert not tab.auto_refresh_timer.isActive()
    tab.auto_refresh_cb.setChecked(True)
    assert tab.auto_refresh_timer.isActive()
    assert tab.auto_refresh_timer.interval() == tab.AUTO_REFRESH_INTERVAL_MS
    tab.auto_refresh_cb.setChecked(False)
    assert not tab.auto_refresh_timer.isActive()


def test_expert_tab_auto_refresh_tick_calls_refresh(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    tab = win.expert_tab
    called = {"count": 0}

    def _fake_refresh() -> None:
        called["count"] += 1

    monkeypatch.setattr(tab, "refresh", _fake_refresh)
    tab._on_auto_refresh_tick()
    assert called["count"] == 1


def test_expert_tab_kpi_tooltips_are_present(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    tab = win.expert_tab
    assert "root" in tab.kpi_project_label.toolTip().lower()
    assert "meme episode" in tab.kpi_context_label.toolTip().lower()
    assert "episode commun" in tab.kpi_episode_label.toolTip().lower()
    assert "legende kpi" in tab.kpi_legend_label.text().lower()


def test_refresh_tabs_after_job_triggers_expert_refresh(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    called = {"expert": 0}
    monkeypatch.setattr(win, "_refresh_episodes_from_store", lambda: None)
    monkeypatch.setattr(win, "_refresh_inspecteur_episodes", lambda: None)
    monkeypatch.setattr(win, "_refresh_preparer", lambda: None)
    monkeypatch.setattr(win, "_refresh_align_runs", lambda: None)
    monkeypatch.setattr(win, "_refresh_concordance", lambda: None)
    monkeypatch.setattr(win, "_refresh_personnages", lambda: None)
    monkeypatch.setattr(win, "_refresh_expert", lambda: called.__setitem__("expert", called["expert"] + 1))

    win._refresh_tabs_after_job()
    assert called["expert"] == 1
