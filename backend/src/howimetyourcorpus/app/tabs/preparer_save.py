"""Contrôleur de sauvegarde pour l'onglet Préparer."""

from __future__ import annotations

from typing import Any, Callable

from PySide6.QtCore import Qt
from PySide6.QtGui import QUndoStack
from PySide6.QtWidgets import QMessageBox, QTableWidget, QWidget

from howimetyourcorpus.app.undo_commands import CallbackUndoCommand
from howimetyourcorpus.core.preparer import parse_srt_time_to_ms


class PreparerSaveController:
    """Orchestre la sauvegarde métier + validations d'édition."""

    def __init__(
        self,
        *,
        get_store: Callable[[], Any],
        get_db: Callable[[], Any],
        build_service: Callable[[], Any],
        normalize_cue_timecodes_display: Callable[[], None],
        undo_stack: QUndoStack | None,
    ) -> None:
        self._get_store = get_store
        self._get_db = get_db
        self._build_service = build_service
        self._normalize_cue_timecodes_display = normalize_cue_timecodes_display
        self._undo_stack = undo_stack
        self._last_abort_reason: str | None = None

    def pop_abort_reason(self) -> str | None:
        reason = self._last_abort_reason
        self._last_abort_reason = None
        return reason

    @staticmethod
    def speaker_to_character_id(speaker: str, lookup: dict[str, str]) -> str:
        if not speaker:
            return ""
        return lookup.get(speaker.strip().lower(), "")

    def build_character_lookup(self) -> dict[str, str]:
        store = self._get_store()
        if not store:
            return {}
        characters = store.load_character_names()
        out: dict[str, str] = {}
        for ch in characters:
            cid = (ch.get("id") or ch.get("canonical") or "").strip()
            if not cid:
                continue
            out[cid.lower()] = cid
            canonical = (ch.get("canonical") or "").strip()
            if canonical:
                out[canonical.lower()] = cid
            names = ch.get("names_by_lang") or {}
            for name in names.values():
                label = (name or "").strip()
                if label:
                    out[label.lower()] = cid
        return out

    @staticmethod
    def _warn_unknown_characters(
        *,
        owner: QWidget,
        unknowns: list[tuple[int, str]],
        source_label: str,
    ) -> bool:
        if not unknowns:
            return False
        preview = unknowns[:8]
        lines = "\n".join([f"- Ligne {row}: {speaker}" for row, speaker in preview])
        extra = ""
        if len(unknowns) > len(preview):
            extra = f"\n... {len(unknowns) - len(preview)} autre(s) ligne(s)."
        QMessageBox.warning(
            owner,
            "Préparer",
            f"Personnage(s) inconnu(s) dans {source_label}.\n\n"
            "Ajoutez/corrigez ces personnages dans l'onglet « Personnages » "
            "puis réessayez.\n\n"
            f"{lines}{extra}",
        )
        return True

    def save_transcript_rows(
        self,
        *,
        owner: QWidget,
        episode_id: str,
        utterance_table: QTableWidget,
        text_value: str,
    ) -> bool:
        self._last_abort_reason = None
        service = self._build_service()
        if service is None:
            return False

        rows: list[dict[str, Any]] = []
        character_map = self.build_character_lookup()
        unknown_speakers: list[tuple[int, str]] = []
        for row in range(utterance_table.rowCount()):
            n_item = utterance_table.item(row, 0)
            speaker_item = utterance_table.item(row, 1)
            text_item = utterance_table.item(row, 2)
            segment_id = (n_item.data(Qt.ItemDataRole.UserRole) if n_item else "") or ""
            speaker = (speaker_item.text() if speaker_item else "").strip()
            text = (text_item.text() if text_item else "").strip()
            character_id = self.speaker_to_character_id(speaker, character_map)
            if speaker and not character_id:
                unknown_speakers.append((row + 1, speaker))
            rows.append(
                {
                    "segment_id": segment_id,
                    "speaker_explicit": speaker,
                    "text": text,
                    "character_id": character_id,
                }
            )

        if self._warn_unknown_characters(owner=owner, unknowns=unknown_speakers, source_label="les tours transcript"):
            return False

        db = self._get_db()
        if db is None:
            return False

        existing_segments = db.get_segments_for_episode(episode_id, kind="utterance")
        existing_ids = [(seg.get("segment_id") or "").strip() for seg in existing_segments]
        row_ids = [((row.get("segment_id") or "").strip()) for row in rows]
        row_ids_non_empty = [sid for sid in row_ids if sid]
        structure_changed = (
            len(row_ids_non_empty) != len(row_ids)
            or len(set(row_ids_non_empty)) != len(row_ids_non_empty)
            or row_ids != existing_ids
        )

        if structure_changed:
            runs = db.get_align_runs_for_episode(episode_id) or []
            if runs:
                preview = ", ".join([(r.get("align_run_id") or "") for r in runs[:3]])
                if len(runs) > 3:
                    preview += ", …"
                reply = QMessageBox.question(
                    owner,
                    "Préparer",
                    "Le découpage des tours a changé.\n\n"
                    f"Enregistrer maintenant supprimera {len(runs)} run(s) d'alignement lié(s) à cet épisode.\n"
                    "Point critique: les corrections manuelles d'alignement seront perdues.\n\n"
                    f"Runs concernés: {preview}\n\n"
                    "Voulez-vous continuer ?",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    QMessageBox.StandardButton.No,
                )
                if reply != QMessageBox.StandardButton.Yes:
                    self._last_abort_reason = "align_runs_invalidation_cancelled"
                    return False
            service.replace_utterance_rows(
                episode_id,
                rows,
                clean_text=text_value,
                invalidate_align_runs=True,
            )
        else:
            service.save_utterance_edits(episode_id, rows)
        return True

    def save_cue_rows(
        self,
        *,
        owner: QWidget,
        episode_id: str,
        lang: str,
        cue_table: QTableWidget,
        strict: bool,
    ) -> bool:
        self._last_abort_reason = None
        service = self._build_service()
        if service is None:
            return False

        rows: list[dict[str, Any]] = []
        character_map = self.build_character_lookup()
        unknown_speakers: list[tuple[int, str]] = []
        parsed_spans: list[tuple[int, int, int]] = []
        for row in range(cue_table.rowCount()):
            n_item = cue_table.item(row, 0)
            start_item = cue_table.item(row, 1)
            end_item = cue_table.item(row, 2)
            speaker_item = cue_table.item(row, 3)
            text_item = cue_table.item(row, 4)
            cue_id = (n_item.data(Qt.ItemDataRole.UserRole) if n_item else "") or ""
            start_str = (start_item.text() if start_item else "").strip()
            end_str = (end_item.text() if end_item else "").strip()
            try:
                start_ms = parse_srt_time_to_ms(start_str)
                end_ms = parse_srt_time_to_ms(end_str)
            except ValueError as exc:
                QMessageBox.warning(
                    owner,
                    "Préparer",
                    f"Ligne {row + 1}: {exc}\nFormat attendu: HH:MM:SS,mmm",
                )
                return False

            if start_ms < 0 or end_ms < 0 or start_ms >= end_ms:
                QMessageBox.warning(
                    owner,
                    "Préparer",
                    f"Ligne {row + 1}: timecodes invalides (début={start_str}, fin={end_str}).",
                )
                return False

            speaker = (speaker_item.text() if speaker_item else "").strip()
            text = (text_item.text() if text_item else "").strip()
            character_id = self.speaker_to_character_id(speaker, character_map)
            if speaker and not character_id:
                unknown_speakers.append((row + 1, speaker))
            n = int((n_item.text() if n_item else row) or row)
            parsed_spans.append((n, start_ms, end_ms))
            rows.append(
                {
                    "cue_id": cue_id,
                    "text_clean": text,
                    "character_id": character_id,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                }
            )

        if self._warn_unknown_characters(owner=owner, unknowns=unknown_speakers, source_label=f"les cues {lang.upper()}"):
            return False

        if strict:
            previous_end = -1
            for n, start_ms, end_ms in sorted(parsed_spans, key=lambda x: x[0]):
                if previous_end > start_ms:
                    QMessageBox.warning(
                        owner,
                        "Préparer",
                        f"Chevauchement détecté autour de la cue #{n}. "
                        "Désactivez « Validation stricte » ou corrigez les timecodes.",
                    )
                    return False
                previous_end = end_ms

        service.save_cue_edits(
            episode_id,
            lang,
            rows,
            rewrite_subtitle_file=True,
        )
        self._normalize_cue_timecodes_display()
        return True

    def push_snapshot_undo(
        self,
        *,
        title: str,
        redo_callback: Callable[[], None],
        undo_callback: Callable[[], None],
    ) -> None:
        if not self._undo_stack:
            return
        self._undo_stack.push(
            CallbackUndoCommand(
                title,
                redo_callback=redo_callback,
                undo_callback=undo_callback,
                already_applied=True,
            )
        )
