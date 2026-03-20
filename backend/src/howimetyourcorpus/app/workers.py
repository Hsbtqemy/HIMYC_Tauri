"""Workers pour exécuter le pipeline en arrière-plan (QThread) sans bloquer l'UI."""

from __future__ import annotations

import logging

from PySide6.QtCore import QObject, Signal, QThread, Qt
from PySide6.QtWidgets import QProgressDialog, QWidget

from howimetyourcorpus.core.pipeline.context import PipelineContext
from howimetyourcorpus.core.pipeline.runner import PipelineRunner
from howimetyourcorpus.core.pipeline.steps import Step

logger = logging.getLogger(__name__)


class JobRunner(QObject):
    """
    Exécute une liste d'étapes du pipeline dans un thread séparé.
    Émet progress, log, error, finished, cancelled.
    
    Phase 7 HP3 : Supporte QProgressDialog optionnel pour feedback visuel.
    """

    progress = Signal(str, float, str)   # step_name, percent, message
    log = Signal(str, str)                 # level, message
    error = Signal(str, object)           # step_name, exception
    finished = Signal(list)               # results
    cancelled = Signal()

    def __init__(
        self, 
        steps: list[Step], 
        context: PipelineContext, 
        force: bool = False,
        parent: QWidget | None = None,
        show_progress_dialog: bool = True
    ) -> None:
        super().__init__(parent)
        self.steps = steps
        self.context = context
        self.force = force
        self._runner = PipelineRunner()
        self._thread: QThread | None = None
        self._worker_obj: QObject | None = None
        self._progress_dialog: QProgressDialog | None = None
        self._show_progress_dialog = show_progress_dialog
        self._parent = parent

    def run_async(self) -> None:
        """Lance l'exécution dans un thread dédié (Phase 7 HP3 : avec QProgressDialog optionnel)."""
        # Créer QProgressDialog si demandé (Phase 7 HP3)
        if self._show_progress_dialog and self._parent:
            self._progress_dialog = QProgressDialog(
                "Opération en cours...",
                "Annuler",
                0, 100,
                self._parent
            )
            self._progress_dialog.setWindowTitle("Pipeline en cours")
            self._progress_dialog.setWindowModality(Qt.WindowModality.WindowModal)
            self._progress_dialog.setMinimumDuration(500)  # Afficher après 500ms
            self._progress_dialog.canceled.connect(self.cancel)
            self._progress_dialog.setAutoClose(True)
            self._progress_dialog.setAutoReset(True)
        
        self._thread = QThread()
        self._worker_obj = _PipelineWorker(
            self._runner,
            self.steps,
            self.context,
            self.force,
        )
        self._worker_obj.moveToThread(self._thread)
        self._thread.started.connect(self._worker_obj.run)
        self._worker_obj.progress.connect(self._on_progress)
        self._worker_obj.log.connect(self.log.emit)
        self._worker_obj.error.connect(self.error.emit)
        self._worker_obj.finished.connect(self._on_worker_finished)
        self._worker_obj.cancelled.connect(self._on_cancelled)
        self._thread.start()
    
    def _on_progress(self, step_name: str, percent: float, message: str) -> None:
        """Phase 7 HP3 : Met à jour QProgressDialog + émet signal."""
        if self._progress_dialog:
            self._progress_dialog.setLabelText(f"{step_name}\n{message}")
            self._progress_dialog.setValue(int(percent * 100))
        self.progress.emit(step_name, percent, message)

    def _on_worker_finished(self, results: list) -> None:
        if self._progress_dialog:
            self._progress_dialog.setValue(100)
            self._progress_dialog.close()
        self.finished.emit(results)
        if self._thread and self._thread.isRunning():
            self._thread.quit()
            if not self._thread.wait(3000):
                logger.warning("Worker thread did not finish within 3s")
    
    def _on_cancelled(self) -> None:
        """Phase 7 HP3 : Ferme QProgressDialog et émet signal."""
        if self._progress_dialog:
            self._progress_dialog.close()
        self.cancelled.emit()

    def cancel(self) -> None:
        self._runner.cancel()


class _PipelineWorker(QObject):
    """Objet qui exécute le pipeline dans son thread (connecté via moveToThread)."""

    progress = Signal(str, float, str)
    log = Signal(str, str)
    error = Signal(str, object)
    finished = Signal(list)
    cancelled = Signal()

    def __init__(
        self,
        runner: PipelineRunner,
        steps: list[Step],
        context: PipelineContext,
        force: bool,
    ):
        super().__init__()
        self.runner = runner
        self.steps = steps
        self.context = context
        self.force = force

    def run(self) -> None:
        try:
            results = self.runner.run(
                self.steps,
                self.context,
                force=self.force,
                on_progress=lambda s, p, m: self.progress.emit(s, p, m),
                on_log=lambda level, msg: self.log.emit(level, msg),
                on_error=lambda s, e: self.error.emit(s, e),
                on_cancelled=lambda: self.cancelled.emit(),
            )
            self.finished.emit(results)
        except Exception as e:
            logger.exception("Unexpected error in worker thread")
            self.error.emit("worker", e)
            self.finished.emit([])
