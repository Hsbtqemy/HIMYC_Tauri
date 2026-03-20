"""Helpers de regroupement multi-langues pour les runs d'alignement."""

from __future__ import annotations

import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from howimetyourcorpus.core.storage.project_store import ProjectStore


def generate_align_grouping(
    store: "ProjectStore",
    db: Any,
    episode_id: str,
    run_id: str,
    *,
    tolerant: bool = True,
) -> dict[str, Any]:
    """
    Génère des groupes multi-langues à partir d'un run d'alignement, sans modifier la base.

    Les groupes agrègent des unités contiguës par personnage assigné.
    """
    run = db.get_align_run(run_id)
    if not run:
        raise ValueError(f"Run introuvable: {run_id}")
    pivot_lang = (run.get("pivot_lang") or "en").strip().lower()
    links = db.query_alignment_for_episode(episode_id, run_id=run_id)
    if not links:
        grouping = {
            "episode_id": episode_id,
            "run_id": run_id,
            "pivot_lang": pivot_lang,
            "languages": [pivot_lang],
            "generated_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
            "non_destructive": True,
            "tolerant": bool(tolerant),
            "groups": [],
        }
        store.save_align_grouping(episode_id, run_id, grouping)
        return grouping

    assignments = [
        dict(a)
        for a in store.load_character_assignments()
        if (a.get("episode_id") or "").strip() == episode_id
    ]
    assign_segment: dict[str, str] = {}
    assign_cue: dict[str, str] = {}
    for a in assignments:
        source_type = (a.get("source_type") or "").strip().lower()
        source_id = (a.get("source_id") or "").strip()
        character_id = (a.get("character_id") or "").strip()
        if not source_id or not character_id:
            continue
        if source_type == "segment":
            assign_segment[source_id] = character_id
        elif source_type == "cue":
            assign_cue[source_id] = character_id

    characters = store.load_character_names()
    char_by_id = {
        (ch.get("id") or ch.get("canonical") or "").strip(): ch
        for ch in characters
        if (ch.get("id") or ch.get("canonical") or "").strip()
    }

    pivot_links = [lnk for lnk in links if (lnk.get("role") or "").strip().lower() == "pivot"]
    target_links = [lnk for lnk in links if (lnk.get("role") or "").strip().lower() == "target"]

    # Ordre des unités = ordre naturel des segments (n croissant).
    segments = db.get_segments_for_episode(episode_id)
    seg_by_id = {(s.get("segment_id") or "").strip(): s for s in segments}
    pivot_links.sort(
        key=lambda lnk: int((seg_by_id.get((lnk.get("segment_id") or "").strip(), {}) or {}).get("n") or 0)
    )

    target_by_pivot_cue: dict[str, list[dict[str, Any]]] = {}
    langs: set[str] = {pivot_lang}
    for lnk in target_links:
        cue_pivot = (lnk.get("cue_id") or "").strip()
        lang = (lnk.get("lang") or "").strip().lower()
        if not cue_pivot or not lang:
            continue
        langs.add(lang)
        target_by_pivot_cue.setdefault(cue_pivot, []).append(lnk)

    cues_by_lang: dict[str, dict[str, dict[str, Any]]] = {}
    for lang in sorted(langs):
        cues = db.get_cues_for_episode_lang(episode_id, lang) or []
        cues_by_lang[lang] = {(c.get("cue_id") or "").strip(): c for c in cues}

    def cue_text(cue_row: dict[str, Any] | None) -> str:
        if not cue_row:
            return ""
        return ((cue_row.get("text_clean") or cue_row.get("text_raw") or "")).strip()

    def character_label(character_id: str, lang: str) -> str:
        if not character_id:
            return ""
        ch = char_by_id.get(character_id) or {}
        names = ch.get("names_by_lang") or {}
        if isinstance(names, dict):
            value = (names.get(lang) or "").strip()
            if value:
                return value
        return (ch.get("canonical") or character_id).strip()

    units: list[dict[str, Any]] = []
    for idx, pl in enumerate(pivot_links):
        segment_id = (pl.get("segment_id") or "").strip()
        cue_id_pivot = (pl.get("cue_id") or "").strip()
        if not segment_id:
            continue
        seg = seg_by_id.get(segment_id) or {}
        text_segment = (seg.get("text") or "").strip()
        cues_target_links = target_by_pivot_cue.get(cue_id_pivot, [])

        character_id = assign_segment.get(segment_id, "")
        if not character_id and cue_id_pivot:
            character_id = assign_cue.get(cue_id_pivot, "")
        if not character_id:
            for tl in cues_target_links:
                cue_id_target = (tl.get("cue_id_target") or "").strip()
                if cue_id_target and cue_id_target in assign_cue:
                    character_id = assign_cue[cue_id_target]
                    break

        speaker_fallback = (seg.get("speaker_explicit") or "").strip()
        speaker_label = character_label(character_id, pivot_lang) if character_id else speaker_fallback

        texts_by_lang: dict[str, str] = {pivot_lang: cue_text(cues_by_lang.get(pivot_lang, {}).get(cue_id_pivot))}
        conf_by_lang: dict[str, float | None] = {}

        for tl in cues_target_links:
            lang = (tl.get("lang") or "").strip().lower()
            cue_id_target = (tl.get("cue_id_target") or "").strip()
            if not lang or not cue_id_target:
                continue
            txt = cue_text(cues_by_lang.get(lang, {}).get(cue_id_target))
            if not txt:
                continue
            if texts_by_lang.get(lang):
                if txt not in texts_by_lang[lang]:
                    texts_by_lang[lang] = f"{texts_by_lang[lang]}\n{txt}".strip()
            else:
                texts_by_lang[lang] = txt
            conf = tl.get("confidence")
            conf_by_lang[lang] = float(conf) if conf is not None else None

        units.append(
            {
                "index": idx,
                "segment_id": segment_id,
                "cue_id_pivot": cue_id_pivot,
                "character_id": character_id,
                "speaker_label": speaker_label,
                "text_segment": text_segment,
                "texts_by_lang": texts_by_lang,
                "confidence_pivot": pl.get("confidence"),
                "confidence_by_lang": conf_by_lang,
            }
        )

    groups: list[dict[str, Any]] = []
    active_key: str | None = None
    for unit in units:
        character_id = (unit.get("character_id") or "").strip()
        speaker_label = (unit.get("speaker_label") or "").strip()
        current_key: str | None = None
        if character_id:
            current_key = f"character:{character_id}"
        elif speaker_label:
            current_key = f"speaker:{speaker_label.lower()}"

        if groups:
            if current_key and current_key == active_key:
                target = groups[-1]
                target["segment_ids"].append(unit["segment_id"])
                target["cue_ids_pivot"].append(unit.get("cue_id_pivot") or "")
                if unit.get("text_segment"):
                    target["text_segment"] = (
                        (target.get("text_segment") or "").rstrip() + "\n" + unit["text_segment"]
                    ).strip()
                for lang, txt in (unit.get("texts_by_lang") or {}).items():
                    if not txt:
                        continue
                    by_lang = target.setdefault("texts_by_lang", {})
                    if by_lang.get(lang):
                        by_lang[lang] = (by_lang[lang].rstrip() + "\n" + txt).strip()
                    else:
                        by_lang[lang] = txt
                continue
            if current_key is None and tolerant and active_key is not None:
                target = groups[-1]
                target["segment_ids"].append(unit["segment_id"])
                target["cue_ids_pivot"].append(unit.get("cue_id_pivot") or "")
                if unit.get("text_segment"):
                    target["text_segment"] = (
                        (target.get("text_segment") or "").rstrip() + "\n" + unit["text_segment"]
                    ).strip()
                for lang, txt in (unit.get("texts_by_lang") or {}).items():
                    if not txt:
                        continue
                    by_lang = target.setdefault("texts_by_lang", {})
                    if by_lang.get(lang):
                        by_lang[lang] = (by_lang[lang].rstrip() + "\n" + txt).strip()
                    else:
                        by_lang[lang] = txt
                continue

        group_index = len(groups)
        groups.append(
            {
                "group_id": f"{run_id}:group:{group_index}",
                "character_id": character_id,
                "speaker_label": speaker_label,
                "segment_ids": [unit["segment_id"]],
                "cue_ids_pivot": [unit.get("cue_id_pivot") or ""],
                "text_segment": unit.get("text_segment") or "",
                "texts_by_lang": dict(unit.get("texts_by_lang") or {}),
                "confidence_pivot": unit.get("confidence_pivot"),
                "confidence_by_lang": dict(unit.get("confidence_by_lang") or {}),
            }
        )
        active_key = current_key

    grouping = {
        "episode_id": episode_id,
        "run_id": run_id,
        "pivot_lang": pivot_lang,
        "languages": sorted(langs),
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
        "non_destructive": True,
        "tolerant": bool(tolerant),
        "groups": groups,
    }
    store.save_align_grouping(episode_id, run_id, grouping)
    return grouping


def align_grouping_to_parallel_rows(grouping: dict[str, Any]) -> list[dict[str, Any]]:
    """Convertit un grouping multi-langues en lignes compatibles export concordancier."""
    groups = grouping.get("groups") if isinstance(grouping, dict) else []
    if not isinstance(groups, list):
        return []
    rows: list[dict[str, Any]] = []
    for grp in groups:
        if not isinstance(grp, dict):
            continue
        texts = grp.get("texts_by_lang") or {}
        conf_by_lang = grp.get("confidence_by_lang") or {}
        rows.append(
            {
                "segment_id": grp.get("group_id") or "",
                "speaker": grp.get("speaker_label") or grp.get("character_id") or "",
                "text_segment": grp.get("text_segment") or "",
                "text_en": (texts.get("en") if isinstance(texts, dict) else "") or "",
                "confidence_pivot": grp.get("confidence_pivot"),
                "text_fr": (texts.get("fr") if isinstance(texts, dict) else "") or "",
                "confidence_fr": conf_by_lang.get("fr") if isinstance(conf_by_lang, dict) else None,
                "text_it": (texts.get("it") if isinstance(texts, dict) else "") or "",
                "confidence_it": conf_by_lang.get("it") if isinstance(conf_by_lang, dict) else None,
            }
        )
    return rows
