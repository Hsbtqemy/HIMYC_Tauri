"""Contrôleur d'actions métier UI pour l'onglet Alignement."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QPoint

from howimetyourcorpus.app.models_qt import AlignLinksTableModel
from howimetyourcorpus.app.tabs.alignement_exporters import (
    export_alignment_links,
    export_parallel_rows,
    normalize_parallel_export_path,
)
from howimetyourcorpus.app.undo_commands import (
    BulkAcceptLinksCommand,
    BulkRejectLinksCommand,
    DeleteAlignRunCommand,
    EditAlignLinkCommand,
    SetAlignStatusCommand,
)
from howimetyourcorpus.core.export_utils import export_align_report_html
from howimetyourcorpus.core.pipeline.tasks import AlignEpisodeStep


class AlignmentActionsController:
    """Regroupe les actions utilisateur de haut niveau de l'onglet Alignement."""

    def __init__(self, tab: Any, logger_obj: logging.Logger) -> None:
        self._tab = tab
        self._logger = logger_obj

    @staticmethod
    def _combo_lang_value(combo: Any, fallback: str = "") -> str:
        if combo is None:
            return fallback
        value = combo.currentData() if hasattr(combo, "currentData") else None
        if value is None:
            value = combo.currentText() if hasattr(combo, "currentText") else ""
        normalized = str(value or "").strip().lower()
        return normalized if normalized else fallback

    def delete_current_run(
        self,
        *,
        message_box: Any,
        confirm_action_fn: Callable[[Any, str, str], bool],
    ) -> None:
        tab = self._tab
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()
        eid = tab.align_episode_combo.currentData()

        if not run_id or not db or not eid:
            if not run_id:
                message_box.information(
                    tab,
                    "Supprimer le run",
                    "Aucun run sélectionné. Choisissez un run dans la liste déroulante « Run ».",
                )
            return

        links = db.query_alignment_for_episode(eid, run_id=run_id)
        nb_links = len(links)
        if not confirm_action_fn(
            tab,
            "Supprimer le run",
            f"Supprimer le run « {run_id} » ?\n\n"
            f"• {nb_links} lien(s) d'alignement seront supprimés\n"
            f"• Les corrections manuelles seront perdues\n"
            f"• Vous devrez relancer l'alignement pour recréer les liens\n\n"
            "Vous pourrez annuler cette suppression avec Ctrl+Z (Undo) après validation.",
        ):
            return

        try:
            if tab.undo_stack:
                cmd = DeleteAlignRunCommand(db, run_id, eid)
                tab.undo_stack.push(cmd)
            else:
                db.delete_align_run(run_id)
        except Exception:
            self._logger.exception("Suppression run (Undo)")
            try:
                db.delete_align_run(run_id)
                message_box.information(
                    tab,
                    "Run supprimé",
                    "Le run a été supprimé (annulation Undo non disponible).",
                )
            except Exception as exc:
                self._logger.exception("Suppression run directe")
                message_box.critical(
                    tab,
                    "Erreur",
                    f"Impossible de supprimer le run : {exc}",
                )
                return

        tab.refresh()
        tab._fill_links()  # noqa: SLF001 - API interne widget

    def bulk_accept(
        self,
        *,
        message_box: Any,
        confirm_action_fn: Callable[[Any, str, str], bool],
    ) -> None:
        """Accepte tous les liens `auto` avec confidence >= seuil."""
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()

        if not eid or not run_id:
            message_box.warning(tab, "Actions bulk", "Sélectionnez un épisode et un run.")
            return

        threshold = tab.bulk_threshold_spin.value() / 100.0
        links = db.query_alignment_for_episode(eid, run_id=run_id)
        candidates = [
            link
            for link in links
            if link.get("status") == "auto" and (link.get("confidence") or 0) >= threshold
        ]
        if not candidates:
            message_box.information(
                tab,
                "Actions bulk",
                f"Aucun lien 'auto' avec confidence >= {threshold:.0%} à accepter.",
            )
            return
        if not confirm_action_fn(
            tab,
            "Accepter en masse",
            f"Accepter {len(candidates)} lien(s) avec confidence >= {threshold:.0%} ?\n\n"
            "Ces liens passeront du statut 'auto' à 'accepted'.",
        ):
            return

        if tab.undo_stack:
            link_ids = [link["link_id"] for link in candidates if link.get("link_id")]
            cmd = BulkAcceptLinksCommand(db, link_ids, len(link_ids))
            tab.undo_stack.push(cmd)
        else:
            with db.connection() as conn:
                for link in candidates:
                    link_id = link.get("link_id")
                    if link_id:
                        conn.execute("UPDATE align_links SET status = 'accepted' WHERE link_id = ?", (link_id,))
                conn.commit()

        tab._fill_links()  # noqa: SLF001 - API interne widget
        tab._update_stats()  # noqa: SLF001 - API interne widget
        message_box.information(tab, "Actions bulk", f"{len(candidates)} lien(s) accepté(s).")

    def bulk_reject(
        self,
        *,
        message_box: Any,
        confirm_action_fn: Callable[[Any, str, str], bool],
    ) -> None:
        """Rejette tous les liens `auto` avec confidence < seuil."""
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()

        if not eid or not run_id:
            message_box.warning(tab, "Actions bulk", "Sélectionnez un épisode et un run.")
            return

        threshold = tab.bulk_threshold_spin.value() / 100.0
        links = db.query_alignment_for_episode(eid, run_id=run_id)
        candidates = [
            link
            for link in links
            if link.get("status") == "auto" and (link.get("confidence") or 0) < threshold
        ]
        if not candidates:
            message_box.information(
                tab,
                "Actions bulk",
                f"Aucun lien 'auto' avec confidence < {threshold:.0%} à rejeter.",
            )
            return
        if not confirm_action_fn(
            tab,
            "Rejeter en masse",
            f"Rejeter {len(candidates)} lien(s) avec confidence < {threshold:.0%} ?\n\n"
            "⚠️ Ces liens passeront du statut 'auto' à 'rejected'.\n"
            "Vous pourrez les accepter individuellement plus tard si nécessaire.",
        ):
            return

        if tab.undo_stack:
            link_ids = [link["link_id"] for link in candidates if link.get("link_id")]
            cmd = BulkRejectLinksCommand(db, link_ids, len(link_ids))
            tab.undo_stack.push(cmd)
        else:
            with db.connection() as conn:
                for link in candidates:
                    link_id = link.get("link_id")
                    if link_id:
                        conn.execute("UPDATE align_links SET status = 'rejected' WHERE link_id = ?", (link_id,))
                conn.commit()

        tab._fill_links()  # noqa: SLF001 - API interne widget
        tab._update_stats()  # noqa: SLF001 - API interne widget
        message_box.information(tab, "Actions bulk", f"{len(candidates)} lien(s) rejeté(s).")

    def table_context_menu(
        self,
        pos: QPoint,
        *,
        menu_cls: type,
        edit_dialog_cls: type,
    ) -> None:
        tab = self._tab
        idx = tab.align_table.indexAt(pos)
        if not idx.isValid():
            return
        db = tab._get_db()
        if not db:
            return
        model = tab.align_table.model()
        if not isinstance(model, AlignLinksTableModel):
            return
        link = model.get_link_at(idx.row())
        if not link or not link.get("link_id"):
            return

        link_id = link["link_id"]
        eid = tab.align_episode_combo.currentData()
        menu = menu_cls(tab)
        accept_act = menu.addAction("Accepter")
        reject_act = menu.addAction("Rejeter")
        edit_act = menu.addAction("Modifier la cible…")
        action = menu.exec(tab.align_table.viewport().mapToGlobal(pos))

        if action == accept_act:
            if tab.undo_stack:
                cmd = SetAlignStatusCommand(
                    db,
                    link_id,
                    "accepted",
                    link.get("status", "auto"),
                    f"Accepter lien #{link_id[:8]}",
                )
                tab.undo_stack.push(cmd)
            else:
                db.set_align_status(link_id, "accepted")
            tab._fill_links()  # noqa: SLF001 - API interne widget
            tab._update_stats()  # noqa: SLF001 - API interne widget
            return

        if action == reject_act:
            if tab.undo_stack:
                cmd = SetAlignStatusCommand(
                    db,
                    link_id,
                    "rejected",
                    link.get("status", "auto"),
                    f"Rejeter lien #{link_id[:8]}",
                )
                tab.undo_stack.push(cmd)
            else:
                db.set_align_status(link_id, "rejected")
            tab._fill_links()  # noqa: SLF001 - API interne widget
            tab._update_stats()  # noqa: SLF001 - API interne widget
            return

        if action == edit_act and eid:
            dlg = edit_dialog_cls(link, eid, db, tab)
            if dlg.exec() != dlg.DialogCode.Accepted:
                return
            old_target_id = link.get("cue_id_target")
            new_target_id = dlg.selected_cue_id_target()
            if tab.undo_stack and old_target_id != new_target_id:
                cmd = EditAlignLinkCommand(
                    db,
                    link_id,
                    new_target_id,
                    old_target_id,
                    "manual",
                    link.get("status", "auto"),
                )
                tab.undo_stack.push(cmd)
            tab._fill_links()  # noqa: SLF001 - API interne widget
            tab._update_stats()  # noqa: SLF001 - API interne widget

    def run_align_episode(self, *, message_box: Any) -> None:
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        if not eid:
            message_box.warning(tab, "Alignement", "Sélectionnez un épisode.")
            return
        db = tab._get_db()
        if not db:
            return
        use_similarity = tab.align_by_similarity_cb.isChecked()
        segment_kind = tab.align_segment_kind_combo.currentData() or "sentence"
        pivot_lang = self._combo_lang_value(getattr(tab, "align_pivot_lang_combo", None), fallback="en")
        target_lang = self._combo_lang_value(getattr(tab, "align_target_lang_combo", None), fallback="")
        target_langs = [target_lang] if target_lang else []

        if target_lang and target_lang == pivot_lang:
            message_box.warning(
                tab,
                "Alignement",
                "La langue cible doit être différente de la langue pivot.",
            )
            return

        segments = db.get_segments_for_episode(eid, kind=segment_kind)
        has_segments = bool(segments)
        if not has_segments and not target_langs:
            message_box.warning(
                tab,
                "Alignement",
                "Aucun segment disponible pour cet épisode et aucune langue cible sélectionnée.\n"
                "Segmentez d'abord l'épisode (Inspecteur → bloc Produire), ou choisissez une langue cible pour un alignement cues↔cues.",
            )
            return

        pivot_cues = db.get_cues_for_episode_lang(eid, pivot_lang)
        target_cues = {lang: db.get_cues_for_episode_lang(eid, lang) for lang in target_langs}
        has_any_target_cues = any(target_cues.values())
        if not has_segments and not pivot_cues:
            message_box.warning(
                tab,
                "Alignement",
                "Alignement cues↔cues impossible : piste pivot manquante.\n"
                f"Importez la piste {pivot_lang.upper()} via le bouton « Outils SRT ▸ » en haut de l'Inspecteur.",
            )
            return
        if not has_segments and not has_any_target_cues:
            message_box.warning(
                tab,
                "Alignement",
                "Alignement cues↔cues impossible : aucune piste cible disponible.\n"
                "Importez une piste cible ou choisissez un autre épisode.",
            )
            return
        if has_segments and not pivot_cues and not has_any_target_cues:
            selected = ", ".join([pivot_lang.upper()] + [lang.upper() for lang in target_langs if lang])
            message_box.warning(
                tab,
                "Alignement",
                f"Aucune piste de sous-titres trouvée pour {selected}.\n"
                "Importez au moins une piste via le bouton « Outils SRT ▸ » en haut de l'Inspecteur.",
            )
            return
        if target_langs:
            missing_targets = [lang for lang, cues in target_cues.items() if not cues]
            if missing_targets:
                message_box.warning(
                    tab,
                    "Alignement",
                    "Piste cible manquante pour: "
                    + ", ".join(lang.upper() for lang in missing_targets)
                    + ".\nImportez la piste cible ou choisissez « Aucune ».",
                )
                return

        tab._run_job(  # noqa: SLF001 - API interne widget
            [
                AlignEpisodeStep(
                    eid,
                    pivot_lang=pivot_lang,
                    target_langs=target_langs,
                    use_similarity_for_cues=use_similarity,
                    segment_kind=segment_kind,
                )
            ]
        )

    def generate_alignment_groups(self, *, message_box: Any) -> None:
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()
        store = tab._get_store()
        if not eid or not run_id:
            message_box.warning(tab, "Groupes alignés", "Sélectionnez un épisode et un run.")
            return
        if not db or not store:
            return
        try:
            grouping = store.generate_align_grouping(db, eid, run_id, tolerant=True)
            groups = grouping.get("groups") or []
            message_box.information(
                tab,
                "Groupes alignés",
                f"Groupes générés: {len(groups)} (run {run_id}).\n"
                "Aucune donnée source n'a été modifiée.",
            )
        except Exception as exc:
            self._logger.exception("Generate alignment groups")
            message_box.critical(tab, "Groupes alignés", f"Erreur génération groupes: {exc}")

    def export_grouped_alignment(self, *, file_dialog: Any, message_box: Any) -> None:
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()
        store = tab._get_store()
        if not eid or not run_id:
            message_box.warning(tab, "Export groupes alignés", "Sélectionnez un épisode et un run.")
            return
        if not db or not store:
            return

        path, selected_filter = file_dialog.getSaveFileName(
            tab,
            "Exporter groupes alignés",
            "",
            "CSV (*.csv);;TSV (*.tsv);;TXT (*.txt);;HTML (*.html);;JSONL (*.jsonl);;Word (*.docx)",
        )
        if not path:
            return
        output_path = normalize_parallel_export_path(path, selected_filter)
        try:
            grouping = store.load_align_grouping(eid, run_id)
            if not grouping:
                grouping = store.generate_align_grouping(db, eid, run_id, tolerant=True)
            rows = store.align_grouping_to_parallel_rows(grouping)
            export_parallel_rows(rows, output_path, title=f"Groupes {eid} — {run_id}")
            message_box.information(tab, "Export", f"Groupes alignés exportés : {len(rows)} groupe(s).")
        except Exception as exc:
            self._logger.exception("Export grouped alignment")
            message_box.critical(tab, "Export groupes alignés", f"Erreur export: {exc}")

    def export_alignment(self, *, file_dialog: Any, message_box: Any) -> None:
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()
        if not eid or not run_id:
            message_box.warning(tab, "Alignement", "Sélectionnez un épisode et un run.")
            return

        path, _ = file_dialog.getSaveFileName(tab, "Exporter alignement", "", "CSV (*.csv);;JSONL (*.jsonl)")
        if not path:
            return

        links = db.query_alignment_for_episode(eid, run_id=run_id)
        try:
            output_path = Path(path)
            export_alignment_links(output_path, links)
            message_box.information(tab, "Export", f"Alignement exporté : {len(links)} lien(s).")
        except Exception as exc:
            self._logger.exception("Export alignement")
            message_box.critical(
                tab,
                "Erreur export",
                f"Erreur lors de l'export : {exc}\n\n"
                "Vérifiez les droits d'écriture, que le fichier n'est pas ouvert ailleurs et l'encodage (UTF-8).",
            )

    def export_parallel_concordance(self, *, file_dialog: Any, message_box: Any) -> None:
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()
        if not eid or not run_id:
            message_box.warning(tab, "Concordancier parallèle", "Sélectionnez un épisode et un run.")
            return

        path, selected_filter = file_dialog.getSaveFileName(
            tab,
            "Exporter concordancier parallèle (comparaison de traductions)",
            "",
            "CSV (*.csv);;TSV (*.tsv);;TXT (*.txt);;HTML (*.html);;JSONL (*.jsonl);;Word (*.docx)",
        )
        if not path:
            return

        output_path = normalize_parallel_export_path(path, selected_filter)
        try:
            status_filter = "accepted" if tab.align_accepted_only_cb.isChecked() else None
            rows = db.get_parallel_concordance(eid, run_id, status_filter=status_filter)
            export_parallel_rows(rows, output_path, title=f"Comparaison {eid} — {run_id}")
            message_box.information(tab, "Export", f"Concordancier parallèle exporté : {len(rows)} ligne(s).")
        except Exception as exc:
            self._logger.exception("Export concordancier parallèle")
            message_box.critical(
                tab,
                "Erreur export",
                f"Erreur lors de l'export : {exc}\n\n"
                "Vérifiez les droits d'écriture et que le fichier n'est pas ouvert ailleurs.",
            )

    def export_align_report(self, *, file_dialog: Any, message_box: Any) -> None:
        tab = self._tab
        eid = tab.align_episode_combo.currentData()
        run_id = tab.align_run_combo.currentData()
        db = tab._get_db()
        if not eid or not run_id:
            message_box.warning(tab, "Rapport", "Sélectionnez un épisode et un run.")
            return

        path, _ = file_dialog.getSaveFileName(tab, "Rapport alignement", "", "HTML (*.html)")
        if not path:
            return

        output_path = Path(path)
        if output_path.suffix.lower() != ".html":
            output_path = output_path.with_suffix(".html")
        try:
            status_filter = "accepted" if tab.align_accepted_only_cb.isChecked() else None
            stats = db.get_align_stats_for_run(eid, run_id, status_filter=status_filter)
            sample = db.get_parallel_concordance(eid, run_id, status_filter=status_filter)
            export_align_report_html(stats, sample, eid, run_id, output_path)
            message_box.information(tab, "Rapport", f"Rapport enregistré : {output_path.name}")
        except Exception as exc:
            self._logger.exception("Rapport alignement")
            message_box.critical(
                tab,
                "Erreur rapport",
                f"Erreur lors de la génération du rapport : {exc}\n\n"
                "Vérifiez les droits d'écriture et que le fichier n'est pas ouvert ailleurs.",
            )
