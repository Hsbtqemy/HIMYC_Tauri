"""Tests UI ciblés pour l'onglet Alignement."""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from PySide6.QtCore import QPoint
from PySide6.QtWidgets import QApplication, QMessageBox

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.models_qt import AlignLinksTableModel
from howimetyourcorpus.app.tabs.tab_alignement import AlignmentTabWidget
from howimetyourcorpus.core.pipeline.tasks import AlignEpisodeStep


class _FakeConnection:
    def __init__(self, links: list[dict[str, Any]]) -> None:
        self._links = links

    def __enter__(self) -> "_FakeConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        link_id = str(params[0]) if params else ""
        for link in self._links:
            if str(link.get("link_id")) != link_id:
                continue
            if "status = 'accepted'" in sql:
                link["status"] = "accepted"
            elif "status = 'rejected'" in sql:
                link["status"] = "rejected"

    def commit(self) -> None:
        return


class _FakeDB:
    def __init__(
        self,
        links: list[dict[str, Any]],
        *,
        segments_by_kind: dict[str, list[dict[str, Any]]] | None = None,
        cues_by_lang: dict[str, list[dict[str, Any]]] | None = None,
    ):
        self.links = links
        self.deleted_runs: list[str] = []
        self.last_stats_filter: str | None = None
        self._segments_by_kind = (
            segments_by_kind
            if segments_by_kind is not None
            else {
                "sentence": [{"segment_id": "S01E01:sentence:0", "text": "Hello"}],
                "utterance": [{"segment_id": "S01E01:utterance:0", "text": "Hello"}],
            }
        )
        self._cues_by_lang = (
            cues_by_lang
            if cues_by_lang is not None
            else {
                "en": [{"cue_id": "S01E01:en:0", "text_clean": "Hello"}],
                "fr": [{"cue_id": "S01E01:fr:0", "text_clean": "Salut"}],
            }
        )

    def connection(self) -> _FakeConnection:
        return _FakeConnection(self.links)

    def get_align_runs_for_episode(self, episode_id: str) -> list[dict[str, Any]]:  # noqa: ARG002
        return [{"align_run_id": "run1", "created_at": "2026-01-01T00:00:00", "params_json": "{}"}]

    def get_segments_for_episode(self, episode_id: str, kind: str | None = None) -> list[dict[str, Any]]:  # noqa: ARG002
        key = kind or "sentence"
        return list(self._segments_by_kind.get(key, []))

    def get_cues_for_episode_lang(self, episode_id: str, lang: str) -> list[dict[str, Any]]:  # noqa: ARG002
        return list(self._cues_by_lang.get(lang, []))

    def query_alignment_for_episode(  # noqa: ARG002
        self,
        episode_id: str,
        run_id: str | None = None,
        status_filter: str | None = None,
        min_confidence: float | None = None,
    ) -> list[dict[str, Any]]:
        rows = list(self.links)
        if status_filter:
            rows = [r for r in rows if (r.get("status") or "") == status_filter]
        if min_confidence is not None:
            rows = [r for r in rows if float(r.get("confidence") or 0.0) >= min_confidence]
        return rows

    def get_align_stats_for_run(  # noqa: ARG002
        self,
        episode_id: str,
        run_id: str,
        status_filter: str | None = None,
    ) -> dict[str, Any]:
        self.last_stats_filter = status_filter
        rows = self.query_alignment_for_episode(episode_id, run_id=run_id, status_filter=status_filter)
        return {"nb_links": len(rows), "nb_pivot": 0, "nb_target": 0, "avg_confidence": 0.5}

    def delete_align_run(self, run_id: str) -> None:
        self.deleted_runs.append(run_id)


class _FakeStore:
    def __init__(
        self,
        languages: list[str] | None = None,
        *,
        episodes: list[SimpleNamespace] | None = None,
    ) -> None:
        self._languages = ["en", "fr"] if languages is None else list(languages)
        self._episodes = list(episodes or [])

    def load_project_languages(self) -> list[str]:
        return list(self._languages)

    def load_series_index(self) -> SimpleNamespace:
        return SimpleNamespace(episodes=list(self._episodes))


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def _build_tab(
    db: _FakeDB,
    *,
    store: _FakeStore | None = None,
    run_job: Any | None = None,
) -> AlignmentTabWidget:
    tab = AlignmentTabWidget(
        get_store=lambda: store or _FakeStore(),
        get_db=lambda: db,
        run_job=run_job or (lambda _steps: None),
        undo_stack=None,
    )
    tab.align_episode_combo.blockSignals(True)
    tab.align_run_combo.blockSignals(True)
    tab.align_episode_combo.addItem("S01E01 - Pilot", "S01E01")
    tab.align_run_combo.addItem("run1", "run1")
    tab.align_episode_combo.setCurrentIndex(0)
    tab.align_run_combo.setCurrentIndex(0)
    tab.align_episode_combo.blockSignals(False)
    tab.align_run_combo.blockSignals(False)
    return tab


def test_bulk_accept_updates_only_candidates(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [
            {"link_id": "l1", "status": "auto", "confidence": 0.90},
            {"link_id": "l2", "status": "auto", "confidence": 0.50},
            {"link_id": "l3", "status": "accepted", "confidence": 0.99},
        ]
    )
    tab = _build_tab(db)
    infos: list[tuple[str, str]] = []
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.confirm_action", lambda *_a, **_k: True)

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.information", _info)
    tab.bulk_threshold_spin.setValue(80)
    tab._bulk_accept()

    assert db.links[0]["status"] == "accepted"
    assert db.links[1]["status"] == "auto"
    assert db.links[2]["status"] == "accepted"
    assert infos == [("Actions bulk", "1 lien(s) accepté(s).")]


def test_bulk_reject_updates_only_candidates(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [
            {"link_id": "l1", "status": "auto", "confidence": 0.90},
            {"link_id": "l2", "status": "auto", "confidence": 0.50},
            {"link_id": "l3", "status": "accepted", "confidence": 0.10},
        ]
    )
    tab = _build_tab(db)
    infos: list[tuple[str, str]] = []
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.confirm_action", lambda *_a, **_k: True)

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.information", _info)
    tab.bulk_threshold_spin.setValue(80)
    tab._bulk_reject()

    assert db.links[0]["status"] == "auto"
    assert db.links[1]["status"] == "rejected"
    assert db.links[2]["status"] == "accepted"
    assert infos == [("Actions bulk", "1 lien(s) rejeté(s).")]


def test_delete_current_run_calls_db_delete(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [
            {"link_id": "l1", "status": "auto", "confidence": 0.90},
            {"link_id": "l2", "status": "auto", "confidence": 0.50},
        ]
    )
    tab = _build_tab(db)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.confirm_action", lambda *_a, **_k: True)

    called = {"refresh": 0, "fill": 0}
    monkeypatch.setattr(tab, "refresh", lambda: called.__setitem__("refresh", called["refresh"] + 1))
    monkeypatch.setattr(tab, "_fill_links", lambda: called.__setitem__("fill", called["fill"] + 1))

    tab._delete_current_run()

    assert db.deleted_runs == ["run1"]
    assert called["refresh"] == 1
    assert called["fill"] == 1


def test_export_alignment_csv_writes_rows(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    db = _FakeDB(
        [
            {
                "link_id": "l1",
                "segment_id": "S01E01:sentence:0",
                "cue_id": "S01E01:en:0",
                "cue_id_target": "S01E01:fr:0",
                "lang": "fr",
                "role": "target",
                "confidence": 0.9,
                "status": "auto",
                "meta": {"k": "v"},
            }
        ]
    )
    tab = _build_tab(db)
    out = tmp_path / "align.csv"
    infos: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.QFileDialog.getSaveFileName",
        lambda *_args, **_kwargs: (str(out), "CSV (*.csv)"),
    )

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.information", _info)
    tab._export_alignment()

    assert out.exists()
    with out.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))
    assert rows[0][:3] == ["link_id", "segment_id", "cue_id"]
    assert rows[1][0] == "l1"
    assert infos == [("Export", "Alignement exporté : 1 lien(s).")]


def test_export_alignment_jsonl_writes_rows(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    db = _FakeDB(
        [
            {
                "link_id": "l1",
                "segment_id": "S01E01:sentence:0",
                "cue_id": "S01E01:en:0",
                "cue_id_target": "S01E01:fr:0",
                "lang": "fr",
                "role": "target",
                "confidence": 0.9,
                "status": "auto",
                "meta": {"k": "v"},
            }
        ]
    )
    tab = _build_tab(db)
    out = tmp_path / "align.jsonl"
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.QFileDialog.getSaveFileName",
        lambda *_args, **_kwargs: (str(out), "JSONL (*.jsonl)"),
    )
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.information", lambda *_a, **_k: None)
    tab._export_alignment()

    assert out.exists()
    payload = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert payload and payload[0]["link_id"] == "l1"


def test_run_align_episode_uses_selected_languages(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    db = _FakeDB(
        [],
        cues_by_lang={
            "en": [{"cue_id": "S01E01:en:0", "text_clean": "Hello"}],
            "es": [{"cue_id": "S01E01:es:0", "text_clean": "Hola"}],
        },
    )
    captured_steps: list[Any] = []
    tab = _build_tab(
        db,
        store=_FakeStore(["en", "fr", "es"]),
        run_job=lambda steps: captured_steps.extend(steps),
    )
    tab.align_segment_kind_combo.setCurrentIndex(tab.align_segment_kind_combo.findData("utterance"))
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("es"))

    tab._run_align_episode()

    assert len(captured_steps) == 1
    step = captured_steps[0]
    assert isinstance(step, AlignEpisodeStep)
    assert step.pivot_lang == "en"
    assert step.target_langs == ["es"]
    assert step.segment_kind == "utterance"


def test_run_align_episode_forwards_similarity_checkbox(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    db = _FakeDB(
        [],
        cues_by_lang={
            "en": [{"cue_id": "S01E01:en:0", "text_clean": "Hello"}],
            "fr": [{"cue_id": "S01E01:fr:0", "text_clean": "Salut"}],
        },
    )
    captured_steps: list[Any] = []
    tab = _build_tab(
        db,
        store=_FakeStore(["en", "fr"]),
        run_job=lambda steps: captured_steps.extend(steps),
    )
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("fr"))
    tab.align_by_similarity_cb.setChecked(True)

    tab._run_align_episode()

    assert len(captured_steps) == 1
    step = captured_steps[0]
    assert isinstance(step, AlignEpisodeStep)
    assert step.use_similarity_for_cues is True


def test_run_align_episode_warns_when_no_segments_and_no_target_selected(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [],
        segments_by_kind={"sentence": []},
    )
    captured_steps: list[Any] = []
    tab = _build_tab(db, run_job=lambda steps: captured_steps.extend(steps))
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.warning",
        lambda _parent, _title, message: warnings.append(message),
    )
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData(""))

    tab._run_align_episode()

    assert not captured_steps
    assert warnings
    assert "Aucun segment disponible" in warnings[0]
    assert "aucune langue cible" in warnings[0]


def test_run_align_episode_allows_cues_only_when_segments_missing(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    db = _FakeDB(
        [],
        segments_by_kind={"sentence": []},
        cues_by_lang={
            "en": [{"cue_id": "S01E01:en:0", "text_clean": "Hello"}],
            "fr": [{"cue_id": "S01E01:fr:0", "text_clean": "Salut"}],
        },
    )
    captured_steps: list[Any] = []
    tab = _build_tab(
        db,
        store=_FakeStore(["en", "fr"]),
        run_job=lambda steps: captured_steps.extend(steps),
    )
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("fr"))

    tab._run_align_episode()

    assert len(captured_steps) == 1
    step = captured_steps[0]
    assert isinstance(step, AlignEpisodeStep)
    assert step.pivot_lang == "en"
    assert step.target_langs == ["fr"]


def test_run_align_episode_warns_cues_only_when_pivot_missing(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [],
        segments_by_kind={"sentence": []},
        cues_by_lang={
            "fr": [{"cue_id": "S01E01:fr:0", "text_clean": "Salut"}],
        },
    )
    captured_steps: list[Any] = []
    tab = _build_tab(
        db,
        store=_FakeStore(["en", "fr"]),
        run_job=lambda steps: captured_steps.extend(steps),
    )
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("fr"))
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.warning",
        lambda _parent, _title, message: warnings.append(message),
    )

    tab._run_align_episode()

    assert not captured_steps
    assert warnings
    assert "piste pivot manquante" in warnings[0]


def test_run_align_episode_warns_when_no_subtitles(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [],
        cues_by_lang={},
    )
    captured_steps: list[Any] = []
    tab = _build_tab(db, store=_FakeStore(["en", "fr"]), run_job=lambda steps: captured_steps.extend(steps))
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("fr"))
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.warning",
        lambda _parent, _title, message: warnings.append(message),
    )

    tab._run_align_episode()

    assert not captured_steps
    assert warnings
    assert "Aucune piste de sous-titres" in warnings[0]


def test_run_align_episode_allows_target_fallback_when_pivot_missing(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    db = _FakeDB(
        [],
        cues_by_lang={
            "fr": [{"cue_id": "S01E01:fr:0", "text_clean": "Salut"}],
        },
    )
    captured_steps: list[Any] = []
    tab = _build_tab(
        db,
        store=_FakeStore(["en", "fr"]),
        run_job=lambda steps: captured_steps.extend(steps),
    )
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("fr"))

    tab._run_align_episode()

    assert len(captured_steps) == 1


def test_run_align_episode_warns_when_selected_target_missing(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _FakeDB(
        [],
        cues_by_lang={
            "en": [{"cue_id": "S01E01:en:0", "text_clean": "Hello"}],
        },
    )
    captured_steps: list[Any] = []
    tab = _build_tab(
        db,
        store=_FakeStore(["en", "fr"]),
        run_job=lambda steps: captured_steps.extend(steps),
    )
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("fr"))
    warnings: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.QMessageBox.warning",
        lambda _parent, _title, message: warnings.append(message),
    )

    tab._run_align_episode()

    assert not captured_steps
    assert warnings
    assert "Piste cible manquante" in warnings[0]


def test_restore_align_splitter_handles_invalid_qsettings_payload(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    debug_calls: list[tuple[Any, ...]] = []

    class _BadSettings:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            return

        @staticmethod
        def value(_key: str) -> list[str | int]:
            return ["not-an-int", 200]

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QSettings", _BadSettings)
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.logger.debug",
        lambda *args, **_kwargs: debug_calls.append(args),
    )

    tab._restore_align_splitter()

    assert debug_calls
    assert "Invalid AlignmentTab splitter state" in str(debug_calls[0][0])


def test_save_state_persists_splitter_sizes(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    captured: dict[str, Any] = {}

    class _CaptureSettings:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            return

        @staticmethod
        def value(_key: str) -> None:
            return None

        def setValue(self, key: str, value: Any) -> None:  # noqa: N802 - API Qt
            captured[key] = value

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QSettings", _CaptureSettings)

    tab.save_state()

    assert "mainSplitter" in captured
    assert isinstance(captured["mainSplitter"], list)
    assert len(captured["mainSplitter"]) >= 2


def test_restore_align_splitter_ignores_non_sequence_payload(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    before = tab.main_splitter.sizes()

    class _BadSettings:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            return

        @staticmethod
        def value(_key: str) -> str:
            return "invalid"

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_alignement.QSettings", _BadSettings)
    tab._restore_align_splitter()

    assert tab.main_splitter.sizes() == before


def test_refresh_returns_early_when_store_missing(qapp: QApplication) -> None:  # noqa: ARG001
    tab = AlignmentTabWidget(
        get_store=lambda: None,
        get_db=lambda: _FakeDB([]),
        run_job=lambda _steps: None,
        undo_stack=None,
    )
    tab.align_episode_combo.addItem("S01E01 - Pilot", "S01E01")
    tab.align_episode_combo.setCurrentIndex(0)

    tab.refresh()

    assert tab.align_episode_combo.count() == 0


def test_refresh_reloads_episodes_and_preserves_current_selection(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _FakeStore(
        ["en", "fr"],
        episodes=[
            SimpleNamespace(episode_id="S01E01", title="Pilot"),
            SimpleNamespace(episode_id="S01E02", title="Purple Giraffe"),
        ],
    )
    tab = _build_tab(_FakeDB([]), store=store)
    tab.align_episode_combo.clear()
    tab.align_episode_combo.addItem("S01E01 - Pilot", "S01E01")
    tab.align_episode_combo.addItem("S01E02 - Purple Giraffe", "S01E02")
    tab.align_episode_combo.setCurrentIndex(1)
    changed = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_on_episode_changed",
        lambda: changed.__setitem__("count", changed["count"] + 1),
    )

    tab.refresh()

    assert tab.align_episode_combo.count() == 2
    assert tab.align_episode_combo.currentData() == "S01E02"
    assert changed["count"] >= 1


def test_refresh_handles_store_index_without_episodes(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]), store=_FakeStore(["en", "fr"], episodes=[]))
    tab.align_episode_combo.addItem("S01E09 - Legacy", "S01E09")
    tab.align_episode_combo.setCurrentIndex(1)
    changed = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_on_episode_changed",
        lambda: changed.__setitem__("count", changed["count"] + 1),
    )

    tab.refresh()

    assert tab.align_episode_combo.count() == 0
    assert changed["count"] >= 1


def test_refresh_rebuilds_episode_list_when_previous_selection_missing(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _FakeStore(
        ["en", "fr"],
        episodes=[
            SimpleNamespace(episode_id="S01E03", title="Sweet Taste of Liberty"),
        ],
    )
    tab = _build_tab(_FakeDB([]), store=store)
    tab.align_episode_combo.clear()
    tab.align_episode_combo.addItem("S01E02 - Purple Giraffe", "S01E02")
    tab.align_episode_combo.setCurrentIndex(0)
    changed = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_on_episode_changed",
        lambda: changed.__setitem__("count", changed["count"] + 1),
    )

    tab.refresh()

    assert tab.align_episode_combo.count() == 1
    assert tab.align_episode_combo.currentData() == "S01E03"
    assert changed["count"] >= 1


def test_refresh_rebuilds_episode_list_without_previous_selection(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    store = _FakeStore(
        ["en", "fr"],
        episodes=[SimpleNamespace(episode_id="S01E04", title="Return of the Shirt")],
    )
    tab = _build_tab(_FakeDB([]), store=store)
    tab.align_episode_combo.clear()

    tab.refresh()

    assert tab.align_episode_combo.count() == 1
    assert tab.align_episode_combo.currentData() == "S01E04"


def test_set_episode_and_segment_kind_selects_matching_items(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    tab.align_episode_combo.addItem("S01E02 - Purple Giraffe", "S01E02")
    changed = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_on_episode_changed",
        lambda: changed.__setitem__("count", changed["count"] + 1),
    )

    tab.set_episode_and_segment_kind("S01E02", "utterance")

    assert tab.align_segment_kind_combo.currentData() == "utterance"
    assert tab.align_episode_combo.currentData() == "S01E02"
    assert changed["count"] >= 1


def test_set_episode_and_segment_kind_keeps_selection_when_not_found(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    tab.align_segment_kind_combo.clear()
    changed = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_on_episode_changed",
        lambda: changed.__setitem__("count", changed["count"] + 1),
    )

    tab.set_episode_and_segment_kind("S99E99", "utterance")

    assert tab.align_episode_combo.currentData() == "S01E01"
    assert changed["count"] == 1


def test_load_project_languages_normalizes_and_falls_back(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = _build_tab(_FakeDB([]), store=_FakeStore([" EN ", "fr", "FR", "", "  "]))
    assert tab._load_project_languages() == ["en", "fr"]

    tab_empty = _build_tab(_FakeDB([]), store=_FakeStore([]))
    assert tab_empty._load_project_languages() == ["en", "fr"]


def test_refresh_language_combos_falls_back_to_first_when_en_missing(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = _build_tab(_FakeDB([]), store=_FakeStore(["fr", "es"]))
    tab.align_pivot_lang_combo.clear()
    tab.align_pivot_lang_combo.addItem("DE", "de")
    tab.align_pivot_lang_combo.setCurrentIndex(0)

    tab._refresh_language_combos()

    assert tab.align_pivot_lang_combo.currentData() == "fr"


def test_refresh_target_lang_combo_prefers_fr_when_available(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = _build_tab(_FakeDB([]), store=_FakeStore(["en", "fr", "es"]))
    tab.align_pivot_lang_combo.setCurrentIndex(tab.align_pivot_lang_combo.findData("en"))

    tab._refresh_target_lang_combo(preferred="xx")

    assert tab.align_target_lang_combo.currentData() == "fr"


def test_on_pivot_lang_changed_forwards_current_target(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]), store=_FakeStore(["en", "fr", "es"]))
    tab.align_target_lang_combo.setCurrentIndex(tab.align_target_lang_combo.findData("es"))
    captured: dict[str, str] = {}
    monkeypatch.setattr(tab, "_refresh_target_lang_combo", lambda preferred="": captured.setdefault("preferred", preferred))

    tab._on_pivot_lang_changed()

    assert captured["preferred"] == "es"


def test_on_episode_changed_returns_early_when_db_or_episode_missing(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = AlignmentTabWidget(
        get_store=lambda: _FakeStore(),
        get_db=lambda: None,
        run_job=lambda _steps: None,
        undo_stack=None,
    )
    fill_calls = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_fill_links",
        lambda: fill_calls.__setitem__("count", fill_calls["count"] + 1),
    )

    tab._on_episode_changed()

    assert fill_calls["count"] == 1


def test_on_episode_changed_formats_segment_kind_labels_when_payload_is_valid(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _RunsDB(_FakeDB):
        @staticmethod
        def get_align_runs_for_episode(_episode_id: str) -> list[dict[str, Any]]:
            return [
                {"align_run_id": "run-valid", "created_at": "2026-01-01T00:00:00", "params_json": "{}"},
                {"align_run_id": "run-invalid", "created_at": "2026-01-02T00:00:00", "params_json": "{}"},
                {"align_run_id": "run-none", "created_at": None, "params_json": None},
            ]

    tab = _build_tab(_RunsDB([]))
    parse_calls: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.parse_run_segment_kind",
        lambda _payload, *, run_id, logger_obj: (  # noqa: ARG005
            ("utterance", True) if run_id == "run-valid" else ("sentence", False)
        ),
    )
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.format_segment_kind_label",
        lambda kind: parse_calls.append(kind) or " [TOURS]",
    )
    run_changed = {"count": 0}
    monkeypatch.setattr(
        tab,
        "_on_run_changed",
        lambda: run_changed.__setitem__("count", run_changed["count"] + 1),
    )

    tab._on_episode_changed()

    assert tab.align_run_combo.count() == 3
    assert " [TOURS]" in tab.align_run_combo.itemText(0)
    assert " [TOURS]" not in tab.align_run_combo.itemText(1)
    assert run_changed["count"] >= 1
    assert parse_calls == ["utterance"]


def test_on_run_changed_toggles_delete_button_and_refreshes_views(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    calls = {"fill": 0, "stats": 0}
    monkeypatch.setattr(tab, "_fill_links", lambda: calls.__setitem__("fill", calls["fill"] + 1))
    monkeypatch.setattr(tab, "_update_stats", lambda: calls.__setitem__("stats", calls["stats"] + 1))

    tab.align_run_combo.clear()
    tab._on_run_changed()
    assert not tab.align_delete_run_btn.isEnabled()

    tab.align_run_combo.addItem("run1", "run1")
    tab.align_run_combo.setCurrentIndex(0)
    tab._on_run_changed()
    assert tab.align_delete_run_btn.isEnabled()
    assert calls["fill"] >= 2
    assert calls["stats"] >= 2
    assert calls["fill"] == calls["stats"]


def test_update_stats_clears_widget_when_context_missing(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    tab.align_episode_combo.clear()
    cleared = {"count": 0}
    monkeypatch.setattr(
        tab.stats_widget,
        "clear_stats",
        lambda: cleared.__setitem__("count", cleared["count"] + 1),
    )

    tab._update_stats()

    assert cleared["count"] == 1


def test_update_stats_uses_accepted_filter_when_checkbox_checked(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    db = _FakeDB(
        [
            {"link_id": "l1", "status": "accepted", "confidence": 0.9},
            {"link_id": "l2", "status": "auto", "confidence": 0.4},
        ]
    )
    tab = _build_tab(db)
    tab.align_accepted_only_cb.setChecked(True)

    tab._update_stats()

    assert db.last_stats_filter == "accepted"


def test_update_stats_logs_and_clears_widget_on_exception(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FailDB(_FakeDB):
        @staticmethod
        def get_align_stats_for_run(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("boom")

    tab = _build_tab(_FailDB([]))
    cleared = {"count": 0}
    logged = {"count": 0}
    monkeypatch.setattr(
        tab.stats_widget,
        "clear_stats",
        lambda: cleared.__setitem__("count", cleared["count"] + 1),
    )
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.tab_alignement.logger.exception",
        lambda *_args, **_kwargs: logged.__setitem__("count", logged["count"] + 1),
    )

    tab._update_stats()

    assert logged["count"] == 1
    assert cleared["count"] == 1


def test_fill_links_sets_empty_model_when_episode_or_db_missing(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    tab = AlignmentTabWidget(
        get_store=lambda: _FakeStore(),
        get_db=lambda: None,
        run_job=lambda _steps: None,
        undo_stack=None,
    )
    tab._fill_links()

    model = tab.align_table.model()
    assert isinstance(model, AlignLinksTableModel)
    assert model.rowCount() == 0


def test_table_context_menu_delegates_to_actions_controller(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]))
    captured: dict[str, Any] = {}
    monkeypatch.setattr(
        tab._actions_controller,
        "table_context_menu",
        lambda pos, *, menu_cls, edit_dialog_cls: captured.update(
            {"pos": pos, "menu_cls": menu_cls, "edit_dialog_cls": edit_dialog_cls}
        ),
    )

    tab._table_context_menu(QPoint(3, 7))

    assert captured["pos"] == QPoint(3, 7)
    assert captured["menu_cls"].__name__ == "QMenu"
    assert captured["edit_dialog_cls"].__name__ == "EditAlignLinkDialog"


def test_wrappers_delegate_to_actions_controller_with_qt_dependencies(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = _build_tab(_FakeDB([]), store=_FakeStore(["en", "fr"]))
    calls: list[tuple[str, dict[str, Any]]] = []

    monkeypatch.setattr(
        tab._actions_controller,
        "generate_alignment_groups",
        lambda **kwargs: calls.append(("groups", kwargs)),
    )
    monkeypatch.setattr(
        tab._actions_controller,
        "export_grouped_alignment",
        lambda **kwargs: calls.append(("grouped_export", kwargs)),
    )
    monkeypatch.setattr(
        tab._actions_controller,
        "export_parallel_concordance",
        lambda **kwargs: calls.append(("parallel_export", kwargs)),
    )
    monkeypatch.setattr(
        tab._actions_controller,
        "export_align_report",
        lambda **kwargs: calls.append(("report_export", kwargs)),
    )

    tab._generate_alignment_groups()
    tab._export_grouped_alignment()
    tab._export_parallel_concordance()
    tab._export_align_report()

    assert [name for name, _kwargs in calls] == [
        "groups",
        "grouped_export",
        "parallel_export",
        "report_export",
    ]
    assert "message_box" in calls[0][1]
    assert "file_dialog" in calls[1][1]
    assert "file_dialog" in calls[2][1]
    assert "file_dialog" in calls[3][1]
