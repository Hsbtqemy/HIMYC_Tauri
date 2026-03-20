"""Contrôleur d'orchestration des jobs pour la fenêtre principale."""

from __future__ import annotations

import logging
from typing import Any

from PySide6.QtWidgets import QPlainTextEdit, QWidget

from howimetyourcorpus.core.utils.text import extract_episode_id_from_message


class MainWindowJobsController:
    """Regroupe la logique d'exécution et de finalisation des jobs pipeline."""

    def __init__(self, window: Any, logger_obj: logging.Logger) -> None:
        self._window = window
        self._logger = logger_obj

    def run_job(self, steps: list[Any], *, job_runner_cls: type) -> None:
        win = self._window
        win._sync_config_from_project_tab()  # noqa: SLF001 - API interne fenêtre
        context = win._get_context()  # noqa: SLF001 - API interne fenêtre
        if not context.get("config"):
            return

        win._job_runner = job_runner_cls(  # noqa: SLF001 - API interne fenêtre
            steps,
            context,
            force=False,
            parent=win,
            show_progress_dialog=True,
        )
        win._job_runner.progress.connect(win._on_job_progress)
        win._job_runner.log.connect(win._on_job_log)
        win._job_runner.error.connect(win._on_job_error)
        win._job_runner.finished.connect(win._on_job_finished)
        win._job_runner.cancelled.connect(win._on_job_cancelled)
        if hasattr(win, "corpus_tab") and win.corpus_tab:
            win.corpus_tab.set_cancel_btn_enabled(True)
            win.corpus_tab.set_progress(0)
        win._job_runner.run_async()

    def on_job_progress(self, _step_name: str, percent: float, _message: str) -> None:
        win = self._window
        if hasattr(win, "corpus_tab") and win.corpus_tab:
            win.corpus_tab.set_progress(int(percent * 100))

    def on_job_log(self, level: str, message: str, *, tab_logs_index: int) -> None:
        win = self._window
        if win.tabs.count() <= tab_logs_index:
            return
        log_widget = win.tabs.widget(tab_logs_index)
        if not isinstance(log_widget, QWidget):
            return
        te = log_widget.findChild(QPlainTextEdit)
        if te:
            te.appendPlainText(f"[{level}] {message}")

    def append_job_summary_to_log(self, summary: str, *, tab_logs_index: int) -> None:
        win = self._window
        if win.tabs.count() <= tab_logs_index:
            return
        log_widget = win.tabs.widget(tab_logs_index)
        if not isinstance(log_widget, QWidget):
            return
        te = log_widget.findChild(QPlainTextEdit)
        if te:
            te.appendPlainText(f"[info] {summary}")

    @staticmethod
    def build_job_summary_message(results: list[Any]) -> tuple[str, set[str], int]:
        """Construit le message de fin de job + la liste d'épisodes en échec."""
        ok = sum(1 for r in results if getattr(r, "success", True))
        fail = len(results) - ok
        msg = f"Terminé : {ok} réussie(s), {fail} échec(s)."
        failed_episode_ids: set[str] = set()
        if fail:
            first_fail_msg = ""
            for result in results:
                if not getattr(result, "success", True):
                    message = (getattr(result, "message", None) or str(result)) or ""
                    if not first_fail_msg:
                        first_fail_msg = message[:80] + ("…" if len(message) > 80 else "")
                    ep_id = extract_episode_id_from_message(message)
                    if ep_id:
                        failed_episode_ids.add(ep_id)
            if failed_episode_ids:
                msg += f" Échec(s) : {', '.join(sorted(failed_episode_ids))}."
            elif first_fail_msg:
                msg += f" Premier échec : {first_fail_msg}"
        return msg, failed_episode_ids, fail

    def refresh_tabs_after_job(self, *, message_box: Any) -> None:
        """Rafraîchit les onglets dépendants après exécution d'un job."""
        win = self._window
        has_combined_inspector = bool(
            hasattr(win, "inspector_tab")
            and win.inspector_tab
            and hasattr(win.inspector_tab, "has_subtitle_panel")
            and win.inspector_tab.has_subtitle_panel()
        )
        refreshers: list[tuple[str, Any, bool]] = [
            ("_refresh_episodes_from_store", win._refresh_episodes_from_store, True),  # noqa: SLF001
            ("_refresh_inspecteur_episodes", win._refresh_inspecteur_episodes, False),  # noqa: SLF001
            ("_refresh_preparer", win._refresh_preparer, False),  # noqa: SLF001
            ("_refresh_align_runs", win._refresh_align_runs, False),  # noqa: SLF001
            ("_refresh_concordance", win._refresh_concordance, False),  # noqa: SLF001
            ("_refresh_personnages", win._refresh_personnages, False),  # noqa: SLF001
            ("_refresh_expert", win._refresh_expert, False),  # noqa: SLF001
        ]
        if not has_combined_inspector:
            refreshers.insert(3, ("_refresh_subs_tracks", win._refresh_subs_tracks, False))  # noqa: SLF001
        for name, refresh_fn, show_warning in refreshers:
            try:
                refresh_fn()
            except Exception as exc:
                self._logger.exception("Error in %s", name)
                if show_warning:
                    message_box.warning(win, "Avertissement", f"Erreur lors du rafraîchissement des épisodes: {exc}")

    def on_job_finished(self, results: list[Any], *, message_box: Any, tab_logs_index: int) -> None:
        win = self._window
        try:
            if hasattr(win, "corpus_tab") and win.corpus_tab:
                win.corpus_tab.set_cancel_btn_enabled(False)
                win.corpus_tab.set_progress(100)
            msg, failed_episode_ids, fail = self.build_job_summary_message(results)
            win.statusBar().showMessage(msg, 10000 if fail else 5000)
            if hasattr(win, "corpus_tab") and win.corpus_tab:
                win.corpus_tab.store_failed_episodes(failed_episode_ids if fail else set())
            self.append_job_summary_to_log(msg, tab_logs_index=tab_logs_index)
            self.refresh_tabs_after_job(message_box=message_box)
            win._job_runner = None  # noqa: SLF001 - API interne fenêtre
        except Exception as exc:
            self._logger.exception("Critical error in _on_job_finished")
            message_box.critical(win, "Erreur critique", f"Erreur lors de la finalisation du job: {exc}")
            win._job_runner = None  # noqa: SLF001 - API interne fenêtre

    def on_job_cancelled(self) -> None:
        win = self._window
        if hasattr(win, "corpus_tab") and win.corpus_tab:
            win.corpus_tab.set_cancel_btn_enabled(False)
        win._job_runner = None  # noqa: SLF001 - API interne fenêtre

    def on_job_error(self, step_name: str, exc: object, *, message_box: Any) -> None:
        win = self._window
        self._logger.error(
            "Job error in step '%s': %s",
            step_name,
            exc,
            exc_info=exc if isinstance(exc, Exception) else None,
        )
        if hasattr(win, "corpus_tab") and win.corpus_tab:
            win.corpus_tab.set_cancel_btn_enabled(False)
        try:
            msg = str(exc) if exc is not None else "Erreur inconnue"
        except Exception as format_exc:
            self._logger.exception("Error while formatting error message")
            msg = f"Erreur inconnue (impossible de formater le message: {format_exc})"
        if len(msg) > 500:
            msg = msg[:497] + "..."
        try:
            message_box.critical(win, "Erreur", f"{step_name}: {msg}")
        except Exception:
            self._logger.exception("Error while showing error dialog")
            print(f"CRITICAL ERROR: {step_name}: {msg}")

    def cancel_job(self) -> None:
        win = self._window
        if win._job_runner:  # noqa: SLF001 - API interne fenêtre
            win._job_runner.cancel()
