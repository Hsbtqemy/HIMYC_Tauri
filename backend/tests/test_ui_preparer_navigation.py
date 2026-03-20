"""Non-régression UI: navigation Inspecteur → Préparer → Alignement."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QHeaderView,
    QLineEdit,
    QMessageBox,
    QStyleOptionViewItem,
    QTableWidgetItem,
)

from howimetyourcorpus.app.ui_mainwindow import (
    MainWindow,
    TAB_ALIGNEMENT,
    TAB_INSPECTEUR,
    TAB_PREPARER,
)
from howimetyourcorpus.core.models import EpisodeRef, ProjectConfig, SeriesIndex, TransformStats
from howimetyourcorpus.core.segment import Segment
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore
from howimetyourcorpus.core.subtitles import Cue


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
    yield win
    win.close()


def test_preparer_tab_inserted_between_inspecteur_and_alignement(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    assert win.tabs.tabText(TAB_INSPECTEUR) == "Inspecteur"
    assert win.tabs.tabText(TAB_PREPARER) == "Préparer"
    assert win.tabs.tabText(TAB_ALIGNEMENT) == "Alignement"


def test_navigation_handoff_episode_and_segment_kind(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    win.tabs.setCurrentIndex(TAB_INSPECTEUR)

    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.tabs.currentIndex() == TAB_PREPARER
    assert win.preparer_tab.current_episode_id() == "S01E01"

    win.open_alignement_for_episode("S01E01", segment_kind="utterance")
    assert win.tabs.currentIndex() == TAB_ALIGNEMENT
    assert win.alignment_tab.align_episode_combo.currentData() == "S01E01"
    assert win.alignment_tab.align_segment_kind_combo.currentData() == "utterance"


def test_preparer_go_to_alignement_uses_utterance_when_transcript_rows_present(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.preparer_tab._set_utterances(  # noqa: SLF001 - test ciblé handoff
        [
            {
                "episode_id": "S01E01",
                "kind": "utterance",
                "n": 0,
                "text": "Hi",
                "speaker_explicit": "TED",
            }
        ]
    )

    called: dict[str, str] = {}
    win.preparer_tab._on_go_alignement = lambda episode_id, segment_kind: called.update(  # noqa: SLF001
        {"episode_id": episode_id, "segment_kind": segment_kind}
    )

    win.preparer_tab._go_to_alignement()
    assert called == {"episode_id": "S01E01", "segment_kind": "utterance"}


def test_preparer_go_to_alignement_prefers_existing_utterances_from_srt_source(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None

    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    monkeypatch.setattr(
        db,
        "get_segments_for_episode",
        lambda episode_id, kind=None: (
            [{"episode_id": episode_id, "kind": "utterance", "text": "Hi"}]
            if episode_id == "S01E01" and kind == "utterance"
            else []
        ),
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="srt_en")
    assert win.preparer_tab.prep_source_combo.currentData() == "srt_en"

    called: dict[str, str] = {}
    win.preparer_tab._on_go_alignement = lambda episode_id, segment_kind: called.update(  # noqa: SLF001
        {"episode_id": episode_id, "segment_kind": segment_kind}
    )
    win.preparer_tab._go_to_alignement()

    assert called == {"episode_id": "S01E01", "segment_kind": "utterance"}


def test_preparer_can_open_srt_source_when_track_exists(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")

    assert win.tabs.currentIndex() == TAB_PREPARER
    assert win.preparer_tab.prep_source_combo.currentData() == "srt_en"
    assert win.preparer_tab.cue_table.rowCount() == 1


def test_preparer_tab_switch_keeps_current_episode_and_source(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="srt_en")
    assert win.tabs.currentIndex() == TAB_PREPARER
    assert win.preparer_tab.prep_episode_combo.currentData() == "S01E01"
    assert win.preparer_tab.prep_source_combo.currentData() == "srt_en"
    assert win.preparer_tab.cue_table.rowCount() == 1

    win.tabs.setCurrentIndex(TAB_INSPECTEUR)
    assert win.tabs.currentIndex() == TAB_INSPECTEUR
    win.tabs.setCurrentIndex(TAB_PREPARER)

    assert win.tabs.currentIndex() == TAB_PREPARER
    assert win.preparer_tab.prep_episode_combo.currentData() == "S01E01"
    assert win.preparer_tab.prep_source_combo.currentData() == "srt_en"
    assert win.preparer_tab.cue_table.rowCount() == 1
    text_item = win.preparer_tab.cue_table.item(0, 4)
    assert text_item is not None
    assert text_item.text() == "Hi"

    win.tabs.setCurrentIndex(TAB_ALIGNEMENT)
    assert win.tabs.currentIndex() == TAB_ALIGNEMENT
    win.tabs.setCurrentIndex(TAB_PREPARER)

    assert win.tabs.currentIndex() == TAB_PREPARER
    assert win.preparer_tab.prep_episode_combo.currentData() == "S01E01"
    assert win.preparer_tab.prep_source_combo.currentData() == "srt_en"
    assert win.preparer_tab.cue_table.rowCount() == 1


def test_preparer_tables_resize_with_multiline_content(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=5,
                text="Hello",
                speaker_explicit="TED",
            )
        ],
    )
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    utter_table = win.preparer_tab.utterance_table

    assert utter_table.horizontalHeader().sectionResizeMode(2) == QHeaderView.ResizeMode.Stretch
    assert utter_table.verticalHeader().sectionResizeMode(0) == QHeaderView.ResizeMode.ResizeToContents

    utter_initial = utter_table.rowHeight(0)
    win.preparer_tab._apply_table_cell_value(utter_table, 0, 2, "Hello\nthere")
    QApplication.processEvents()
    utter_after = utter_table.rowHeight(0)
    assert utter_after > utter_initial

    win.preparer_tab._set_dirty(False)
    win.open_preparer_for_episode("S01E01", source="srt_en")
    cue_table = win.preparer_tab.cue_table
    assert cue_table.horizontalHeader().sectionResizeMode(4) == QHeaderView.ResizeMode.Stretch
    assert cue_table.verticalHeader().sectionResizeMode(0) == QHeaderView.ResizeMode.ResizeToContents

    cue_initial = cue_table.rowHeight(0)
    win.preparer_tab._apply_table_cell_value(cue_table, 0, 4, "Line 1\nLine 2")
    QApplication.processEvents()
    cue_after = cue_table.rowHeight(0)
    assert cue_after > cue_initial
    win.preparer_tab._set_dirty(False)


def test_preparer_srt_timecode_edit_persists_to_db(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    store = win._store
    assert db is not None
    assert store is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")

    win.preparer_tab.prep_edit_timecodes_cb.setChecked(True)
    start_item = win.preparer_tab.cue_table.item(0, 1)
    end_item = win.preparer_tab.cue_table.item(0, 2)
    assert start_item is not None
    assert end_item is not None
    start_item.setText("00:00:01,500")
    end_item.setText("00:00:02,200")

    assert win.preparer_tab.save_current() is True
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["start_ms"] == 1500
    assert cues[0]["end_ms"] == 2200
    content_fmt = store.load_episode_subtitle_content("S01E01", "en")
    assert content_fmt is not None
    content, fmt = content_fmt
    assert fmt == "srt"
    assert "00:00:01,500 --> 00:00:02,200" in content


def test_preparer_personnage_column_has_editable_combo_choices(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None
    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "Ted",
                "names_by_lang": {"en": "Ted", "fr": "Théodore"},
            }
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="Ted",
            )
        ],
    )
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    utter_index = win.preparer_tab.utterance_table.model().index(0, 1)
    utter_delegate = win.preparer_tab.utterance_table.itemDelegateForColumn(1)
    utter_editor = utter_delegate.createEditor(
        win.preparer_tab.utterance_table,
        QStyleOptionViewItem(),
        utter_index,
    )
    assert isinstance(utter_editor, QComboBox)
    utter_values = {utter_editor.itemText(i) for i in range(utter_editor.count())}
    assert any(v in utter_values for v in ("ted", "Ted"))
    assert "Théodore" in utter_values

    win.open_preparer_for_episode("S01E01", source="srt_en")
    cue_index = win.preparer_tab.cue_table.model().index(0, 3)
    cue_delegate = win.preparer_tab.cue_table.itemDelegateForColumn(3)
    cue_editor = cue_delegate.createEditor(
        win.preparer_tab.cue_table,
        QStyleOptionViewItem(),
        cue_index,
    )
    assert isinstance(cue_editor, QComboBox)
    cue_values = {cue_editor.itemText(i) for i in range(cue_editor.count())}
    assert any(v in cue_values for v in ("ted", "Ted"))
    assert "Théodore" in cue_values


def test_preparer_srt_timecode_editability_restored_after_source_switch(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )

    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")
    win.preparer_tab.prep_edit_timecodes_cb.setChecked(True)

    start_item = win.preparer_tab.cue_table.item(0, 1)
    assert start_item is not None
    assert bool(start_item.flags() & Qt.ItemFlag.ItemIsEditable)

    win.open_preparer_for_episode("S01E01", source="transcript")
    win.open_preparer_for_episode("S01E01", source="srt_en")
    start_item = win.preparer_tab.cue_table.item(0, 1)
    assert start_item is not None
    assert win.preparer_tab.prep_edit_timecodes_cb.isChecked()
    assert win.preparer_tab.prep_edit_timecodes_cb.isEnabled()
    assert bool(start_item.flags() & Qt.ItemFlag.ItemIsEditable)


def test_preparer_srt_timecode_strict_rejects_overlap(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            ),
            Cue(
                episode_id="S01E01",
                lang="en",
                n=1,
                start_ms=2000,
                end_ms=2600,
                text_raw="There",
                text_clean="There",
            ),
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")

    warnings: list[str] = []

    def _fake_warning(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        warnings.append(text)
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.warning", _fake_warning)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.critical", _fake_warning)

    win.preparer_tab.prep_edit_timecodes_cb.setChecked(True)
    win.preparer_tab.prep_strict_timecodes_cb.setChecked(True)
    end_item = win.preparer_tab.cue_table.item(0, 2)
    assert end_item is not None
    end_item.setText("00:00:02,300")  # Overlap avec la cue 2 (start=2000).

    assert win.preparer_tab.save_current() is False
    assert any("Chevauchement détecté" in w for w in warnings)
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["end_ms"] == 1800
    assert cues[1]["start_ms"] == 2000
    win.preparer_tab._set_dirty(False)


def test_preparer_srt_timecode_overlap_allowed_when_strict_disabled(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            ),
            Cue(
                episode_id="S01E01",
                lang="en",
                n=1,
                start_ms=2000,
                end_ms=2600,
                text_raw="There",
                text_clean="There",
            ),
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")
    win.preparer_tab.prep_edit_timecodes_cb.setChecked(True)
    win.preparer_tab.prep_strict_timecodes_cb.setChecked(False)

    end_item = win.preparer_tab.cue_table.item(0, 2)
    assert end_item is not None
    end_item.setText("00:00:02,300")

    assert win.preparer_tab.save_current() is True
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["end_ms"] == 2300
    assert cues[1]["start_ms"] == 2000


def test_preparer_srt_timecode_rejects_invalid_range(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")

    warnings: list[str] = []

    def _fake_warning(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        warnings.append(text)
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.warning", _fake_warning)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.critical", _fake_warning)

    win.preparer_tab.prep_edit_timecodes_cb.setChecked(True)
    start_item = win.preparer_tab.cue_table.item(0, 1)
    end_item = win.preparer_tab.cue_table.item(0, 2)
    assert start_item is not None
    assert end_item is not None
    start_item.setText("00:00:02,500")
    end_item.setText("00:00:02,000")

    assert win.preparer_tab.save_current() is False
    assert any("timecodes invalides" in w for w in warnings)
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["start_ms"] == 1000
    assert cues[0]["end_ms"] == 1800
    win.preparer_tab._set_dirty(False)


def test_preparer_save_transcript_rejects_unknown_character(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="TED",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="transcript")

    warnings: list[str] = []

    def _fake_warning(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        warnings.append(text)
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.preparer_save.QMessageBox.warning", _fake_warning)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.critical", _fake_warning)

    assert win.preparer_tab.save_current() is False
    assert any("Personnage(s) inconnu(s)" in w for w in warnings)
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs[0]["speaker_explicit"] == "TED"
    win.preparer_tab._set_dirty(False)


def test_preparer_save_cue_rejects_unknown_character(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")

    speaker_item = win.preparer_tab.cue_table.item(0, 3)
    assert speaker_item is not None
    speaker_item.setText("Ted")

    warnings: list[str] = []

    def _fake_warning(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        warnings.append(text)
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.preparer_save.QMessageBox.warning", _fake_warning)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.critical", _fake_warning)

    assert win.preparer_tab.save_current() is False
    assert any("Personnage(s) inconnu(s)" in w for w in warnings)
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["text_clean"] == "Hi"
    win.preparer_tab._set_dirty(False)


def test_preparer_utterance_cell_edit_undo_redo(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="TED",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="transcript")
    table = win.preparer_tab.utterance_table
    assert table.rowCount() == 1
    text_item = table.item(0, 2)
    assert text_item is not None
    assert text_item.text() == "Hi"

    count_before = win.undo_stack.count()
    text_item.setText("Hello")
    assert table.item(0, 2).text() == "Hello"
    assert win.undo_stack.count() == count_before + 1

    win.undo_stack.undo()
    assert table.item(0, 2).text() == "Hi"
    win.undo_stack.redo()
    assert table.item(0, 2).text() == "Hello"
    win.preparer_tab._set_dirty(False)


def test_preparer_segment_draft_undo_restores_previous_view(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.preparer_tab.stack.currentWidget() == win.preparer_tab.text_editor
    win.preparer_tab.text_editor.setPlainText("TED: Hi\nMARSHALL: Yo")

    count_before = win.undo_stack.count()
    win.preparer_tab._segment_to_utterances()
    assert win.preparer_tab.stack.currentWidget() == win.preparer_tab.utterance_table
    assert win.preparer_tab.utterance_table.rowCount() == 2
    assert win.undo_stack.count() == count_before + 1

    win.undo_stack.undo()
    assert win.preparer_tab.stack.currentWidget() == win.preparer_tab.text_editor
    win.preparer_tab._set_dirty(False)


def test_preparer_status_combo_persists_and_is_undoable(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None
    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.preparer_tab.prep_status_combo.currentData() == "raw"

    idx_verified = win.preparer_tab.prep_status_combo.findData("verified")
    assert idx_verified >= 0
    win.preparer_tab.prep_status_combo.setCurrentIndex(idx_verified)
    assert store.get_episode_prep_status("S01E01", "transcript") == "verified"

    win.undo_stack.undo()
    assert store.get_episode_prep_status("S01E01", "transcript") == "raw"
    win.undo_stack.redo()
    assert store.get_episode_prep_status("S01E01", "transcript") == "verified"


def test_preparer_default_status_transcript_clean_is_normalized(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None
    store.save_episode_clean(
        "S01E01",
        "Clean content",
        TransformStats(raw_lines=1, clean_lines=1, merges=0, kept_breaks=0, duration_ms=0),
        {"source": "test"},
    )

    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.preparer_tab.prep_status_combo.currentData() == "normalized"


def test_preparer_default_status_srt_text_clean_diff_is_normalized(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Ted: Hi",
            )
        ],
    )

    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")
    assert win.preparer_tab.prep_status_combo.currentData() == "normalized"


def test_preparer_save_transcript_rows_undo_restores_db(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    store = win._store
    assert db is not None
    assert store is not None
    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "TED",
                "names_by_lang": {"en": "Ted"},
            }
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="TED",
            )
        ],
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.undo_stack.clear()

    table = win.preparer_tab.utterance_table
    win.preparer_tab._apply_table_cell_value(table, 0, 2, "Hello there")
    assert win.preparer_tab.save_current() is True
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs[0]["text"] == "Hello there"
    assert store.get_episode_prep_status("S01E01", "transcript") == "edited"

    # Changement hors scope transcript, à préserver lors du undo.
    store.set_episode_prep_status("S01E01", "srt_en", "verified")
    assignments = store.load_character_assignments()
    assignments.append(
        {
            "episode_id": "S01E01",
            "source_type": "cue",
            "source_id": "S01E01:en:999",
            "character_id": "someone_else",
        }
    )
    store.save_character_assignments(assignments)

    win.undo_stack.undo()
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs[0]["text"] == "Hi"
    assert store.get_episode_prep_status("S01E01", "transcript") == "raw"
    assert store.get_episode_prep_status("S01E01", "srt_en") == "verified"
    assert any(
        a.get("source_type") == "cue"
        and a.get("source_id") == "S01E01:en:999"
        for a in store.load_character_assignments()
    )
    win.undo_stack.redo()
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs[0]["text"] == "Hello there"
    assert store.get_episode_prep_status("S01E01", "transcript") == "edited"
    assert store.get_episode_prep_status("S01E01", "srt_en") == "verified"
    assert any(
        a.get("source_type") == "cue"
        and a.get("source_id") == "S01E01:en:999"
        for a in store.load_character_assignments()
    )
    win.preparer_tab._set_dirty(False)


def test_preparer_save_srt_undo_restores_db_and_file(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    store = win._store
    assert db is not None
    assert store is not None
    db.add_track("S01E01:en", "S01E01", "en", "srt")
    db.upsert_cues(
        "S01E01:en",
        "S01E01",
        "en",
        [
            Cue(
                episode_id="S01E01",
                lang="en",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hi",
                text_clean="Hi",
            )
        ],
    )
    store.save_episode_subtitle_content(
        "S01E01",
        "en",
        "1\n00:00:01,000 --> 00:00:01,800\nHi\n",
        "srt",
    )
    win._refresh_preparer()
    win.open_preparer_for_episode("S01E01", source="srt_en")
    win.undo_stack.clear()

    table = win.preparer_tab.cue_table
    win.preparer_tab._apply_table_cell_value(table, 0, 4, "Ted: Hi")
    assert win.preparer_tab.save_current() is True
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["text_clean"] == "Ted: Hi"
    assert store.get_episode_prep_status("S01E01", "srt_en") == "edited"
    content_fmt = store.load_episode_subtitle_content("S01E01", "en")
    assert content_fmt is not None
    assert "Ted: Hi" in content_fmt[0]

    # Changement hors scope srt_en, à préserver lors du undo.
    store.set_episode_prep_status("S01E01", "transcript", "verified")
    assignments = store.load_character_assignments()
    assignments.append(
        {
            "episode_id": "S01E01",
            "source_type": "segment",
            "source_id": "S01E01:utterance:999",
            "character_id": "ted",
        }
    )
    store.save_character_assignments(assignments)

    win.undo_stack.undo()
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["text_clean"] == "Hi"
    assert store.get_episode_prep_status("S01E01", "srt_en") == "raw"
    assert store.get_episode_prep_status("S01E01", "transcript") == "verified"
    assert any(
        a.get("source_type") == "segment"
        and a.get("source_id") == "S01E01:utterance:999"
        for a in store.load_character_assignments()
    )
    content_fmt = store.load_episode_subtitle_content("S01E01", "en")
    assert content_fmt is not None
    assert "Ted: Hi" not in content_fmt[0]
    win.undo_stack.redo()
    cues = db.get_cues_for_episode_lang("S01E01", "en")
    assert cues[0]["text_clean"] == "Ted: Hi"
    assert store.get_episode_prep_status("S01E01", "srt_en") == "edited"
    assert store.get_episode_prep_status("S01E01", "transcript") == "verified"
    assert any(
        a.get("source_type") == "segment"
        and a.get("source_id") == "S01E01:utterance:999"
        for a in store.load_character_assignments()
    )
    win.preparer_tab._set_dirty(False)


def test_preparer_save_clean_file_undo_restores_previous_file_state(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.undo_stack.clear()
    if store.has_episode_clean("S01E01"):
        # Garantir un état initial sans clean pour ce test.
        ep_dir = store.root_dir / "episodes" / "S01E01"
        clean_path = ep_dir / "clean.txt"
        if clean_path.exists():
            clean_path.unlink()

    win.preparer_tab.stack.setCurrentWidget(win.preparer_tab.text_editor)
    win.preparer_tab._apply_plain_text_value("Fresh clean text.")
    assert win.preparer_tab.save_current() is True
    assert store.has_episode_clean("S01E01")
    assert store.load_episode_text("S01E01", kind="clean") == "Fresh clean text."
    assert store.get_episode_prep_status("S01E01", "transcript") == "edited"

    win.undo_stack.undo()
    assert not store.has_episode_clean("S01E01")
    assert store.get_episode_prep_status("S01E01", "transcript") == "raw"
    win.undo_stack.redo()
    assert store.has_episode_clean("S01E01")
    assert store.load_episode_text("S01E01", kind="clean") == "Fresh clean text."
    assert store.get_episode_prep_status("S01E01", "transcript") == "edited"
    win.preparer_tab._set_dirty(False)


def test_refresh_tabs_after_job_preserves_preparer_dirty_draft(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None
    store.save_episode_clean(
        "S01E01",
        "Saved text",
        TransformStats(raw_lines=1, clean_lines=1, merges=0, kept_breaks=0, duration_ms=0),
        {"source": "test"},
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.preparer_tab.text_editor.setPlainText("UNSAVED EDIT")
    assert win.preparer_tab.has_unsaved_changes()
    assert win.preparer_tab.text_editor.toPlainText() == "UNSAVED EDIT"

    win._refresh_tabs_after_job()
    assert win.preparer_tab.has_unsaved_changes()
    assert win.preparer_tab.text_editor.toPlainText() == "UNSAVED EDIT"
    win.preparer_tab._set_dirty(False)


def test_personnages_save_assignments_cues_scoped_by_lang(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None

    store.save_character_assignments(
        [
            {
                "episode_id": "S01E01",
                "source_type": "cue",
                "source_id": "S01E01:en:1",
                "character_id": "ted",
            },
            {
                "episode_id": "S01E01",
                "source_type": "cue",
                "source_id": "S01E01:fr:1",
                "character_id": "barney",
            },
        ]
    )

    win.personnages_tab.refresh()
    idx = win.personnages_tab.personnages_source_combo.findData("cues_fr")
    assert idx >= 0
    win.personnages_tab.personnages_source_combo.setCurrentIndex(idx)

    # Sauvegarde sans lignes modifiées: ne doit purger que le scope FR.
    win.personnages_tab._save_assignments()
    assignments = store.load_character_assignments()
    assert any(a.get("source_id") == "S01E01:en:1" for a in assignments)
    assert not any(a.get("source_id") == "S01E01:fr:1" for a in assignments)


def test_personnages_save_warns_on_character_alias_collision(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None

    win.personnages_tab.refresh()
    table = win.personnages_tab.personnages_table
    table.setRowCount(2)
    table.setItem(0, 0, QTableWidgetItem("ted"))
    table.setItem(0, 1, QTableWidgetItem("Ted"))
    table.setItem(0, 2, QTableWidgetItem("Ted"))
    table.setItem(0, 3, QTableWidgetItem("Ted"))

    table.setItem(1, 0, QTableWidgetItem("theodore"))
    table.setItem(1, 1, QTableWidgetItem("Theodore"))
    table.setItem(1, 2, QTableWidgetItem("Ted"))  # Collision alias EN
    table.setItem(1, 3, QTableWidgetItem("Théodore"))

    warnings: list[str] = []

    def _fake_warning(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        warnings.append(text)
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_personnages.QMessageBox.warning", _fake_warning)

    win.personnages_tab._save()
    assert any("Catalogue personnages invalide" in w for w in warnings)
    assert store.load_character_names() == []


def test_preparer_segment_uses_saved_segmentation_options(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None

    store.set_episode_segmentation_options(
        "S01E01",
        "transcript",
        {
            "merge_if_prev_ends_with_marker": False,
            "attach_unmarked_to_previous": False,
        },
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.preparer_tab.text_editor.setPlainText("Hello...\nthere")

    win.preparer_tab._segment_to_utterances()
    assert win.preparer_tab.utterance_table.rowCount() == 2
    win.preparer_tab._set_dirty(False)


def test_preparer_default_segmentation_does_not_treat_lesson_one_as_speaker(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.preparer_tab.text_editor.setPlainText("Lesson one: Always suit up.\nTED: Right.")

    win.preparer_tab._segment_to_utterances()
    assert win.preparer_tab.utterance_table.rowCount() == 2
    first_speaker = win.preparer_tab.utterance_table.item(0, 1)
    first_text = win.preparer_tab.utterance_table.item(0, 2)
    second_speaker = win.preparer_tab.utterance_table.item(1, 1)
    assert first_speaker is not None
    assert first_text is not None
    assert second_speaker is not None
    assert first_speaker.text() == ""
    assert first_text.text() == "Lesson one: Always suit up."
    assert second_speaker.text() == "TED"
    win.preparer_tab._set_dirty(False)


def test_preparer_merge_selected_utterances_with_user_separator(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hello",
                speaker_explicit="TED",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=1,
                start_char=3,
                end_char=8,
                text="there",
                speaker_explicit="TED",
            ),
        ],
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")

    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.preparer_edit.QInputDialog.getItem",
        lambda *args, **kwargs: ("Espace", True),
    )
    table = win.preparer_tab.utterance_table
    table.setSelectionMode(table.SelectionMode.MultiSelection)
    table.selectRow(0)
    table.selectRow(1)
    win.preparer_tab._merge_selected_utterances()

    assert table.rowCount() == 1
    merged_item = table.item(0, 2)
    assert merged_item is not None
    assert merged_item.text() == "Hello there"
    win.preparer_tab._set_dirty(False)


def test_preparer_split_selected_utterance_uses_cursor_position(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=11,
                text="Hello world",
                speaker_explicit="TED",
            )
        ],
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")

    table = win.preparer_tab.utterance_table
    table.setCurrentCell(0, 2)
    fake_editor = QLineEdit()
    fake_editor.setText("Hello world")
    fake_editor.setCursorPosition(5)
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.preparer_edit.QApplication.focusWidget",
        lambda: fake_editor,
    )
    win.preparer_tab._split_selected_utterance_at_cursor()

    assert table.rowCount() == 2
    first = table.item(0, 2)
    second = table.item(1, 2)
    assert first is not None and second is not None
    assert first.text() == "Hello"
    assert second.text() == "world"
    win.preparer_tab._set_dirty(False)


def test_preparer_renumber_utterances_updates_number_column_and_supports_undo(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=7,
                start_char=0,
                end_char=2,
                text="A",
                speaker_explicit="TED",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=9,
                start_char=3,
                end_char=5,
                text="B",
                speaker_explicit="ROBIN",
            ),
        ],
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")

    table = win.preparer_tab.utterance_table
    first_before = table.item(0, 0)
    second_before = table.item(1, 0)
    assert first_before is not None and second_before is not None
    assert first_before.text() == "7"
    assert second_before.text() == "9"

    win.preparer_tab._renumber_utterances()
    first_after = table.item(0, 0)
    second_after = table.item(1, 0)
    assert first_after is not None and second_after is not None
    assert first_after.text() == "0"
    assert second_after.text() == "1"
    assert win.preparer_tab.has_unsaved_changes()

    assert win.undo_stack is not None
    win.undo_stack.undo()
    first_undo = table.item(0, 0)
    second_undo = table.item(1, 0)
    assert first_undo is not None and second_undo is not None
    assert first_undo.text() == "7"
    assert second_undo.text() == "9"

    win.undo_stack.redo()
    first_redo = table.item(0, 0)
    second_redo = table.item(1, 0)
    assert first_redo is not None and second_redo is not None
    assert first_redo.text() == "0"
    assert second_redo.text() == "1"
    win.preparer_tab._set_dirty(False)


def test_preparer_group_utterances_by_assignments_tolerant_mode(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None
    store.save_character_names(
        [
            {"id": "ted", "canonical": "TED", "names_by_lang": {"en": "Ted"}},
            {"id": "robin", "canonical": "ROBIN", "names_by_lang": {"en": "Robin"}},
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=1,
                text="A",
                speaker_explicit="Ted",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=1,
                start_char=2,
                end_char=3,
                text="B",
                speaker_explicit="",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=2,
                start_char=4,
                end_char=5,
                text="C",
                speaker_explicit="Ted",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=3,
                start_char=6,
                end_char=7,
                text="D",
                speaker_explicit="Robin",
            ),
        ],
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")

    win.preparer_tab._group_utterances_by_assignments()
    assert win.preparer_tab.utterance_table.rowCount() == 2
    first_text = win.preparer_tab.utterance_table.item(0, 2)
    second_text = win.preparer_tab.utterance_table.item(1, 2)
    assert first_text is not None and second_text is not None
    assert first_text.text() == "A\nB\nC"
    assert second_text.text() == "D"
    win.preparer_tab._set_dirty(False)


def test_preparer_group_utterances_uses_segment_assignments_when_labels_do_not_match(
    main_window_with_project: MainWindow,
) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None
    store.save_character_names(
        [
            {"id": "ted", "canonical": "TED", "names_by_lang": {"en": "Ted"}},
            {"id": "robin", "canonical": "ROBIN", "names_by_lang": {"en": "Robin"}},
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=1,
                text="A",
                speaker_explicit="L1 TED",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=1,
                start_char=2,
                end_char=3,
                text="B",
                speaker_explicit="L2 TED",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=2,
                start_char=4,
                end_char=5,
                text="C",
                speaker_explicit="L3 ROBIN",
            ),
        ],
    )
    store.save_character_assignments(
        [
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:utterance:0",
                "character_id": "ted",
            },
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:utterance:1",
                "character_id": "ted",
            },
            {
                "episode_id": "S01E01",
                "source_type": "segment",
                "source_id": "S01E01:utterance:2",
                "character_id": "robin",
            },
        ]
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")

    win.preparer_tab._group_utterances_by_assignments()
    assert win.preparer_tab.utterance_table.rowCount() == 2
    first_text = win.preparer_tab.utterance_table.item(0, 2)
    second_text = win.preparer_tab.utterance_table.item(1, 2)
    assert first_text is not None and second_text is not None
    assert first_text.text() == "A\nB"
    assert second_text.text() == "C"
    win.preparer_tab._set_dirty(False)


def test_preparer_save_transcript_structural_edits_replace_segments(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None
    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "TED",
                "names_by_lang": {"en": "Ted"},
            }
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=1,
                text="A",
                speaker_explicit="TED",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=1,
                start_char=2,
                end_char=3,
                text="B",
                speaker_explicit="TED",
            ),
        ],
    )
    db.create_align_run("run-struct", "S01E01", "en")
    db.upsert_align_links(
        "run-struct",
        "S01E01",
        [
            {
                "segment_id": "S01E01:utterance:0",
                "cue_id": None,
                "cue_id_target": None,
                "lang": "fr",
                "role": "target",
                "confidence": 0.7,
                "status": "auto",
            }
        ],
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    table = win.preparer_tab.utterance_table
    # Confirmation point critique (suppression runs alignement) -> continuer.
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.preparer_save.QMessageBox.question",
        lambda *args, **kwargs: QMessageBox.StandardButton.Yes,
    )

    table.selectRow(1)
    win.preparer_tab._delete_selected_utterance_rows()
    table.setCurrentCell(0, 2)
    win.preparer_tab._add_utterance_row_below()
    win.preparer_tab._apply_table_cell_value(table, 1, 1, "TED")
    win.preparer_tab._apply_table_cell_value(table, 1, 2, "C")
    win.preparer_tab.text_editor.setPlainText("A\nC")

    assert win.preparer_tab.save_current() is True
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert [s["segment_id"] for s in segs] == ["S01E01:utterance:0", "S01E01:utterance:1"]
    assert [s["text"] for s in segs] == ["A", "C"]
    assert int(segs[1]["start_char"]) > int(segs[0]["start_char"])
    assert db.get_align_runs_for_episode("S01E01") == []


def test_preparer_save_structural_warns_and_can_cancel_run_invalidation(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None
    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "TED",
                "names_by_lang": {"en": "Ted"},
            }
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=1,
                text="A",
                speaker_explicit="TED",
            ),
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=1,
                start_char=2,
                end_char=3,
                text="B",
                speaker_explicit="TED",
            ),
        ],
    )
    db.create_align_run("run-cancel", "S01E01", "en")
    db.upsert_align_links(
        "run-cancel",
        "S01E01",
        [
            {
                "segment_id": "S01E01:utterance:0",
                "cue_id": None,
                "cue_id_target": None,
                "lang": "fr",
                "role": "target",
                "confidence": 0.7,
                "status": "auto",
            }
        ],
    )
    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    table = win.preparer_tab.utterance_table
    table.selectRow(1)
    win.preparer_tab._delete_selected_utterance_rows()

    questions: list[str] = []
    criticals: list[str] = []

    def _fake_question(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        questions.append(text)
        return QMessageBox.StandardButton.No

    def _fake_critical(*args, **kwargs):
        text = str(args[2]) if len(args) >= 3 else str(kwargs.get("text", ""))
        criticals.append(text)
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.preparer_save.QMessageBox.question", _fake_question)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox.critical", _fake_critical)

    assert win.preparer_tab.save_current() is False
    assert any("Point critique" in q for q in questions)
    assert criticals == []
    assert any(r.get("align_run_id") == "run-cancel" for r in db.get_align_runs_for_episode("S01E01"))
    win.preparer_tab._set_dirty(False)


def test_preparer_save_transcript_non_structural_keeps_align_runs(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None

    store.save_character_names(
        [
            {
                "id": "ted",
                "canonical": "TED",
                "names_by_lang": {"en": "Ted"},
            }
        ]
    )
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="TED",
            )
        ],
    )
    db.create_align_run("run-keep", "S01E01", "en")
    db.upsert_align_links(
        "run-keep",
        "S01E01",
        [
            {
                "segment_id": "S01E01:utterance:0",
                "cue_id": None,
                "cue_id_target": None,
                "lang": "fr",
                "role": "target",
                "confidence": 0.8,
                "status": "auto",
            }
        ],
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.preparer_tab._apply_table_cell_value(win.preparer_tab.utterance_table, 0, 2, "Hello")
    assert win.preparer_tab.save_current() is True

    runs = db.get_align_runs_for_episode("S01E01")
    assert any(r.get("align_run_id") == "run-keep" for r in runs)
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs[0]["text"] == "Hello"
    win.preparer_tab._set_dirty(False)


def test_preparer_save_transcript_can_persist_zero_utterance_rows(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="",
            )
        ],
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    table = win.preparer_tab.utterance_table
    table.selectRow(0)
    win.preparer_tab._delete_selected_utterance_rows()
    assert table.rowCount() == 0
    assert win.preparer_tab.stack.currentWidget() == win.preparer_tab.utterance_table

    assert win.preparer_tab.save_current() is True
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs == []


def test_preparer_reset_utterances_to_text_and_save_clears_segments(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None
    db.upsert_segments(
        "S01E01",
        "utterance",
        [
            Segment(
                episode_id="S01E01",
                kind="utterance",
                n=0,
                start_char=0,
                end_char=2,
                text="Hi",
                speaker_explicit="TED",
            )
        ],
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    assert win.preparer_tab.utterance_table.rowCount() == 1

    win.preparer_tab._reset_utterances_to_text()
    assert win.preparer_tab.utterance_table.rowCount() == 0
    assert win.preparer_tab.stack.currentWidget() == win.preparer_tab.text_editor

    assert win.preparer_tab.save_current() is True
    segs = db.get_segments_for_episode("S01E01", kind="utterance")
    assert segs == []


def test_refresh_tabs_after_job_updates_personnages_runs(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    db = win._db
    assert db is not None

    win.personnages_tab.refresh()
    assert win.personnages_tab.personnages_run_combo.count() == 0

    db.create_align_run("run-after-job", "S01E01", "en")
    win._refresh_tabs_after_job()

    run_ids = {
        win.personnages_tab.personnages_run_combo.itemData(i)
        for i in range(win.personnages_tab.personnages_run_combo.count())
    }
    assert "run-after-job" in run_ids


def test_preparer_discard_reloads_persisted_context(
    main_window_with_project: MainWindow,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None
    store.save_episode_clean(
        "S01E01",
        "Persisted clean",
        TransformStats(raw_lines=1, clean_lines=1, merges=0, kept_breaks=0, duration_ms=0),
        {"source": "test"},
    )

    win._refresh_preparer(force=True)
    win.open_preparer_for_episode("S01E01", source="transcript")
    win.preparer_tab.text_editor.setPlainText("DRAFT NOT SAVED")
    assert win.preparer_tab.has_unsaved_changes()

    class _FakeMessageBox:
        class Icon:
            Warning = object()

        class ButtonRole:
            AcceptRole = object()
            DestructiveRole = object()
            RejectRole = object()

        def __init__(self, *args, **kwargs):
            self._discard_button = None
            self._clicked_button = None

        def setIcon(self, *args, **kwargs):
            return None

        def setWindowTitle(self, *args, **kwargs):
            return None

        def setText(self, *args, **kwargs):
            return None

        def setInformativeText(self, *args, **kwargs):
            return None

        def addButton(self, _label, role):
            button = object()
            if role is self.ButtonRole.DestructiveRole:
                self._discard_button = button
            return button

        def setDefaultButton(self, *args, **kwargs):
            return None

        def exec(self):
            self._clicked_button = self._discard_button

        def clickedButton(self):
            return self._clicked_button

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_preparer.QMessageBox", _FakeMessageBox)
    assert win.preparer_tab.prompt_save_if_dirty() is True
    assert not win.preparer_tab.has_unsaved_changes()
    assert win.preparer_tab.text_editor.toPlainText() == "Persisted clean"


def test_preparer_source_combo_includes_project_languages(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    db = win._db
    assert store is not None
    assert db is not None

    store.save_project_languages(["en", "fr", "es"])
    db.add_track("S01E01:es", "S01E01", "es", "srt")
    db.upsert_cues(
        "S01E01:es",
        "S01E01",
        "es",
        [
            Cue(
                episode_id="S01E01",
                lang="es",
                n=0,
                start_ms=1000,
                end_ms=1800,
                text_raw="Hola",
                text_clean="Hola",
            )
        ],
    )

    win._refresh_preparer(force=True)
    source_keys = {win.preparer_tab.prep_source_combo.itemData(i) for i in range(win.preparer_tab.prep_source_combo.count())}
    assert "srt_es" in source_keys

    win.open_preparer_for_episode("S01E01", source="srt_es")
    assert win.preparer_tab.prep_source_combo.currentData() == "srt_es"
    assert win.preparer_tab.cue_table.rowCount() == 1


def test_refresh_language_combos_updates_multilang_tabs(main_window_with_project: MainWindow) -> None:
    win = main_window_with_project
    store = win._store
    assert store is not None

    store.save_project_languages(["en", "fr", "es"])
    win._refresh_language_combos()

    subs_langs = {
        win.inspector_tab.subtitles_tab.subs_lang_combo.itemText(i)
        for i in range(win.inspector_tab.subtitles_tab.subs_lang_combo.count())
    }
    assert "es" in subs_langs

    prep_source_keys = {
        win.preparer_tab.prep_source_combo.itemData(i)
        for i in range(win.preparer_tab.prep_source_combo.count())
    }
    assert "srt_es" in prep_source_keys

    personnages_source_keys = {
        win.personnages_tab.personnages_source_combo.itemData(i)
        for i in range(win.personnages_tab.personnages_source_combo.count())
    }
    assert "cues_es" in personnages_source_keys

    align_pivot_langs = {
        win.alignment_tab.align_pivot_lang_combo.itemData(i)
        for i in range(win.alignment_tab.align_pivot_lang_combo.count())
    }
    assert "es" in align_pivot_langs
