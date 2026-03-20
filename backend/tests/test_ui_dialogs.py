"""Tests UI ciblés pour les dialogues (validations et extraction des options)."""

from __future__ import annotations

import os

import pytest
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QComboBox, QMessageBox

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.dialogs.normalize_options import NormalizeOptionsDialog
from howimetyourcorpus.app.dialogs.opensubtitles_download import OpenSubtitlesDownloadDialog
from howimetyourcorpus.app.dialogs.search_replace import SearchReplaceDialog
from howimetyourcorpus.app.dialogs.segmentation_options import SegmentationOptionsDialog
from howimetyourcorpus.app.dialogs.subtitle_batch_import import SubtitleBatchImportDialog


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_normalize_options_dialog_returns_selected_values(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    dialog = NormalizeOptionsDialog(default_profile_id="default_en_v1")
    dialog.profile_combo.setCurrentText("default_en_v1")
    dialog.merge_subtitle_breaks_cb.setChecked(True)
    dialog.fix_double_spaces_cb.setChecked(True)
    dialog.fix_french_punctuation_cb.setChecked(False)
    dialog.normalize_apostrophes_cb.setChecked(True)
    dialog.normalize_quotes_cb.setChecked(True)
    dialog.strip_line_spaces_cb.setChecked(True)
    dialog.max_merge_examples_spin.setValue(17)
    idx = dialog.case_combo.findData("lowercase")
    assert idx >= 0
    dialog.case_combo.setCurrentIndex(idx)

    got = dialog.get_options()
    assert got["profile_id"] == "default_en_v1"
    assert got["merge_subtitle_breaks"] is True
    assert got["fix_double_spaces"] is True
    assert got["fix_french_punctuation"] is False
    assert got["normalize_apostrophes"] is True
    assert got["normalize_quotes"] is True
    assert got["strip_line_spaces"] is True
    assert got["max_merge_examples_in_debug"] == 17
    assert got["case_transform"] == "lowercase"


def test_search_replace_dialog_get_params_defaults(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    dialog = SearchReplaceDialog()
    assert dialog.get_params() == ("", "", False, False)


def test_search_replace_dialog_get_params_with_values(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    dialog = SearchReplaceDialog()
    dialog.find_edit.setText("hello")
    dialog.replace_edit.setText("world")
    dialog.case_sensitive_cb.setChecked(True)
    dialog.regex_cb.setChecked(True)

    assert dialog.get_params() == ("hello", "world", True, True)


def test_segmentation_options_dialog_warns_on_invalid_regex(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dialog = SegmentationOptionsDialog()
    dialog.speaker_regex_edit.setText("[")
    warnings: list[tuple[str, str]] = []

    def _warning(_parent, title: str, message: str):
        warnings.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.dialogs.segmentation_options.QMessageBox.warning", _warning)
    dialog._accept_with_validation()

    assert warnings
    assert warnings[0][0] == "Paramètres segmentation"
    assert "Regex locuteur invalide" in warnings[0][1]
    assert dialog.result() == 0


def test_segmentation_options_dialog_normalizes_markers_and_accepts(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    dialog = SegmentationOptionsDialog(
        initial_options={
            "speaker_regex": r"^(.+):\s*(.*)$",
            "enable_dash_rule": True,
            "dash_regex": r"^-\s*(.*)$",
            "continuation_markers": "..., …, ///",
            "merge_if_prev_ends_with_marker": False,
            "attach_unmarked_to_previous": True,
        }
    )
    options = dialog.get_options()
    assert options["speaker_regex"] == r"^(.+):\s*(.*)$"
    assert options["dash_regex"] == r"^-\s*(.*)$"
    assert options["continuation_markers"] == ["...", "…", "///"]
    assert options["merge_if_prev_ends_with_marker"] is False
    assert options["attach_unmarked_to_previous"] is True

    dialog._accept_with_validation()
    assert dialog.result() == 1


def test_subtitle_batch_import_dialog_warns_without_valid_selection(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dialog = SubtitleBatchImportDialog(
        parent=None,
        episode_ids=["S01E01"],
        rows=[("/tmp/S01E01.en.srt", None, "en")],
        languages=["en", "fr"],
    )
    warnings: list[tuple[str, str]] = []

    def _warning(_parent, title: str, message: str):
        warnings.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.dialogs.subtitle_batch_import.QMessageBox.warning", _warning)
    dialog._accept()

    assert warnings == [("Import", "Indiquez au moins un fichier avec épisode et langue.")]
    assert dialog.result == []


def test_subtitle_batch_import_dialog_collects_valid_rows(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    dialog = SubtitleBatchImportDialog(
        parent=None,
        episode_ids=["S01E01", "S01E02"],
        rows=[("/tmp/S01E01.en.srt", "S01E01", "en")],
        languages=["en", "fr"],
    )
    combo_ep = dialog.table.cellWidget(0, 1)
    combo_lang = dialog.table.cellWidget(0, 2)
    assert isinstance(combo_ep, QComboBox)
    assert isinstance(combo_lang, QComboBox)
    combo_ep.setCurrentText("S01E01")
    combo_lang.setCurrentText("en")

    dialog._accept()

    assert dialog.result == [("/tmp/S01E01.en.srt", "S01E01", "en")]


def _build_opensubtitles_dialog() -> OpenSubtitlesDownloadDialog:
    return OpenSubtitlesDownloadDialog(
        parent=None,
        episode_refs=[("S01E01", 1, 1), ("S01E02", 1, 2)],
        languages=["en", "fr"],
    )


@pytest.mark.parametrize(
    ("api_key", "imdb_id", "select_item", "expected_message"),
    [
        ("", "tt0460649", True, "Indiquez la clé API OpenSubtitles."),
        ("key123", "", True, "Indiquez l'IMDb ID de la série."),
        ("key123", "tt0460649", False, "Sélectionnez au moins un épisode."),
    ],
)
def test_opensubtitles_dialog_validates_required_fields(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    api_key: str,
    imdb_id: str,
    select_item: bool,
    expected_message: str,
) -> None:
    dialog = _build_opensubtitles_dialog()
    dialog.api_key_edit.setText(api_key)
    dialog.imdb_edit.setText(imdb_id)
    if select_item:
        dialog.episode_list.item(0).setSelected(True)

    warnings: list[tuple[str, str]] = []

    def _warning(_parent, title: str, message: str):
        warnings.append((title, message))
        return QMessageBox.StandardButton.Ok

    monkeypatch.setattr("howimetyourcorpus.app.dialogs.opensubtitles_download.QMessageBox.warning", _warning)
    dialog._accept()

    assert warnings == [("OpenSubtitles", expected_message)]
    assert dialog.result is None


def test_opensubtitles_dialog_select_all_and_accepts(
    qapp: QApplication,  # noqa: ARG001
) -> None:
    dialog = _build_opensubtitles_dialog()
    dialog.api_key_edit.setText("key123")
    dialog.imdb_edit.setText("tt0460649")
    dialog.lang_combo.setCurrentText("fr")

    dialog._on_select_all(Qt.CheckState.Checked.value)
    dialog._accept()

    assert dialog.result is not None
    api_key, imdb_id, lang, selected = dialog.result
    assert api_key == "key123"
    assert imdb_id == "tt0460649"
    assert lang == "fr"
    assert selected == [("S01E01", 1, 1), ("S01E02", 1, 2)]
