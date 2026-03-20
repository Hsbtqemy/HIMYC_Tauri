"""Tests UI cibles pour le controleur des sources Corpus."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from PySide6.QtWidgets import QApplication, QMessageBox

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.tabs.corpus_sources import CorpusSourcesController
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex
from howimetyourcorpus.core.pipeline.tasks import ImportSubtitlesStep


class _FakeStore:
    def __init__(self, index: SeriesIndex | None = None, languages: list[str] | None = None) -> None:
        self._index = index or SeriesIndex(series_title="Test", series_url="https://example.invalid", episodes=[])
        self._languages = list(languages or ["en", "fr"])
        self.saved_indexes: list[SeriesIndex] = []

    def load_series_index(self) -> SeriesIndex:
        return self._index

    def save_series_index(self, index: SeriesIndex) -> None:
        self._index = index
        self.saved_indexes.append(index)

    def load_project_languages(self) -> list[str]:
        return list(self._languages)


class _FakeTab:
    def __init__(self, store: _FakeStore) -> None:
        self._store = store
        self.jobs: list[list[Any]] = []
        self.statuses: list[tuple[str, int]] = []
        self.refresh_calls = 0
        self.refresh_after_calls = 0

    def _get_store(self) -> _FakeStore:
        return self._store

    def _run_job(self, steps: list[Any]) -> None:
        self.jobs.append(list(steps))

    def _show_status(self, message: str, timeout_ms: int) -> None:
        self.statuses.append((message, timeout_ms))

    def refresh(self) -> None:
        self.refresh_calls += 1

    def _refresh_after_episodes_added(self) -> None:
        self.refresh_after_calls += 1


@pytest.fixture
def qapp() -> QApplication:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_detect_lang_from_stem() -> None:
    assert CorpusSourcesController._detect_lang_from_stem("S01E01.en") == "en"
    assert CorpusSourcesController._detect_lang_from_stem("S01E01_fr") == "fr"
    assert CorpusSourcesController._detect_lang_from_stem("S01E01-FR") == "fr"
    assert CorpusSourcesController._detect_lang_from_stem("S01E01") is None
    assert CorpusSourcesController._detect_lang_from_stem("S01E01.forced") is None


def test_detect_srt_files_extracts_episode_and_optional_lang(tmp_path: Path) -> None:
    (tmp_path / "S01E01.en.srt").write_text("", encoding="utf-8")
    (tmp_path / "nested").mkdir()
    (tmp_path / "nested" / "S01E02_fr.srt").write_text("", encoding="utf-8")
    (tmp_path / "nested" / "random.srt").write_text("", encoding="utf-8")

    detected = CorpusSourcesController._detect_srt_files(tmp_path)
    simplified = {(episode_id, lang, path.name) for episode_id, lang, path in detected}

    assert ("S01E01", "en", "S01E01.en.srt") in simplified
    assert ("S01E02", "fr", "S01E02_fr.srt") in simplified
    assert all(item[0] in {"S01E01", "S01E02"} for item in simplified)


def test_import_srt_batch_runs_pipeline_and_dedupes_episode_lang(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    (tmp_path / "S01E01.en.srt").write_text("", encoding="utf-8")
    (tmp_path / "S01E01.fr.srt").write_text("", encoding="utf-8")
    (tmp_path / "A_S01E02_fr.srt").write_text("", encoding="utf-8")
    (tmp_path / "B_S01E02-fr.srt").write_text("", encoding="utf-8")
    (tmp_path / "S01E03.srt").write_text("", encoding="utf-8")

    store = _FakeStore(
        index=SeriesIndex(
            series_title="Test",
            series_url="https://example.invalid",
            episodes=[
                EpisodeRef(
                    episode_id="S01E01",
                    season=1,
                    episode=1,
                    title="Pilot",
                    url="https://example.invalid/s01e01",
                )
            ],
        ),
        languages=["en", "fr"],
    )
    tab = _FakeTab(store)
    controller = CorpusSourcesController(tab)

    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QFileDialog.getExistingDirectory",
        lambda *_args, **_kwargs: str(tmp_path),
    )
    answers = [
        QMessageBox.StandardButton.Yes,  # confirm detected files
        QMessageBox.StandardButton.Yes,  # confirm missing lang fallback
    ]
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QMessageBox.question",
        lambda *_args, **_kwargs: answers.pop(0),
    )
    warnings: list[str] = []
    infos: list[str] = []
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QMessageBox.warning",
        lambda _parent, _title, message: warnings.append(message),
    )
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QMessageBox.information",
        lambda _parent, _title, message: infos.append(message),
    )

    controller.import_srt_batch()

    assert not answers
    assert warnings == []
    assert len(tab.jobs) == 1
    steps = tab.jobs[0]
    assert all(isinstance(step, ImportSubtitlesStep) for step in steps)

    pairs = {(step.episode_id, step.lang, Path(step.file_path).name) for step in steps}
    assert ("S01E01", "en", "S01E01.en.srt") in pairs
    assert ("S01E01", "fr", "S01E01.fr.srt") in pairs
    assert ("S01E02", "fr", "B_S01E02-fr.srt") in pairs
    assert ("S01E03", "en", "S01E03.srt") in pairs
    assert len(pairs) == 4

    assert len(store.saved_indexes) == 1
    saved_ids = {episode.episode_id for episode in store.saved_indexes[-1].episodes}
    assert saved_ids == {"S01E01", "S01E02", "S01E03"}

    assert tab.refresh_calls == 1
    assert tab.refresh_after_calls == 1
    assert tab.statuses and "Import batch lance" in tab.statuses[0][0]
    assert infos and "import(s) effectif(s)" in infos[0]


def test_import_srt_batch_cancels_cleanly_when_missing_lang_refused(
    qapp: QApplication,  # noqa: ARG001
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    (tmp_path / "S02E01.srt").write_text("", encoding="utf-8")

    store = _FakeStore()
    tab = _FakeTab(store)
    controller = CorpusSourcesController(tab)

    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QFileDialog.getExistingDirectory",
        lambda *_args, **_kwargs: str(tmp_path),
    )
    answers = [
        QMessageBox.StandardButton.Yes,  # confirm detected files
        QMessageBox.StandardButton.No,  # refuse missing lang fallback
    ]
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QMessageBox.question",
        lambda *_args, **_kwargs: answers.pop(0),
    )
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QMessageBox.information",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "howimetyourcorpus.app.tabs.corpus_sources.QMessageBox.warning",
        lambda *_args, **_kwargs: None,
    )

    controller.import_srt_batch()

    assert len(tab.jobs) == 0
    assert len(store.saved_indexes) == 0
    assert tab.refresh_calls == 0
    assert tab.refresh_after_calls == 0
