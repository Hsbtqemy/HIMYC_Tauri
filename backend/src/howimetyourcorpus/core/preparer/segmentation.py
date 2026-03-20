"""Segmentation utterances paramétrable pour l'onglet Préparer."""

from __future__ import annotations

import re
from typing import Any

DEFAULT_SEGMENTATION_OPTIONS: dict[str, Any] = {
    "speaker_regex": r"^([A-Z][A-Za-z0-9_'\-]{0,24}(?:\s+[A-Z][A-Za-z0-9_'\-]{0,24}){0,2}):\s*(.*)$",
    "enable_dash_rule": True,
    "dash_regex": r"^[\-–—]\s*(.*)$",
    "continuation_markers": ["...", "…"],
    "merge_if_prev_ends_with_marker": True,
    "attach_unmarked_to_previous": False,
}


def normalize_segmentation_options(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Normalise un dict d'options segmentation vers un schéma stable."""
    source = raw or {}
    speaker_regex = str(source.get("speaker_regex") or DEFAULT_SEGMENTATION_OPTIONS["speaker_regex"]).strip()
    if not speaker_regex:
        speaker_regex = DEFAULT_SEGMENTATION_OPTIONS["speaker_regex"]

    dash_regex = str(source.get("dash_regex") or DEFAULT_SEGMENTATION_OPTIONS["dash_regex"]).strip()
    if not dash_regex:
        dash_regex = DEFAULT_SEGMENTATION_OPTIONS["dash_regex"]

    markers = source.get("continuation_markers")
    if isinstance(markers, str):
        marker_values = [x.strip() for x in markers.split(",") if x.strip()]
    elif isinstance(markers, list):
        marker_values = [str(x).strip() for x in markers if str(x).strip()]
    else:
        marker_values = list(DEFAULT_SEGMENTATION_OPTIONS["continuation_markers"])

    return {
        "speaker_regex": speaker_regex,
        "enable_dash_rule": bool(source.get("enable_dash_rule", DEFAULT_SEGMENTATION_OPTIONS["enable_dash_rule"])),
        "dash_regex": dash_regex,
        "continuation_markers": marker_values,
        "merge_if_prev_ends_with_marker": bool(
            source.get(
                "merge_if_prev_ends_with_marker",
                DEFAULT_SEGMENTATION_OPTIONS["merge_if_prev_ends_with_marker"],
            )
        ),
        "attach_unmarked_to_previous": bool(
            source.get("attach_unmarked_to_previous", DEFAULT_SEGMENTATION_OPTIONS["attach_unmarked_to_previous"])
        ),
    }


def validate_segmentation_options(options: dict[str, Any]) -> None:
    """Valide les regex utilisateur; lève ValueError si invalide."""
    try:
        re.compile(str(options.get("speaker_regex") or ""))
    except re.error as exc:
        raise ValueError(f"Regex locuteur invalide: {exc}") from exc
    if options.get("enable_dash_rule"):
        try:
            re.compile(str(options.get("dash_regex") or ""))
        except re.error as exc:
            raise ValueError(f"Regex tiret invalide: {exc}") from exc


def _ends_with_any_marker(text: str, markers: list[str]) -> bool:
    if not text or not markers:
        return False
    stripped = text.rstrip()
    return any(stripped.endswith(m) for m in markers)


def segment_text_to_utterance_rows(text: str, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    Segmente un transcript en lignes utterance selon options paramétrables.

    Retourne des lignes prêtes pour la table Préparer:
    [{"segment_id": "", "n": 0, "speaker_explicit": "...", "text": "..."}, ...]
    """
    normalized = normalize_segmentation_options(options)
    validate_segmentation_options(normalized)

    speaker_re = re.compile(normalized["speaker_regex"])
    dash_re = re.compile(normalized["dash_regex"]) if normalized["enable_dash_rule"] else None
    markers = normalized["continuation_markers"]
    merge_if_marker = normalized["merge_if_prev_ends_with_marker"]
    attach_unmarked = normalized["attach_unmarked_to_previous"]

    rows: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        s = raw_line.strip()
        if not s:
            continue

        speaker = ""
        payload = s
        is_marked = False

        m = speaker_re.match(s)
        if m and m.lastindex and m.lastindex >= 2:
            speaker = (m.group(1) or "").strip()
            payload = (m.group(2) or "").strip() or s
            is_marked = True
        elif dash_re is not None:
            dm = dash_re.match(s)
            if dm:
                payload = (dm.group(1) or "").strip() or s
                is_marked = True

        if not is_marked and rows:
            if merge_if_marker and _ends_with_any_marker(rows[-1]["text"], markers):
                rows[-1]["text"] = (rows[-1]["text"].rstrip() + "\n" + payload).strip()
                continue
            if attach_unmarked:
                rows[-1]["text"] = (rows[-1]["text"].rstrip() + "\n" + payload).strip()
                continue

        rows.append(
            {
                "segment_id": "",
                "n": len(rows),
                "speaker_explicit": speaker,
                "text": payload,
            }
        )
    return rows


def regroup_utterance_rows_by_character(
    rows: list[dict[str, Any]],
    *,
    character_lookup: dict[str, str],
    assignment_by_segment_id: dict[str, str] | None = None,
    tolerant: bool = True,
) -> list[dict[str, Any]]:
    """
    Regroupe des lignes consécutives en utterances selon changement de personnage assigné.

    `character_lookup` : mapping label lower-case -> character_id.
    """
    grouped: list[dict[str, Any]] = []
    active_character_id: str | None = None
    assignment_map = assignment_by_segment_id or {}

    for row in rows or []:
        segment_id = (row.get("segment_id") or "").strip()
        speaker = (row.get("speaker_explicit") or "").strip()
        text = (row.get("text") or "").strip()
        if not text:
            continue
        assigned_id = assignment_map.get(segment_id, "") if segment_id else ""
        explicit_id = character_lookup.get(speaker.lower(), "") if speaker else ""
        if assigned_id:
            current_id = assigned_id
        elif explicit_id:
            current_id = explicit_id
        elif speaker:
            # Fallback : éviter une fusion globale quand le label n'est pas mappé.
            current_id = f"speaker:{speaker.lower()}"
        else:
            current_id = None

        if grouped:
            if current_id is not None:
                if active_character_id == current_id:
                    grouped[-1]["text"] = (grouped[-1]["text"].rstrip() + "\n" + text).strip()
                    if not grouped[-1]["speaker_explicit"] and speaker:
                        grouped[-1]["speaker_explicit"] = speaker
                    continue
            else:
                if tolerant and active_character_id is not None:
                    grouped[-1]["text"] = (grouped[-1]["text"].rstrip() + "\n" + text).strip()
                    continue

        grouped.append(
            {
                "segment_id": "",
                "n": len(grouped),
                "speaker_explicit": speaker,
                "text": text,
            }
        )
        active_character_id = current_id

    for idx, row in enumerate(grouped):
        row["n"] = idx
        row["segment_id"] = ""
    return grouped
