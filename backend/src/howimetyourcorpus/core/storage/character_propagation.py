"""Propagation des personnages (segments/cues) vers la DB et les fichiers SRT."""

from __future__ import annotations

from typing import Any


def propagate_character_names(
    store: Any,
    db: Any,
    episode_id: str,
    run_id: str,
    languages_to_rewrite: set[str] | None = None,
) -> tuple[int, int]:
    """
    Propagation §8 : à partir des assignations et des liens d'alignement,
    met à jour segments.speaker_explicit et les text_clean des cues, puis réécrit les SRT.
    Si languages_to_rewrite est fourni, seules ces langues ont leur fichier SRT réécrit
    (par défaut toutes les langues modifiées sont réécrites).
    Retourne (nb_segments_updated, nb_cues_updated).
    """
    from howimetyourcorpus.core.subtitles.parsers import cues_to_srt

    assignments = store.load_character_assignments()
    characters = store.load_character_names()
    char_by_id = {ch.get("id") or ch.get("canonical") or "": ch for ch in characters}
    episode_assignments = [a for a in assignments if a.get("episode_id") == episode_id]
    assign_segment: dict[str, str] = {}
    assign_cue: dict[str, str] = {}
    for assignment in episode_assignments:
        character_id = (assignment.get("character_id") or "").strip()
        if not character_id:
            continue
        # Nouveau format (B-002) : segment_id / cue_id
        seg_id_new = (assignment.get("segment_id") or "").strip()
        cue_id_new = (assignment.get("cue_id") or "").strip()
        # Ancien format : source_type / source_id (rétrocompat)
        source_type = assignment.get("source_type") or ""
        source_id = (assignment.get("source_id") or "").strip()
        if seg_id_new:
            assign_segment[seg_id_new] = character_id
        elif cue_id_new:
            assign_cue[cue_id_new] = character_id
        elif source_type == "segment" and source_id:
            assign_segment[source_id] = character_id
        elif source_id:
            assign_cue[source_id] = character_id

    links = db.query_alignment_for_episode(episode_id, run_id=run_id)
    for link in links:
        if link.get("role") == "pivot" and link.get("segment_id") and link.get("cue_id"):
            segment_id = link["segment_id"]
            cue_id = link["cue_id"]
            if segment_id in assign_segment and cue_id not in assign_cue:
                assign_cue[cue_id] = assign_segment[segment_id]

    run = db.get_align_run(run_id)
    pivot_lang = (run.get("pivot_lang") or "en").strip().lower() if run else "en"

    nb_seg = 0
    for segment_id, character_id in assign_segment.items():
        # Écrire le nom canonique (G-003), pas l'ID opaque
        ch = char_by_id.get(character_id) or {}
        canonical_name = ch.get("canonical") or character_id
        db.update_segment_speaker(segment_id, canonical_name)
        nb_seg += 1

    def name_for_lang(character_id: str, lang: str) -> str:
        character = char_by_id.get(character_id) or {}
        names = character.get("names_by_lang") or {}
        return names.get(lang) or character.get("canonical") or character_id

    cues_by_lang: dict[str, list[dict[str, Any]]] = {}
    cues_index_by_lang: dict[str, dict[str, dict[str, Any]]] = {}

    def _load_cues_lang(lang: str) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
        lang_key = (lang or "").strip().lower() or "en"
        if lang_key not in cues_by_lang:
            cues = db.get_cues_for_episode_lang(episode_id, lang_key) or []
            cues_by_lang[lang_key] = cues
            cues_index_by_lang[lang_key] = {
                str(cue.get("cue_id") or ""): cue
                for cue in cues
                if cue.get("cue_id")
            }
        return cues_by_lang[lang_key], cues_index_by_lang[lang_key]

    langs_updated: set[str] = set()
    nb_cue = 0
    _, cues_pivot_by_id = _load_cues_lang(pivot_lang)
    for cue_id, character_id in assign_cue.items():
        cue_row = cues_pivot_by_id.get(cue_id)
        if cue_row:
            text = (cue_row.get("text_clean") or cue_row.get("text_raw") or "").strip()
            prefix = name_for_lang(character_id, pivot_lang) + ": "
            if not text.startswith(prefix):
                new_text = prefix + text
                db.update_cue_text_clean(cue_id, new_text)
                cue_row["text_clean"] = new_text
                nb_cue += 1
                langs_updated.add(pivot_lang)

    for link in links:
        if link.get("role") != "target" or not link.get("cue_id") or not link.get("cue_id_target"):
            continue
        cue_en = link["cue_id"]
        cue_target = link["cue_id_target"]
        lang = (link.get("lang") or "fr").strip().lower()
        if cue_en not in assign_cue:
            continue
        character_id = assign_cue[cue_en]
        name = name_for_lang(character_id, lang)
        _, cues_lang_by_id = _load_cues_lang(lang)
        cue_row = cues_lang_by_id.get(cue_target)
        if cue_row:
            text = (cue_row.get("text_clean") or cue_row.get("text_raw") or "").strip()
            prefix = name + ": "
            if not text.startswith(prefix):
                new_text = prefix + text
                db.update_cue_text_clean(cue_target, new_text)
                cue_row["text_clean"] = new_text
                nb_cue += 1
                langs_updated.add(lang)

    for lang in sorted(langs_updated):
        if languages_to_rewrite is not None and lang not in languages_to_rewrite:
            continue
        cues, _ = _load_cues_lang(lang)
        if cues:
            srt_content = cues_to_srt(cues)
            store.save_episode_subtitle_content(episode_id, lang, srt_content, "srt")

    return nb_seg, nb_cue
