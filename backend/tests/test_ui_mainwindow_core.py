"""Tests ciblés MainWindow (garde-fous de navigation et fin de job)."""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.ui_mainwindow import (  # noqa: E402
    MainWindow,
    TAB_CORPUS,
    TAB_INSPECTEUR,
    TAB_PREPARER,
)
from howimetyourcorpus.core.models import EpisodeRef, ProjectConfig, SeriesIndex  # noqa: E402
from howimetyourcorpus.core.storage.db import CorpusDB  # noqa: E402
from howimetyourcorpus.core.storage.project_store import ProjectStore  # noqa: E402


@pytest.fixture
def qapp():
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
    yield win
    win.close()


def test_tab_change_stays_on_preparer_when_prompt_cancelled(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.tabs.currentIndex() == TAB_PREPARER

    monkeypatch.setattr(win.preparer_tab, "prompt_save_if_dirty", lambda: False)
    win.tabs.setCurrentIndex(TAB_CORPUS)
    assert win.tabs.currentIndex() == TAB_PREPARER


def test_open_preparer_for_episode_aborts_when_unsaved_cancelled(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    win.tabs.setCurrentIndex(TAB_INSPECTEUR)
    assert win.tabs.currentIndex() == TAB_INSPECTEUR

    monkeypatch.setattr(win.preparer_tab, "has_unsaved_changes", lambda: True)
    monkeypatch.setattr(win.preparer_tab, "prompt_save_if_dirty", lambda: False)

    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.tabs.currentIndex() == TAB_INSPECTEUR


def test_kwic_open_inspector_aborts_when_preparer_prompt_cancelled(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.tabs.currentIndex() == TAB_PREPARER

    monkeypatch.setattr(win.preparer_tab, "prompt_save_if_dirty", lambda: False)
    loaded: list[str] = []
    monkeypatch.setattr(win.inspector_tab, "set_episode_and_load", lambda episode_id: loaded.append(episode_id))

    win._kwic_open_inspector_impl("S01E01")
    assert win.tabs.currentIndex() == TAB_PREPARER
    assert loaded == []


def test_on_job_finished_stores_failed_episode_ids(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    win._job_runner = object()  # Simule un runner actif.

    results = [
        SimpleNamespace(success=True, message="ok"),
        SimpleNamespace(success=False, message="Erreur S01E01: boom"),
    ]
    win._on_job_finished(results)

    assert win._job_runner is None
    assert "S01E01" in win.corpus_tab._failed_episode_ids


def test_on_job_finished_success_clears_failed_episode_ids(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    win.corpus_tab.store_failed_episodes({"S01E01"})
    assert win.corpus_tab._failed_episode_ids == {"S01E01"}

    win._on_job_finished([SimpleNamespace(success=True, message="ok")])
    assert win.corpus_tab._failed_episode_ids == set()


def test_refresh_tabs_after_job_calls_concordance_refresh_speakers(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    called = {"count": 0}
    monkeypatch.setattr(win.concordance_tab, "refresh_speakers", lambda: called.__setitem__("count", called["count"] + 1))
    win._refresh_tabs_after_job()
    assert called["count"] == 1


def test_refresh_tabs_after_job_skips_duplicate_subs_refresh_when_inspector_is_combined(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    called = {"subs": 0}
    monkeypatch.setattr(win, "_refresh_episodes_from_store", lambda: None)
    monkeypatch.setattr(win, "_refresh_inspecteur_episodes", lambda: None)
    monkeypatch.setattr(win, "_refresh_preparer", lambda: None)
    monkeypatch.setattr(win, "_refresh_subs_tracks", lambda: called.__setitem__("subs", called["subs"] + 1))
    monkeypatch.setattr(win, "_refresh_align_runs", lambda: None)
    monkeypatch.setattr(win, "_refresh_concordance", lambda: None)
    monkeypatch.setattr(win, "_refresh_personnages", lambda: None)

    win._refresh_tabs_after_job()
    assert called["subs"] == 0


def test_refresh_tabs_after_project_open_skips_duplicate_subs_refresh_when_inspector_is_combined(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    called = {"subs": 0}
    monkeypatch.setattr(win, "_refresh_inspecteur_episodes", lambda: None)
    monkeypatch.setattr(win, "_refresh_preparer", lambda: None)
    monkeypatch.setattr(win, "_refresh_subs_tracks", lambda: called.__setitem__("subs", called["subs"] + 1))
    monkeypatch.setattr(win, "_refresh_align_runs", lambda: None)
    monkeypatch.setattr(win, "_refresh_personnages", lambda: None)

    win._project_controller._refresh_tabs_after_project_open(
        deferred=False,
        timer=SimpleNamespace(singleShot=lambda *_a, **_k: None),
    )
    assert called["subs"] == 0
