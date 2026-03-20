"""Tests UI ciblés pour les comportements Concordance."""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from PySide6.QtCore import QModelIndex, QSettings, Qt, QItemSelectionModel
from PySide6.QtGui import QKeyEvent
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.tab_concordance import ConcordanceTabWidget
from howimetyourcorpus.core.storage.db import KwicHit


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


@pytest.fixture(autouse=True)
def cleanup_qt_widgets(qapp: QApplication) -> None:
    yield
    for widget in list(qapp.topLevelWidgets()):
        widget.close()
        widget.deleteLater()
    qapp.processEvents()


@pytest.fixture(autouse=True)
def clear_qsettings() -> None:
    settings = QSettings()
    settings.remove("concordance/search_history")
    settings.sync()


def _make_hit(episode_id: str, match: str, *, speaker: str | None = None, title: str = "Pilot") -> KwicHit:
    return KwicHit(
        episode_id=episode_id,
        title=title,
        left="left",
        match=match,
        right="right",
        position=0,
        segment_id=f"{episode_id}:sentence:0",
        kind="sentence",
        speaker=speaker,
    )


def _set_combo_to_data(combo: Any, data: Any) -> None:
    index = combo.findData(data)
    assert index >= 0
    combo.setCurrentIndex(index)


class _FakeKwicDB:
    def __init__(
        self,
        *,
        episodes_hits: list[KwicHit] | None = None,
        segments_hits: list[KwicHit] | None = None,
        cues_hits: list[KwicHit] | None = None,
    ) -> None:
        self.episodes_hits = episodes_hits or []
        self.segments_hits = segments_hits or []
        self.cues_hits = cues_hits or []
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def query_kwic(
        self,
        term: str,
        *,
        season: int | None,
        episode: int | None,
        window: int,
        limit: int,
    ) -> list[KwicHit]:
        self.calls.append(
            (
                "episodes",
                {
                    "term": term,
                    "season": season,
                    "episode": episode,
                    "window": window,
                    "limit": limit,
                },
            )
        )
        return list(self.episodes_hits)

    def query_kwic_segments(
        self,
        term: str,
        *,
        kind: str | None,
        season: int | None,
        episode: int | None,
        window: int,
        limit: int,
    ) -> list[KwicHit]:
        self.calls.append(
            (
                "segments",
                {
                    "term": term,
                    "kind": kind,
                    "season": season,
                    "episode": episode,
                    "window": window,
                    "limit": limit,
                },
            )
        )
        return list(self.segments_hits)

    def query_kwic_cues(
        self,
        term: str,
        *,
        lang: str | None,
        season: int | None,
        episode: int | None,
        window: int,
        limit: int,
    ) -> list[KwicHit]:
        self.calls.append(
            (
                "cues",
                {
                    "term": term,
                    "lang": lang,
                    "season": season,
                    "episode": episode,
                    "window": window,
                    "limit": limit,
                },
            )
        )
        return list(self.cues_hits)


def test_set_languages_replaces_combo_items(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: None, on_open_inspector=lambda _eid: None)
    tab.set_languages(["en", "fr", "es"])
    values = [tab.kwic_lang_combo.itemData(i) for i in range(tab.kwic_lang_combo.count())]
    assert values == ["", "en", "fr", "es"]


def test_refresh_speakers_populates_combo_from_db(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    class _ConnCtx:
        def __enter__(self) -> _ConnCtx:
            return self

        def __exit__(self, *_args: Any) -> bool:
            return False

        @staticmethod
        def execute(_query: str) -> Any:
            return SimpleNamespace(fetchall=lambda: [("Barney",), ("Ted",)])

    tab = ConcordanceTabWidget(
        get_db=lambda: SimpleNamespace(connection=lambda: _ConnCtx()),
        on_open_inspector=lambda _eid: None,
    )
    tab.refresh_speakers()
    labels = [tab.kwic_speaker_combo.itemText(i) for i in range(tab.kwic_speaker_combo.count())]
    assert labels == ["—", "Barney", "Ted"]


def test_save_search_history_dedup_and_limit(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeSettings:
        data: dict[str, Any] = {}

        def value(self, key: str, default: Any = None) -> Any:
            return self.data.get(key, default)

        def setValue(self, key: str, value: Any) -> None:  # noqa: N802 - API Qt
            self.data[key] = value

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_concordance.QSettings", _FakeSettings)
    tab = ConcordanceTabWidget(get_db=lambda: None, on_open_inspector=lambda _eid: None)
    tab._max_history = 3
    tab._save_search_to_history("alpha")
    tab._save_search_to_history("beta")
    tab._save_search_to_history("alpha")
    tab._save_search_to_history("charlie")
    tab._save_search_to_history("delta")
    history = [tab.kwic_search_edit.itemText(i) for i in range(tab.kwic_search_edit.count())]
    assert history == ["alpha", "charlie", "delta"]
    assert tab.kwic_search_edit.currentText() == "delta"


def test_run_kwic_segments_applies_filters_and_updates_model(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeKwicDB(
        segments_hits=[
            _make_hit("S01E01", "hello", speaker="Ted"),
            _make_hit("S01E01", "hello", speaker="Robin"),
        ]
    )
    tab = ConcordanceTabWidget(get_db=lambda: db, on_open_inspector=lambda _eid: None)
    _set_combo_to_data(tab.kwic_scope_combo, "segments")
    _set_combo_to_data(tab.kwic_kind_combo, "utterance")
    tab.kwic_speaker_combo.addItem("Ted", "Ted")
    tab.kwic_speaker_combo.setCurrentIndex(1)
    saved_terms: list[str] = []
    monkeypatch.setattr(tab, "_save_search_to_history", lambda term: saved_terms.append(term))

    tab._run_kwic_for_term("hello")

    assert saved_terms == ["hello"]
    assert db.calls[0][0] == "segments"
    assert db.calls[0][1]["kind"] == "utterance"
    assert db.calls[0][1]["limit"] == 10000
    assert len(tab._all_hits) == 1
    assert tab.kwic_model.rowCount() == 1
    assert "(1 résultat(s))" in tab.kwic_page_label.text()


def test_run_kwic_episodes_paginates_results(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hits = [_make_hit(f"S01E{i:02d}", "hello") for i in range(1, 206)]
    db = _FakeKwicDB(episodes_hits=hits)
    tab = ConcordanceTabWidget(get_db=lambda: db, on_open_inspector=lambda _eid: None)
    monkeypatch.setattr(tab, "_save_search_to_history", lambda _term: None)

    tab._run_kwic_for_term("hello")
    assert tab.kwic_page_spin.maximum() == 2
    assert tab.kwic_model.rowCount() == 200

    tab.kwic_page_spin.setValue(2)
    assert tab.kwic_model.rowCount() == 5


def test_run_kwic_wildcard_filters_hits(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeKwicDB(
        episodes_hits=[
            _make_hit("S01E01", "hello"),
            _make_hit("S01E02", "HEYA"),
            _make_hit("S01E03", "world"),
        ]
    )
    tab = ConcordanceTabWidget(get_db=lambda: db, on_open_inspector=lambda _eid: None)
    tab.wildcard_cb.setChecked(True)
    monkeypatch.setattr(tab, "_save_search_to_history", lambda _term: None)

    tab._run_kwic_for_term("he*")

    assert len(tab._all_hits) == 2
    assert {h.episode_id for h in tab._all_hits} == {"S01E01", "S01E02"}


def test_filter_hits_regex_invalid_warns_and_returns_original(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    hits = [_make_hit("S01E01", "hello")]
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.QMessageBox.warning",
        lambda *_a, **_k: warnings.append("warn"),
    )
    filtered = tab._filter_hits_regex_wildcard(hits, "[", use_regex=True, use_wildcard=False)
    assert filtered == hits
    assert warnings


def test_filter_hits_by_speaker_returns_only_matching_speaker(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = ConcordanceTabWidget(
        get_db=lambda: None,
        on_open_inspector=lambda _episode_id: None,
    )
    hits = [
        _make_hit("S01E01", "hello", speaker="Ted"),
        _make_hit("S01E01", "hello", speaker="Robin"),
    ]
    filtered = tab._filter_hits_by_speaker(hits, "ted")
    assert len(filtered) == 1
    assert filtered[0].speaker == "Ted"


def test_filter_hits_by_speaker_returns_empty_when_no_match(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = ConcordanceTabWidget(
        get_db=lambda: None,
        on_open_inspector=lambda _episode_id: None,
    )
    filtered = tab._filter_hits_by_speaker([_make_hit("S01E01", "hello", speaker="Ted")], "Barney")
    assert filtered == []


def test_export_kwic_warns_without_hits(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.QMessageBox.warning",
        lambda *_a, **_k: warnings.append("warn"),
    )
    tab._export_kwic()
    assert warnings


def test_export_kwic_word_filter_calls_docx_exporter(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    tab._all_hits = [_make_hit("S01E01", "hello")]
    target_base = tmp_path / "report"
    monkeypatch.setattr(
        "PySide6.QtWidgets.QFileDialog.getSaveFileName",
        lambda *_a, **_k: (str(target_base), "Word (*.docx)"),
    )
    exported: dict[str, Any] = {}
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.export_kwic_docx",
        lambda hits, path: exported.update({"hits": hits, "path": path}),
    )
    infos: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.QMessageBox.information",
        lambda *_a, **_k: infos.append("info"),
    )

    tab._export_kwic()

    assert len(exported["hits"]) == 1
    assert exported["path"].suffix.lower() == ".docx"
    assert infos


def test_export_kwic_unknown_format_warns(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    tab._all_hits = [_make_hit("S01E01", "hello")]
    monkeypatch.setattr(
        "PySide6.QtWidgets.QFileDialog.getSaveFileName",
        lambda *_a, **_k: (str(tmp_path / "report.foo"), "Foo (*.foo)"),
    )
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.QMessageBox.warning",
        lambda *_a, **_k: warnings.append("warn"),
    )
    tab._export_kwic()
    assert warnings


def test_export_kwic_exception_shows_critical(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    tab._all_hits = [_make_hit("S01E01", "hello")]
    monkeypatch.setattr(
        "PySide6.QtWidgets.QFileDialog.getSaveFileName",
        lambda *_a, **_k: (str(tmp_path / "report.csv"), "CSV (*.csv)"),
    )
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.export_kwic_csv",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom export")),
    )
    criticals: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.QMessageBox.critical",
        lambda *_a, **_k: criticals.append("critical"),
    )
    tab._export_kwic()
    assert criticals


def test_on_double_click_opens_inspector_with_episode(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    opened: list[str] = []
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda eid: opened.append(eid))
    tab.kwic_model.set_hits([_make_hit("S01E01", "hello")], search_term="hello")
    index = tab.kwic_model.index(0, 0)
    tab._on_double_click(index)
    assert opened == ["S01E01"]


def test_on_double_click_ignores_invalid_index(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    opened: list[str] = []
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda eid: opened.append(eid))
    tab._on_double_click(QModelIndex())
    assert opened == []


def test_copy_selection_to_clipboard_writes_tsv(
    qapp: QApplication,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    tab.kwic_model.set_hits(
        [
            _make_hit("S01E01", "hello"),
            _make_hit("S01E02", "world"),
        ],
        search_term="hello",
    )
    selection_model = tab.kwic_table.selectionModel()
    assert selection_model is not None
    selection_model.clearSelection()
    selection_model.select(tab.kwic_model.index(0, 0), QItemSelectionModel.SelectionFlag.Select)
    selection_model.select(tab.kwic_model.index(0, 3), QItemSelectionModel.SelectionFlag.Select)
    selection_model.select(tab.kwic_model.index(1, 1), QItemSelectionModel.SelectionFlag.Select)

    tab._copy_selection_to_clipboard()

    text = QApplication.clipboard().text()
    assert text == "S01E01\t\t\thello\n\tPilot"


def test_handle_key_press_ctrl_c_triggers_copy(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    called = {"copy": 0}
    monkeypatch.setattr(
        tab,
        "_copy_selection_to_clipboard",
        lambda: called.__setitem__("copy", called["copy"] + 1),
    )
    event = QKeyEvent(QKeyEvent.Type.KeyPress, Qt.Key.Key_C, Qt.KeyboardModifier.ControlModifier)
    tab._handle_table_key_press(event)
    assert called["copy"] == 1
    assert event.isAccepted()


def test_show_frequency_graph_warns_without_results(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = ConcordanceTabWidget(get_db=lambda: object(), on_open_inspector=lambda _eid: None)
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_concordance.QMessageBox.warning",
        lambda *_a, **_k: warnings.append("warn"),
    )
    tab._show_frequency_graph()
    assert warnings
