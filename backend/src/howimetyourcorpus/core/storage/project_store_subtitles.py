"""Helpers ProjectStore pour l'I/O sous-titres et normalisation de piste."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def subs_dir(store: Any, episode_id: str) -> Path:
    """Répertoire episodes/<id>/subs/ pour les sous-titres."""
    return store._episode_dir(episode_id) / "subs"  # noqa: SLF001


def save_episode_subtitles(
    store: Any,
    episode_id: str,
    lang: str,
    content: str,
    fmt: str,
    cues_audit: list[dict[str, Any]],
) -> None:
    """Sauvegarde le fichier sous-titre + audit cues."""
    directory = subs_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    ext = "srt" if fmt == "srt" else "vtt"
    (directory / f"{lang}.{ext}").write_text(content, encoding="utf-8")
    (directory / f"{lang}_cues.jsonl").write_text(
        "\n".join(json.dumps(cue, ensure_ascii=False) for cue in cues_audit),
        encoding="utf-8",
    )


def has_episode_subs(store: Any, episode_id: str, lang: str) -> bool:
    """True si un fichier subs existe pour cet épisode et cette langue."""
    directory = subs_dir(store, episode_id)
    return (directory / f"{lang}.srt").exists() or (directory / f"{lang}.vtt").exists()


def get_episode_subtitle_path(store: Any, episode_id: str, lang: str) -> tuple[Path, str] | None:
    """Retourne (chemin du fichier, 'srt'|'vtt') si la piste existe."""
    directory = subs_dir(store, episode_id)
    srt_path = directory / f"{lang}.srt"
    vtt_path = directory / f"{lang}.vtt"
    if srt_path.exists():
        return (srt_path, "srt")
    if vtt_path.exists():
        return (vtt_path, "vtt")
    return None


def remove_episode_subtitle(store: Any, episode_id: str, lang: str) -> None:
    """Supprime les fichiers sous-titres pour cet épisode/langue."""
    directory = subs_dir(store, episode_id)
    for name in [f"{lang}.srt", f"{lang}.vtt", f"{lang}_cues.jsonl"]:
        path = directory / name
        if path.exists():
            path.unlink()


def load_episode_subtitle_content(store: Any, episode_id: str, lang: str) -> tuple[str, str] | None:
    """Charge le contenu brut SRT/VTT. Retourne (contenu, format) ou None."""
    result = get_episode_subtitle_path(store, episode_id, lang)
    if not result:
        return None
    path, fmt = result
    return (path.read_text(encoding="utf-8"), fmt)


def save_episode_subtitle_content(
    store: Any,
    episode_id: str,
    lang: str,
    content: str,
    fmt: str,
) -> Path:
    """Sauvegarde le contenu brut SRT/VTT (écrase le fichier)."""
    directory = subs_dir(store, episode_id)
    directory.mkdir(parents=True, exist_ok=True)
    ext = "srt" if fmt == "srt" else "vtt"
    path = directory / f"{lang}.{ext}"
    path.write_text(content, encoding="utf-8")
    return path


def normalize_subtitle_track(
    store: Any,
    db: Any,
    episode_id: str,
    lang: str,
    profile_id: str,
    *,
    rewrite_srt: bool = False,
) -> int:
    """
    Applique un profil de normalisation aux cues d'une piste (text_raw -> text_clean).
    Retourne le nombre de cues mises à jour.
    """
    from howimetyourcorpus.core.normalize.profiles import get_profile
    from howimetyourcorpus.core.subtitles.parsers import cues_to_srt

    custom_profiles = store.load_custom_profiles()
    profile = get_profile(profile_id, custom_profiles)
    if not profile:
        return 0
    cues = db.get_cues_for_episode_lang(episode_id, lang)
    if not cues:
        return 0
    count = 0
    for cue in cues:
        raw_text = (cue.get("text_raw") or "").strip()
        clean_text, _, _ = profile.apply(raw_text)
        cue_id = cue.get("cue_id")
        if cue_id:
            db.update_cue_text_clean(cue_id, clean_text)
            count += 1
    if rewrite_srt and count > 0:
        cues = db.get_cues_for_episode_lang(episode_id, lang)
        if cues:
            srt_content = cues_to_srt(cues)
            store.save_episode_subtitle_content(episode_id, lang, srt_content, "srt")
    return count
