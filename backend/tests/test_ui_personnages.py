"""Tests UI ciblés pour l'onglet Personnages (propagation)."""

from __future__ import annotations

import os
from typing import Any

import pytest
from PySide6.QtWidgets import QApplication, QMessageBox

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.tab_personnages import PersonnagesTabWidget


class _FakeStore:
    def __init__(self, assignments: list[dict[str, Any]]) -> None:
        self._assignments = assignments
        self.propagate_calls: list[tuple[str, str, set[str] | None]] = []

    def load_character_assignments(self) -> list[dict[str, Any]]:
        return list(self._assignments)

    def propagate_character_names(
        self,
        db: Any,  # noqa: ARG002
        episode_id: str,
        run_id: str,
        languages_to_rewrite: set[str] | None = None,
    ) -> tuple[int, int]:
        self.propagate_calls.append((episode_id, run_id, languages_to_rewrite))
        return (3, 4)


class _FakeDB:
    def __init__(
        self,
        run: dict[str, Any] | None,
        links: list[dict[str, Any]] | None = None,
        runs: list[dict[str, Any]] | None = None,
    ) -> None:
        self._run = run
        self._links = links or []
        self._runs = runs or [{"align_run_id": "run1", "summary_json": ""}]

    def get_align_runs_for_episode(self, episode_id: str) -> list[dict[str, Any]]:  # noqa: ARG002
        return list(self._runs)

    def get_align_run(self, run_id: str) -> dict[str, Any] | None:  # noqa: ARG002
        return self._run

    def query_alignment_for_episode(self, episode_id: str, run_id: str | None = None) -> list[dict[str, Any]]:  # noqa: ARG002
        return list(self._links)


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def _build_tab(
    *,
    store: _FakeStore,
    db: _FakeDB,
    statuses: list[str],
) -> PersonnagesTabWidget:
    tab = PersonnagesTabWidget(
        get_store=lambda: store,
        get_db=lambda: db,
        show_status=lambda message, _timeout=3000: statuses.append(message),
    )
    tab.personnages_episode_combo.addItem("S01E01 - Pilot", "S01E01")
    tab.personnages_episode_combo.setCurrentIndex(0)
    return tab


def test_propagate_warns_when_run_not_found(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[str] = []
    store = _FakeStore(
        assignments=[
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:sentence:0",
                "character_id": "ted",
            }
        ]
    )
    db = _FakeDB(run=None)
    tab = _build_tab(store=store, db=db, statuses=statuses)
    warnings: list[tuple[str, str]] = []

    def _warning(_parent, title: str, message: str):
        warnings.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.warning", _warning)
    tab._propagate()

    assert warnings == [
        (
            "Propagation",
            "Run d'alignement introuvable. Rafraîchissez la liste des runs puis sélectionnez un run valide.",
        )
    ]
    assert store.propagate_calls == []


def test_propagate_shows_info_when_episode_has_no_assignments(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[str] = []
    store = _FakeStore(assignments=[])
    db = _FakeDB(run={"align_run_id": "run1", "pivot_lang": "en", "params_json": "{}"})
    tab = _build_tab(store=store, db=db, statuses=statuses)
    infos: list[tuple[str, str]] = []

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.information", _info)
    tab._propagate()

    assert infos == [
        (
            "Propagation",
            "Aucune assignation pour cet épisode. Enregistrez des assignations (section 2) puis réessayez.",
        )
    ]
    assert store.propagate_calls == []


def test_propagate_stops_when_language_dialog_cancelled(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    statuses: list[str] = []
    store = _FakeStore(
        assignments=[
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:sentence:0",
                "character_id": "ted",
            }
        ]
    )
    db = _FakeDB(run={"align_run_id": "run1", "pivot_lang": "en", "params_json": "{}"})
    tab = _build_tab(store=store, db=db, statuses=statuses)
    tab._ask_languages_to_rewrite = lambda _langs: None

    tab._propagate()

    assert store.propagate_calls == []
    assert statuses == []


def test_propagate_runs_and_reports_success(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[str] = []
    store = _FakeStore(
        assignments=[
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:sentence:0",
                "character_id": "ted",
            }
        ]
    )
    db = _FakeDB(run={"align_run_id": "run1", "pivot_lang": "en", "params_json": "{}"})
    tab = _build_tab(store=store, db=db, statuses=statuses)
    tab._ask_languages_to_rewrite = lambda _langs: {"en"}
    infos: list[tuple[str, str]] = []

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.information", _info)
    tab._propagate()

    assert store.propagate_calls == [("S01E01", "run1", {"en"})]
    assert any(msg.startswith("Propagation : 3 segment(s), 4 cue(s)") for msg in statuses)
    assert infos and infos[0][0] == "Propagation terminée"


def test_fill_propagate_run_combo_displays_segment_kind_and_total_links(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    statuses: list[str] = []
    store = _FakeStore(assignments=[])
    db = _FakeDB(
        run={"align_run_id": "run1", "pivot_lang": "en", "params_json": '{"segment_kind":"utterance"}'},
        runs=[
            {
                "align_run_id": "run1",
                "summary_json": '{"total_links": 12}',
                "params_json": '{"segment_kind":"utterance"}',
            }
        ],
    )
    tab = _build_tab(store=store, db=db, statuses=statuses)

    assert tab.personnages_run_combo.count() == 1
    text = tab.personnages_run_combo.itemText(0)
    assert "run1" in text
    assert "(tours)" in text
    assert "(12 liens)" in text


def test_propagate_runs_with_utterance_assignments_when_run_is_utterance(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[str] = []
    store = _FakeStore(
        assignments=[
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:utterance:0",
                "character_id": "ted",
            }
        ]
    )
    db = _FakeDB(run={"align_run_id": "run1", "pivot_lang": "en", "params_json": '{"segment_kind":"utterance"}'})
    tab = _build_tab(store=store, db=db, statuses=statuses)
    tab._ask_languages_to_rewrite = lambda _langs: {"en"}
    infos: list[tuple[str, str]] = []
    questions: list[tuple[str, str]] = []

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    def _question(_parent, title: str, message: str, *_args, **_kwargs):
        questions.append((title, message))
        return QMessageBox.StandardButton.No

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.information", _info)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.question", _question)
    tab._propagate()

    assert questions == []
    assert store.propagate_calls == [("S01E01", "run1", {"en"})]
    assert any(msg.startswith("Propagation : 3 segment(s), 4 cue(s)") for msg in statuses)
    assert infos and infos[0][0] == "Propagation terminée"


def test_propagate_sentence_run_with_utterance_only_assignments_can_be_cancelled(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statuses: list[str] = []
    store = _FakeStore(
        assignments=[
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:utterance:0",
                "character_id": "ted",
            }
        ]
    )
    db = _FakeDB(run={"align_run_id": "run1", "pivot_lang": "en", "params_json": '{"segment_kind":"sentence"}'})
    tab = _build_tab(store=store, db=db, statuses=statuses)
    questions: list[tuple[str, str]] = []

    def _question(_parent, title: str, message: str, *_args, **_kwargs):
        questions.append((title, message))
        return QMessageBox.StandardButton.No

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.question", _question)
    tab._propagate()

    assert questions
    assert "Aucune assignation sur les phrases" in questions[0][1]
    assert store.propagate_calls == []
    assert statuses == []
