"""Tests unitaires des workers UI (JobRunner / _PipelineWorker)."""

from __future__ import annotations

import os

import pytest
from PySide6.QtWidgets import QApplication

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from howimetyourcorpus.app.workers import JobRunner, _PipelineWorker  # noqa: E402


@pytest.fixture
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


class _RunnerOk:
    def run(self, steps, context, *, force=False, on_progress=None, on_log=None, on_error=None, on_cancelled=None):
        if on_progress:
            on_progress("step", 0.5, "half")
        if on_log:
            on_log("info", "ok")
        return ["ok"]


class _RunnerBoom:
    def run(self, steps, context, *, force=False, on_progress=None, on_log=None, on_error=None, on_cancelled=None):
        raise RuntimeError("boom")


def test_pipeline_worker_success_emits_finished(qapp: QApplication) -> None:
    worker = _PipelineWorker(_RunnerOk(), steps=[], context={}, force=False)
    finished: list[list] = []
    errors: list[tuple[str, object]] = []
    worker.finished.connect(lambda results: finished.append(results))
    worker.error.connect(lambda step, exc: errors.append((step, exc)))

    worker.run()

    assert errors == []
    assert finished == [["ok"]]


def test_pipeline_worker_error_emits_error_and_empty_finished(qapp: QApplication) -> None:
    worker = _PipelineWorker(_RunnerBoom(), steps=[], context={}, force=False)
    finished: list[list] = []
    errors: list[tuple[str, object]] = []
    worker.finished.connect(lambda results: finished.append(results))
    worker.error.connect(lambda step, exc: errors.append((step, exc)))

    worker.run()

    assert len(errors) == 1
    assert errors[0][0] == "worker"
    assert isinstance(errors[0][1], RuntimeError)
    assert finished == [[]]


def test_job_runner_cancel_calls_runner_cancel(qapp: QApplication) -> None:
    called = {"cancelled": False}

    class _CancelableRunner:
        def cancel(self):
            called["cancelled"] = True

    job = JobRunner([], context={}, show_progress_dialog=False)
    job._runner = _CancelableRunner()
    job.cancel()

    assert called["cancelled"] is True


def test_job_runner_on_progress_emits_signal(qapp: QApplication) -> None:
    job = JobRunner([], context={}, show_progress_dialog=False)
    emitted: list[tuple[str, float, str]] = []
    job.progress.connect(lambda step, pct, msg: emitted.append((step, pct, msg)))

    job._on_progress("step_a", 0.25, "running")
    assert emitted == [("step_a", 0.25, "running")]
