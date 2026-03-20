"""Tests des gardes UI (projet/DB) sur actions utilisateur."""

from __future__ import annotations

import os

import pytest
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.tab_concordance import ConcordanceTabWidget  # noqa: E402
from howimetyourcorpus.app.tabs.tab_alignement import AlignmentTabWidget  # noqa: E402
from howimetyourcorpus.app.tabs.tab_inspecteur import InspectorTabWidget  # noqa: E402
from howimetyourcorpus.app.tabs.tab_preparer import PreparerTabWidget  # noqa: E402
from howimetyourcorpus.app.tabs.tab_projet import ProjectTabWidget  # noqa: E402
from howimetyourcorpus.app.tabs.tab_sous_titres import SubtitleTabWidget  # noqa: E402


@pytest.fixture
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_inspector_normalize_warns_without_project(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = InspectorTabWidget(
        get_store=lambda: None,
        get_db=lambda: None,
        get_config=lambda: None,
        run_job=lambda _steps: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    calls: list[tuple[str, str]] = []

    def _warning(_parent, title: str, msg: str):
        calls.append((title, msg))
        return None

    monkeypatch.setattr("howimetyourcorpus.app.ui_utils.QMessageBox.warning", _warning)
    tab._run_normalize()

    assert calls
    assert "Ouvrez un projet d'abord." in calls[0][1]


def test_subtitles_opensubtitles_warns_without_project(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = SubtitleTabWidget(
        get_store=lambda: None,
        get_db=lambda: None,
        run_job=lambda _steps: None,
        refresh_episodes=lambda: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    calls: list[tuple[str, str]] = []

    def _warning(_parent, title: str, msg: str):
        calls.append((title, msg))
        return None

    monkeypatch.setattr("howimetyourcorpus.app.ui_utils.QMessageBox.warning", _warning)
    tab._import_opensubtitles()

    assert calls
    assert calls[0][0] == "Sous-titres"
    assert "Ouvrez un projet d'abord." in calls[0][1]


def test_concordance_search_warns_without_db(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = ConcordanceTabWidget(
        get_db=lambda: None,
        on_open_inspector=lambda _episode_id: None,
    )
    tab.kwic_search_edit.setCurrentText("ted")
    calls: list[tuple[str, str]] = []

    def _warning(_parent, title: str, msg: str):
        calls.append((title, msg))
        return None

    monkeypatch.setattr("howimetyourcorpus.app.ui_utils.QMessageBox.warning", _warning)
    tab._run_kwic()

    assert calls == [("Concordance", "Ouvrez un projet d'abord.")]


def test_alignment_delete_run_warns_without_project(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = AlignmentTabWidget(
        get_store=lambda: None,
        get_db=lambda: None,
        run_job=lambda _steps: None,
    )
    calls: list[tuple[str, str]] = []

    def _warning(_parent, title: str, msg: str):
        calls.append((title, msg))
        return None

    monkeypatch.setattr("howimetyourcorpus.app.ui_utils.QMessageBox.warning", _warning)
    tab._delete_current_run()

    assert calls == [("Alignement", "Ouvrez un projet d'abord.")]


def test_preparer_normalize_warns_without_project(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = PreparerTabWidget(
        get_store=lambda: None,
        get_db=lambda: None,
        show_status=lambda _msg, _timeout=3000: None,
        on_go_alignement=lambda _episode_id, _segment_kind: None,
    )
    calls: list[tuple[str, str]] = []

    def _warning(_parent, title: str, msg: str):
        calls.append((title, msg))
        return None

    monkeypatch.setattr("howimetyourcorpus.app.ui_utils.QMessageBox.warning", _warning)
    tab._normalize_transcript()

    assert calls == [("Préparer", "Ouvrez un projet d'abord.")]


def test_project_add_language_warns_without_project(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = ProjectTabWidget(
        get_store=lambda: None,
        on_validate_clicked=lambda: None,
        on_save_config=lambda: None,
        on_open_profiles_dialog=lambda: None,
        on_refresh_language_combos=lambda: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    calls: list[tuple[str, str]] = []

    def _warning(_parent, title: str, msg: str):
        calls.append((title, msg))
        return None

    monkeypatch.setattr("howimetyourcorpus.app.ui_utils.QMessageBox.warning", _warning)
    tab._add_language()

    assert calls == [("Langues", "Ouvrez un projet d'abord.")]
