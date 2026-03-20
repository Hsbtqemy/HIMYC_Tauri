"""Tests UI ciblés pour l'onglet Logs."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from PySide6.QtWidgets import QApplication, QMessageBox

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.tab_logs import LogsTabWidget, MAX_LOG_LINES


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


@pytest.fixture
def logs_tab(qapp: QApplication) -> LogsTabWidget:  # noqa: ARG001
    tab = LogsTabWidget(on_open_log=lambda: None)
    yield tab
    import logging

    logging.getLogger("howimetyourcorpus").removeHandler(tab._handler)
    tab.close()
    tab.deleteLater()
    qapp.processEvents()


def test_logs_filter_by_level(logs_tab: LogsTabWidget) -> None:
    logs_tab.add_log_entry("INFO", "2026-01-01 [INFO] info line")
    logs_tab.add_log_entry("WARNING", "2026-01-01 [WARNING] warning line")
    logs_tab.add_log_entry("ERROR", "2026-01-01 [ERROR] error line")

    logs_tab.level_filter_combo.setCurrentText("Warning")
    logs_tab._apply_filter()
    content = logs_tab.logs_edit.toPlainText()
    assert "warning line" in content
    assert "info line" not in content
    assert "error line" not in content

    logs_tab.level_filter_combo.setCurrentText("Error")
    logs_tab._apply_filter()
    content = logs_tab.logs_edit.toPlainText()
    assert "error line" in content
    assert "warning line" not in content


def test_logs_add_entry_keeps_rolling_buffer(logs_tab: LogsTabWidget) -> None:
    for i in range(MAX_LOG_LINES + 5):
        logs_tab.add_log_entry("INFO", f"[INFO] line {i}")
    assert len(logs_tab._all_logs) == MAX_LOG_LINES
    assert logs_tab._all_logs[0][1].endswith("line 5")


def test_logs_export_writes_file(
    logs_tab: LogsTabWidget,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    logs_tab.logs_edit.setPlainText("line A\nline B")
    out = tmp_path / "logs.txt"
    infos: list[tuple[str, str]] = []

    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_logs.QFileDialog.getSaveFileName",
        lambda *_args, **_kwargs: (str(out), "Fichiers texte (*.txt)"),
    )

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_logs.QMessageBox.information", _info)
    logs_tab._export_logs()

    assert out.read_text(encoding="utf-8") == "line A\nline B"
    assert infos == [("Export", f"Logs exportés : {out}")]


def test_logs_find_dialog_reports_not_found(
    logs_tab: LogsTabWidget,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logs_tab.logs_edit.setPlainText("alpha beta gamma")
    infos: list[tuple[str, str]] = []

    monkeypatch.setattr(
        "PySide6.QtWidgets.QInputDialog.getText",
        lambda *_args, **_kwargs: ("zzz", True),
    )

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_logs.QMessageBox.information", _info)
    logs_tab._show_find_dialog()

    assert infos == [("Recherche", "Aucune occurrence de « zzz » trouvée.")]
