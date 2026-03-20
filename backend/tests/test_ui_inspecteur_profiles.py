"""Tests UI ciblés sur Inspecteur et dialogue Profils (cas complexes)."""

from __future__ import annotations

import os

import pytest
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QComboBox, QDialog, QMessageBox

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.dialogs.profiles import ProfilesDialog
from howimetyourcorpus.app.tabs.tab_inspecteur import InspectorTabWidget
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex
from howimetyourcorpus.core.normalize.profiles import NormalizationProfile


class _FakeConfig:
    normalize_profile = "conservative_v1"


class _FakeStore:
    def __init__(self) -> None:
        self._index = SeriesIndex(
            series_title="HIMYM",
            series_url="https://example.test",
            episodes=[
                EpisodeRef(
                    episode_id="S01E01",
                    season=1,
                    episode=1,
                    title="Pilot",
                    url="https://example.test/S01E01",
                    source_id="subslikescript",
                ),
                EpisodeRef(
                    episode_id="S01E02",
                    season=1,
                    episode=2,
                    title="Purple Giraffe",
                    url="https://example.test/S01E02",
                    source_id="subslikescript",
                ),
                EpisodeRef(
                    episode_id="S01E03",
                    season=1,
                    episode=3,
                    title="Sweet Taste Of Liberty",
                    url="https://example.test/S01E03",
                    source_id="unknown_source",
                ),
            ],
        )
        self._notes = {
            "S01E01": "note pilot",
            "S01E02": "note ep2",
            "S01E03": "note ep3",
        }
        self._raw = {
            "S01E01": "raw one",
            "S01E02": "raw two",
            "S01E03": "raw three",
        }
        self._clean = {
            "S01E01": "alpha beta gamma delta",
            "S01E02": "lorem ipsum dolor sit amet",
            "S01E03": "text for third episode",
        }
        self._meta = {
            "S01E01": {
                "raw_lines": 12,
                "clean_lines": 10,
                "merges": 2,
                "debug": {"merge_examples": [{"before": "A", "after": "B"}]},
            }
        }
        self._preferred_profiles = {"S01E01": "aggressive_v1"}
        self._source_defaults = {"subslikescript": "default_fr_v1"}
        self.saved_notes: list[tuple[str, str]] = []
        self.saved_custom_profiles: list[dict[str, object]] | None = None
        self.saved_source_defaults: dict[str, str] | None = None

    def load_series_index(self) -> SeriesIndex:
        return self._index

    def load_episode_notes(self, episode_id: str) -> str:
        return self._notes.get(episode_id, "")

    def save_episode_notes(self, episode_id: str, text: str) -> None:
        self.saved_notes.append((episode_id, text))
        self._notes[episode_id] = text

    def load_episode_text(self, episode_id: str, kind: str = "raw") -> str:
        if kind == "clean":
            return self._clean.get(episode_id, "")
        return self._raw.get(episode_id, "")

    def load_episode_transform_meta(self, episode_id: str):
        return self._meta.get(episode_id)

    def load_episode_preferred_profiles(self) -> dict[str, str]:
        return dict(self._preferred_profiles)

    def save_episode_preferred_profiles(self, preferred: dict[str, str]) -> None:
        self._preferred_profiles = dict(preferred)

    def load_source_profile_defaults(self) -> dict[str, str]:
        return dict(self._source_defaults)

    def has_episode_raw(self, episode_id: str) -> bool:
        return episode_id in self._raw

    def has_episode_clean(self, episode_id: str) -> bool:
        return episode_id in self._clean

    def load_custom_profiles(self) -> dict[str, NormalizationProfile]:
        return {
            "custom_fr": NormalizationProfile(
                id="custom_fr",
                merge_subtitle_breaks=True,
                fix_french_punctuation=True,
            )
        }

    def save_custom_profiles(self, profiles):
        self.saved_custom_profiles = list(profiles)

    def save_source_profile_defaults(self, defaults: dict[str, str]) -> None:
        self.saved_source_defaults = dict(defaults)


class _FakeDb:
    def __init__(self) -> None:
        self._segments = {
            "S01E01": [
                {
                    "kind": "sentence",
                    "n": 1,
                    "speaker_explicit": "Ted",
                    "text": "One short line",
                    "start_char": 0,
                    "end_char": 3,
                },
                {
                    "kind": "utterance",
                    "n": 2,
                    "speaker_explicit": "Robin",
                    "text": "Another longer line used for inspecteur tests",
                    "start_char": 4,
                    "end_char": 12,
                },
                {
                    "kind": "sentence",
                    "n": 3,
                    "speaker_explicit": "",
                    "text": "No speaker line",
                    "start_char": 13,
                    "end_char": 20,
                },
            ]
        }

    def get_segments_for_episode(self, episode_id: str, kind: str | None = None):
        rows = list(self._segments.get(episode_id, []))
        if kind:
            rows = [row for row in rows if row.get("kind") == kind]
        return rows


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


@pytest.fixture
def fake_store() -> _FakeStore:
    return _FakeStore()


@pytest.fixture
def fake_db() -> _FakeDb:
    return _FakeDb()


def test_inspector_goto_segment_selects_and_reports_errors(
    qapp: QApplication,  # noqa: ARG001
    fake_store: _FakeStore,
    fake_db: _FakeDb,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tab = InspectorTabWidget(
        get_store=lambda: fake_store,
        get_db=lambda: fake_db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _steps: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    tab.refresh()
    tab.inspect_view_combo.setCurrentIndex(tab.inspect_view_combo.findData("segments"))

    warnings: list[tuple[str, str]] = []
    infos: list[tuple[str, str]] = []

    def _warning(_parent, title: str, message: str):
        warnings.append((title, message))
        return QMessageBox.StandardButton.Ok

    def _info(_parent, title: str, message: str):
        infos.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_inspecteur.QMessageBox.warning", _warning)
    monkeypatch.setattr("howimetyourcorpus.app.tabs.tab_inspecteur.QMessageBox.information", _info)

    tab.segment_goto_edit.setText("2")
    tab._goto_segment()

    selected = tab.inspect_segments_list.currentItem()
    assert selected is not None
    payload = selected.data(Qt.ItemDataRole.UserRole)
    assert payload["n"] == 2
    assert tab.segment_goto_edit.text() == ""

    tab.segment_goto_edit.setText("nope")
    tab._goto_segment()
    assert warnings and "numéro de segment valide" in warnings[-1][1]

    tab.segment_goto_edit.setText("999")
    tab._goto_segment()
    assert infos and "introuvable" in infos[-1][1]


def test_inspector_profile_priority_episode_source_config(
    qapp: QApplication,  # noqa: ARG001
    fake_store: _FakeStore,
    fake_db: _FakeDb,
) -> None:
    tab = InspectorTabWidget(
        get_store=lambda: fake_store,
        get_db=lambda: fake_db,
        get_config=lambda: _FakeConfig(),
        run_job=lambda _steps: None,
        show_status=lambda _msg, _timeout=3000: None,
    )
    tab.refresh()

    # S01E01 : profil préféré épisode
    assert tab.inspect_profile_combo.currentText() == "aggressive_v1"

    # S01E02 : fallback profil par source
    tab.set_episode_and_load("S01E02")
    assert tab.inspect_profile_combo.currentText() == "default_fr_v1"

    # S01E03 : fallback config projet
    tab.set_episode_and_load("S01E03")
    assert tab.inspect_profile_combo.currentText() == "conservative_v1"


def test_profiles_dialog_enables_custom_actions_only_for_custom_items(
    qapp: QApplication,  # noqa: ARG001
    fake_store: _FakeStore,
) -> None:
    dialog = ProfilesDialog(parent=None, store=fake_store)

    builtin_row = -1
    custom_row = -1
    for row in range(dialog.list_widget.count()):
        item = dialog.list_widget.item(row)
        kind, _pid = item.data(Qt.ItemDataRole.UserRole)
        if kind == "builtin" and builtin_row < 0:
            builtin_row = row
        if kind == "custom" and custom_row < 0:
            custom_row = row

    assert builtin_row >= 0
    assert custom_row >= 0

    dialog.list_widget.setCurrentRow(builtin_row)
    dialog._on_selection_changed()
    assert dialog.edit_btn.isEnabled() is False
    assert dialog.delete_btn.isEnabled() is False

    dialog.list_widget.setCurrentRow(custom_row)
    dialog._on_selection_changed()
    assert dialog.edit_btn.isEnabled() is True
    assert dialog.delete_btn.isEnabled() is True


def test_profiles_dialog_new_profile_rejects_duplicate_id(
    qapp: QApplication,  # noqa: ARG001
    fake_store: _FakeStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dialog = ProfilesDialog(parent=None, store=fake_store)

    class _DuplicateEditor:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def exec(self) -> int:
            return QDialog.DialogCode.Accepted

        def get_profile_data(self) -> dict[str, object]:
            return {
                "id": "default_en_v1",  # existe déjà côté builtin
                "merge_subtitle_breaks": True,
            }

    warnings: list[tuple[str, str]] = []

    def _warning(_parent, title: str, message: str):
        warnings.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.dialogs.profiles.ProfileEditorDialog", _DuplicateEditor)
    monkeypatch.setattr("howimetyourcorpus.app.dialogs.profiles.QMessageBox.warning", _warning)

    dialog._new_profile()

    assert warnings == [("Profil", "Cet id existe déjà.")]
    assert fake_store.saved_custom_profiles is None


def test_profiles_dialog_save_source_defaults_from_table(
    qapp: QApplication,  # noqa: ARG001
    fake_store: _FakeStore,
) -> None:
    dialog = ProfilesDialog(parent=None, store=fake_store)
    dialog.source_profile_table.setRowCount(0)
    dialog._add_source_profile_row()

    src_combo = dialog.source_profile_table.cellWidget(0, 0)
    prof_combo = dialog.source_profile_table.cellWidget(0, 1)
    assert isinstance(src_combo, QComboBox)
    assert isinstance(prof_combo, QComboBox)

    src_combo.setCurrentText("subslikescript")
    prof_combo.setCurrentText("default_fr_v1")

    dialog._save_source_profile_defaults()

    assert fake_store.saved_source_defaults == {"subslikescript": "default_fr_v1"}
