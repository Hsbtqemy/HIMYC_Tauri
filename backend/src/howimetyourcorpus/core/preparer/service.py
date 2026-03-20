"""Service central pour l'onglet Préparer (transcript / SRT)."""

from __future__ import annotations

import logging
from typing import Any

from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE
from howimetyourcorpus.core.normalize.profiles import NormalizationProfile, get_profile
from howimetyourcorpus.core.segment import Segment, segmenter_utterances
from howimetyourcorpus.core.storage import db_segments, db_subtitles
from howimetyourcorpus.core.subtitles import cues_to_srt

logger = logging.getLogger(__name__)


class PreparerService:
    """Logique métier de préparation, indépendante de l'UI."""

    def __init__(self, store: Any, db: Any):
        self.store = store
        self.db = db

    def load_source(self, episode_id: str, source_key: str) -> dict[str, Any]:
        """Charge une source (transcript ou piste SRT) pour un épisode."""
        source = (source_key or "transcript").strip().lower()

        if source in ("transcript", "clean", "raw"):
            clean = self.store.load_episode_text(episode_id, kind="clean")
            raw = self.store.load_episode_text(episode_id, kind="raw")
            text = clean or raw
            selected_kind = "clean" if clean else "raw"
            utterances = self.db.get_segments_for_episode(episode_id, kind="utterance")
            return {
                "episode_id": episode_id,
                "source_key": "transcript",
                "kind": selected_kind,
                "text": text,
                "utterances": utterances,
            }

        if source.startswith("srt_"):
            lang = source.replace("srt_", "", 1)
            cues = self.db.get_cues_for_episode_lang(episode_id, lang)
            return {
                "episode_id": episode_id,
                "source_key": source,
                "lang": lang,
                "cues": cues,
            }

        raise ValueError(f"Source non supportée: {source_key}")

    def apply_normalization(
        self,
        episode_id: str,
        source_key: str,
        options: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Applique une normalisation explicite et retourne le résultat.

        Notes:
        - En transcript, l'appelant peut passer `input_text` pour normaliser l'édition en mémoire.
        - Si `persist=True`, le texte clean est enregistré avec stats+debug.
        """
        source = (source_key or "transcript").strip().lower()
        if source != "transcript":
            raise ValueError("MVP: normalisation explicite supportée uniquement pour transcript.")

        text = str(options.get("input_text") or "")
        if not text:
            text = self.store.load_episode_text(episode_id, kind="raw") or self.store.load_episode_text(
                episode_id, kind="clean"
            )

        profile = self._profile_from_options(options)
        clean_text, stats, debug = profile.apply(text)

        if options.get("persist"):
            self.store.save_episode_clean(episode_id, clean_text, stats, debug)

        return {
            "clean_text": clean_text,
            "stats": stats,
            "debug": debug,
            "profile_id": profile.id,
        }

    def segment_transcript_to_utterances(
        self,
        episode_id: str,
        clean_text: str | None = None,
    ) -> list[Segment]:
        """Segmente le transcript en tours et persiste les segments `utterance`."""
        text = (clean_text or "").strip()
        if not text:
            text = (
                self.store.load_episode_text(episode_id, kind="clean")
                or self.store.load_episode_text(episode_id, kind="raw")
            ).strip()
        if not text:
            return []

        utterances = segmenter_utterances(text)
        for seg in utterances:
            seg.episode_id = episode_id

        self.db.upsert_segments(episode_id, "utterance", utterances)
        # Changer les tours invalide les runs existants.
        self.db.delete_align_runs_for_episode(episode_id)
        return utterances

    def save_utterance_edits(self, episode_id: str, rows: list[dict[str, Any]]) -> int:
        """Sauvegarde les edits sur segments utterance + synchronise character_assignments."""
        updated = 0
        with self.db.transaction() as conn:
            for row in rows:
                segment_id = (row.get("segment_id") or "").strip()
                if not segment_id:
                    continue
                db_segments.update_segment_speaker(conn, segment_id, row.get("speaker_explicit") or None)
                db_segments.update_segment_text(conn, segment_id, row.get("text") or "")
                updated += 1

        self._sync_utterance_assignments(episode_id, rows)
        return updated

    @staticmethod
    def _estimate_char_spans(clean_text: str, utterance_texts: list[str]) -> list[tuple[int, int]]:
        """Estime des spans start/end pour les utterances, en parcourant le texte source."""
        source = clean_text or ""
        cursor = 0
        spans: list[tuple[int, int]] = []
        for text in utterance_texts:
            payload = (text or "").strip()
            if not payload:
                spans.append((cursor, cursor))
                continue
            idx = source.find(payload, cursor)
            if idx < 0:
                idx = source.find(payload)
            if idx < 0:
                idx = cursor
            end = idx + len(payload)
            spans.append((idx, end))
            cursor = max(cursor, end)
        return spans

    def replace_utterance_rows(
        self,
        episode_id: str,
        rows: list[dict[str, Any]],
        *,
        clean_text: str = "",
        invalidate_align_runs: bool = True,
    ) -> int:
        """
        Remplace entièrement les segments utterance d'un épisode selon l'ordre des lignes UI.

        Cette opération est utilisée pour supporter les éditions structurelles
        (ajout/suppression/fusion/scission/renumérotation) dans l'onglet Préparer.
        """
        segments: list[Segment] = []
        assignment_rows: list[dict[str, Any]] = []
        payload_rows: list[dict[str, Any]] = []
        for row in rows or []:
            text = (row.get("text") or "").strip()
            if not text:
                continue
            payload_rows.append(row)
        spans = self._estimate_char_spans(clean_text, [(row.get("text") or "") for row in payload_rows])

        for idx, row in enumerate(payload_rows):
            text = (row.get("text") or "").strip()
            speaker = (row.get("speaker_explicit") or "").strip() or None
            start_char, end_char = spans[idx] if idx < len(spans) else (0, 0)
            seg = Segment(
                episode_id=episode_id,
                kind="utterance",
                n=len(segments),
                start_char=int(start_char),
                end_char=int(end_char),
                text=text,
                speaker_explicit=speaker,
                meta={},
            )
            segments.append(seg)
            assignment_rows.append(
                {
                    "segment_id": seg.segment_id,
                    "speaker_explicit": speaker or "",
                    "text": text,
                    "character_id": (row.get("character_id") or "").strip(),
                }
            )

        self.db.upsert_segments(episode_id, "utterance", segments)
        if invalidate_align_runs:
            # Changer le découpage invalide les runs existants.
            self.db.delete_align_runs_for_episode(episode_id)
        self._sync_utterance_assignments(episode_id, assignment_rows)
        return len(segments)

    def save_cue_edits(
        self,
        episode_id: str,
        lang: str,
        rows: list[dict[str, Any]],
        *,
        rewrite_subtitle_file: bool = False,
    ) -> int:
        """Sauvegarde des edits de cues + synchronise assignations personnage."""
        previous_cues: list[dict[str, Any]] = []
        previous_subtitle_content: tuple[str, str] | None = None
        if rewrite_subtitle_file:
            previous_cues = self.db.get_cues_for_episode_lang(episode_id, lang)
            previous_subtitle_content = self.store.load_episode_subtitle_content(episode_id, lang)

        updated = 0
        with self.db.transaction() as conn:
            for row in rows:
                cue_id = (row.get("cue_id") or "").strip()
                if not cue_id:
                    continue
                if "text_clean" in row:
                    db_subtitles.update_cue_text_clean(conn, cue_id, row.get("text_clean") or "")
                    updated += 1
                if "start_ms" in row and "end_ms" in row:
                    db_subtitles.update_cue_timecodes(
                        conn,
                        cue_id,
                        int(row.get("start_ms") or 0),
                        int(row.get("end_ms") or 0),
                    )
                    updated += 1

        if rewrite_subtitle_file:
            cues = self.db.get_cues_for_episode_lang(episode_id, lang)
            try:
                if cues:
                    self.store.save_episode_subtitle_content(
                        episode_id,
                        lang,
                        cues_to_srt(cues),
                        "srt",
                    )
            except Exception:
                logger.exception("Rewrite subtitle file failed; rollback DB cue edits")
                # Rollback compensatoire: restaurer les colonnes éditées en base + le fichier disque précédent.
                try:
                    with self.db.transaction() as conn:
                        for cue in previous_cues:
                            cue_id = (cue.get("cue_id") or "").strip()
                            if not cue_id:
                                continue
                            db_subtitles.update_cue_text_clean(conn, cue_id, cue.get("text_clean") or "")
                            db_subtitles.update_cue_timecodes(
                                conn,
                                cue_id,
                                int(cue.get("start_ms") or 0),
                                int(cue.get("end_ms") or 0),
                            )
                except Exception:
                    logger.exception("Compensating DB rollback failed after subtitle rewrite failure")
                try:
                    if previous_subtitle_content:
                        prev_content, prev_fmt = previous_subtitle_content
                        self.store.save_episode_subtitle_content(episode_id, lang, prev_content, prev_fmt)
                    else:
                        self.store.remove_episode_subtitle(episode_id, lang)
                except Exception:
                    logger.exception("Compensating file rollback failed after subtitle rewrite failure")
                raise

        self._sync_cue_assignments(episode_id, lang, rows)
        return updated

    def _profile_from_options(self, options: dict[str, Any]) -> NormalizationProfile:
        profile_id = str(options.get("profile_id") or DEFAULT_NORMALIZE_PROFILE)
        base = get_profile(profile_id, self.store.load_custom_profiles()) or get_profile(DEFAULT_NORMALIZE_PROFILE)
        if base is None:
            base = NormalizationProfile(id=DEFAULT_NORMALIZE_PROFILE)

        return NormalizationProfile(
            id=profile_id,
            merge_subtitle_breaks=bool(options.get("merge_subtitle_breaks", base.merge_subtitle_breaks)),
            max_merge_examples_in_debug=int(
                options.get("max_merge_examples_in_debug", base.max_merge_examples_in_debug)
            ),
            fix_double_spaces=bool(options.get("fix_double_spaces", base.fix_double_spaces)),
            fix_french_punctuation=bool(options.get("fix_french_punctuation", base.fix_french_punctuation)),
            normalize_apostrophes=bool(options.get("normalize_apostrophes", base.normalize_apostrophes)),
            normalize_quotes=bool(options.get("normalize_quotes", base.normalize_quotes)),
            strip_line_spaces=bool(options.get("strip_line_spaces", base.strip_line_spaces)),
            case_transform=str(options.get("case_transform", base.case_transform)),
            custom_regex_rules=list(options.get("custom_regex_rules", base.custom_regex_rules)),
        )

    def _sync_utterance_assignments(self, episode_id: str, rows: list[dict[str, Any]]) -> None:
        """Réécrit les assignations `segment` de type utterance pour l'épisode."""
        assignments = self.store.load_character_assignments()
        assignments = [
            a
            for a in assignments
            if not (
                a.get("episode_id") == episode_id
                and a.get("source_type") == "segment"
                and ":utterance:" in (a.get("source_id") or "")
            )
        ]
        for row in rows:
            segment_id = (row.get("segment_id") or "").strip()
            character_id = (row.get("character_id") or "").strip()
            if segment_id and character_id:
                assignments.append(
                    {
                        "episode_id": episode_id,
                        "source_type": "segment",
                        "source_id": segment_id,
                        "character_id": character_id,
                    }
                )
        self.store.save_character_assignments(assignments)

    def _sync_cue_assignments(self, episode_id: str, lang: str, rows: list[dict[str, Any]]) -> None:
        """Réécrit les assignations `cue` pour (épisode, langue)."""
        prefix = f"{episode_id}:{lang}:"
        assignments = self.store.load_character_assignments()
        assignments = [
            a
            for a in assignments
            if not (
                a.get("episode_id") == episode_id
                and a.get("source_type") == "cue"
                and (a.get("source_id") or "").startswith(prefix)
            )
        ]
        for row in rows:
            cue_id = (row.get("cue_id") or "").strip()
            character_id = (row.get("character_id") or "").strip()
            if cue_id and character_id:
                assignments.append(
                    {
                        "episode_id": episode_id,
                        "source_type": "cue",
                        "source_id": cue_id,
                        "character_id": character_id,
                    }
                )
        self.store.save_character_assignments(assignments)
