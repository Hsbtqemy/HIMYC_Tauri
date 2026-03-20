"""Interfaces Step / StepResult et types pour le pipeline."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable

from howimetyourcorpus.core.pipeline.context import PipelineContext


@dataclass
class StepResult:
    """Résultat d'une étape (succès, message, données optionnelles)."""

    success: bool
    message: str = ""
    data: dict[str, Any] | None = None


class Step(ABC):
    """Étape du pipeline, relançable de façon idempotente (skip si déjà fait sauf force=True)."""

    name: str = ""

    @abstractmethod
    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        """
        Exécute l'étape.

        context : voir PipelineContext (config, store, db optionnel, custom_profiles optionnel).
        """
        ...


# Callbacks typés pour le runner
ProgressCallback = Callable[[str, float, str], None]  # step_name, percent, message
LogCallback = Callable[[str, str], None]  # level, message
ErrorCallback = Callable[[str, Exception], None]
CancelledCallback = Callable[[], None]
