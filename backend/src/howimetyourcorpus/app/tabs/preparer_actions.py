"""Contrôleur d'actions métier UI pour l'onglet Préparer."""

from __future__ import annotations

import logging
import re
from typing import Any

from PySide6.QtWidgets import QMessageBox

from howimetyourcorpus.app.dialogs import NormalizeOptionsDialog, SegmentationOptionsDialog
from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE
from howimetyourcorpus.app.dialogs.search_replace import SearchReplaceDialog
from howimetyourcorpus.app.undo_commands import CallbackUndoCommand
from howimetyourcorpus.core.preparer import (
    DEFAULT_SEGMENTATION_OPTIONS,
    normalize_segmentation_options,
)


class PreparerActionsController:
    """Regroupe les actions utilisateur de haut niveau de l'onglet Préparer."""

    def __init__(self, tab: Any, logger_obj: logging.Logger) -> None:
        self._tab = tab
        self._logger = logger_obj

    def normalize_transcript(self) -> None:
        tab = self._tab
        episode_id = tab.prep_episode_combo.currentData()
        if not episode_id:
            QMessageBox.warning(tab, "Préparer", "Sélectionnez un épisode.")
            return
        if tab._current_source_key != "transcript":
            QMessageBox.information(tab, "Préparer", "Normalisation disponible sur Transcript.")
            return

        store = tab._get_store()
        assert store is not None  # garanti par @require_project côté widget
        profile_id = DEFAULT_NORMALIZE_PROFILE
        if tab._current_episode_id:
            preferred = store.load_episode_preferred_profiles()
            episode_profile = preferred.get(tab._current_episode_id)
            if episode_profile:
                profile_id = episode_profile
        dlg = NormalizeOptionsDialog(tab, default_profile_id=profile_id, store=store)
        if dlg.exec() != dlg.DialogCode.Accepted:
            return
        options = dlg.get_options()
        service = tab._build_service()
        if service is None:
            QMessageBox.warning(tab, "Préparer", "Service indisponible.")
            return
        try:
            result = service.apply_normalization(episode_id, "transcript", options)
            clean_text = result.get("clean_text") or ""
            stats = result.get("stats")
            debug = result.get("debug")
            tab._set_text(clean_text)
            tab.save_clean_text_with_meta(episode_id, clean_text, stats=stats, debug=debug)
            tab._apply_status_value("normalized", persist=True, mark_dirty=False)
            merges = int(getattr(stats, "merges", 0)) if stats else 0
            tab._show_status(f"Normalisation appliquée ({merges} fusion(s)).", 4000)
        except Exception as exc:
            self._logger.exception("Normalize transcript preparer")
            QMessageBox.critical(tab, "Préparer", f"Erreur normalisation: {exc}")

    def search_replace(self) -> None:
        tab = self._tab
        dialog = SearchReplaceDialog(tab)
        if dialog.exec() != dialog.DialogCode.Accepted:
            return
        needle, replacement, case_sensitive, is_regex = dialog.get_params()
        if not needle:
            QMessageBox.warning(tab, "Préparer", "Le texte à rechercher est vide.")
            return

        try:
            if tab.stack.currentWidget() == tab.utterance_table and tab.utterance_table.rowCount() > 0:
                count = tab._search_replace_table(  # noqa: SLF001 - API interne widget
                    tab.utterance_table,
                    needle,
                    replacement,
                    case_sensitive,
                    is_regex,
                    text_col=2,
                )
            elif tab.stack.currentWidget() == tab.cue_table and tab.cue_table.rowCount() > 0:
                count = tab._search_replace_table(  # noqa: SLF001 - API interne widget
                    tab.cue_table,
                    needle,
                    replacement,
                    case_sensitive,
                    is_regex,
                    text_col=4,
                )
            else:
                before = tab.text_editor.toPlainText()
                after, count = tab._replace_text(  # noqa: SLF001 - API interne widget
                    before,
                    needle,
                    replacement,
                    case_sensitive,
                    is_regex,
                )
                if count > 0:
                    if tab.undo_stack:
                        cmd = CallbackUndoCommand(
                            f"Rechercher/remplacer ({count})",
                            redo_callback=lambda value=after: tab._apply_plain_text_value(value),  # noqa: SLF001
                            undo_callback=lambda value=before: tab._apply_plain_text_value(value),  # noqa: SLF001
                        )
                        tab.undo_stack.push(cmd)
                    else:
                        tab._apply_plain_text_value(after)  # noqa: SLF001
            if count > 0:
                tab._show_status(f"{count} remplacement(s).", 3000)
            else:
                QMessageBox.information(tab, "Préparer", "Aucune occurrence trouvée.")
        except re.error as exc:
            QMessageBox.warning(tab, "Préparer", f"Regex invalide: {exc}")

    def load_segmentation_options(self, episode_id: str, source_key: str) -> dict[str, Any]:
        tab = self._tab
        store = tab._get_store()
        if not store:
            return dict(DEFAULT_SEGMENTATION_OPTIONS)
        try:
            return store.get_episode_segmentation_options(
                episode_id,
                source_key,
                default=DEFAULT_SEGMENTATION_OPTIONS,
            )
        except Exception:
            self._logger.exception("Load segmentation options")
            return dict(DEFAULT_SEGMENTATION_OPTIONS)

    def open_segmentation_options(self) -> None:
        tab = self._tab
        episode_id = tab.prep_episode_combo.currentData()
        if not episode_id:
            QMessageBox.warning(tab, "Préparer", "Sélectionnez un épisode.")
            return
        if tab._current_source_key != "transcript":
            QMessageBox.information(
                tab,
                "Préparer",
                "Les paramètres de segmentation sont disponibles sur la source Transcript.",
            )
            return

        store = tab._get_store()
        assert store is not None  # garanti par @require_project côté widget

        initial = self.load_segmentation_options(episode_id, tab._current_source_key)
        dialog = SegmentationOptionsDialog(tab, initial_options=initial)
        if dialog.exec() != dialog.DialogCode.Accepted:
            return
        options = normalize_segmentation_options(dialog.get_options())
        try:
            store.set_episode_segmentation_options(episode_id, tab._current_source_key, options)
        except Exception as exc:
            self._logger.exception("Save segmentation options")
            QMessageBox.critical(tab, "Préparer", f"Impossible d'enregistrer les paramètres: {exc}")
            return
        tab._show_status("Paramètres segmentation enregistrés.", 3000)

    def go_to_alignement(self) -> None:
        tab = self._tab
        episode_id = tab.prep_episode_combo.currentData()
        if not episode_id:
            QMessageBox.warning(tab, "Préparer", "Sélectionnez un épisode.")
            return
        if tab._dirty and not tab.prompt_save_if_dirty():
            return
        segment_kind = self._infer_segment_kind_for_handoff(str(episode_id))
        tab._on_go_alignement(episode_id, segment_kind)

    def _infer_segment_kind_for_handoff(self, episode_id: str) -> str:
        tab = self._tab
        if tab._current_source_key == "transcript":
            return "utterance" if tab.utterance_table.rowCount() > 0 else "sentence"

        db = tab._get_db()
        if not db:
            return "sentence"
        try:
            utterances = db.get_segments_for_episode(episode_id, kind="utterance")
            if utterances:
                return "utterance"
        except Exception:
            self._logger.exception("Infer segment kind for handoff")
        return "sentence"
