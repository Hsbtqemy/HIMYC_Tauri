"""Orchestration du pipeline : run(steps, callbacks), annulation, progression."""

from __future__ import annotations

import logging
from typing import Callable

from howimetyourcorpus.core.pipeline.context import PipelineContext
from howimetyourcorpus.core.pipeline.steps import (
    ErrorCallback,
    LogCallback,
    ProgressCallback,
    Step,
    StepResult,
)

logger = logging.getLogger(__name__)


class PipelineRunner:
    """
    Exécute une liste d'étapes avec callbacks (progress, log, error).
    Supporte l'annulation via _cancelled.
    """

    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    def run(
        self,
        steps: list[Step],
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: ProgressCallback | None = None,
        on_log: LogCallback | None = None,
        on_error: ErrorCallback | None = None,
        on_cancelled: Callable[[], None] | None = None,
    ) -> list[StepResult]:
        """
        Exécute les étapes dans l'ordre.
        En cas d'annulation ou d'erreur, arrête et appelle les callbacks appropriés.
        """
        self._cancelled = False
        results: list[StepResult] = []

        def log(level: str, msg: str) -> None:
            if on_log:
                on_log(level, msg)
            getattr(logger, level.lower(), logger.info)(msg)

        for i, step in enumerate(steps):
            if self._cancelled:
                if on_cancelled:
                    on_cancelled()
                log("warning", "Pipeline cancelled")
                break
            log("info", f"Running step: {step.name}")
            ctx = dict(context)
            ctx["is_cancelled"] = lambda: self._cancelled
            try:
                result = step.run(
                    ctx,
                    force=force,
                    on_progress=on_progress,
                    on_log=on_log,
                )
                results.append(result)
                if not result.success:
                    if result.message == "Cancelled":
                        if on_cancelled:
                            on_cancelled()
                        log("warning", "Pipeline cancelled")
                    else:
                        if on_error:
                            on_error(step.name, RuntimeError(result.message))
                        log("error", result.message)
                    break
            except Exception as e:
                logger.exception("Step %s failed", step.name)
                if on_error:
                    on_error(step.name, e)
                results.append(StepResult(False, str(e)))
                break
        return results
