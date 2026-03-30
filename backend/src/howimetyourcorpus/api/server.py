"""API serveur HIMYC â€” backend HTTP pour le frontend Tauri (MX-003).

Usage :
    HIMYC_PROJECT_PATH=/path/to/project \\
    HIMYC_API_PORT=8765 uvicorn howimetyourcorpus.api.server:app --port $HIMYC_API_PORT --reload

Le chemin projet est lu depuis la variable d environnement HIMYC_PROJECT_PATH.
Le token HIMYC_API_TOKEN est optionnel (pilote : non requis).
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator

from howimetyourcorpus.core.constants import (
    API_PORT,
    CORPUS_DB_FILENAME,
    DEFAULT_AUDIT_LIMIT,
    DEFAULT_CUES_LIMIT,
    DEFAULT_CUES_WINDOW,
    DEFAULT_NORMALIZE_PROFILE,
    DEFAULT_PIVOT_LANG,
    EPISODES_DIR_NAME,
    EXPORTS_DIR_NAME,
    FACETS_FETCH_LIMIT,
    KWIC_FACETS_WINDOW,
    MAX_AUDIT_LIMIT,
    ALIGN_STATUS_VALUES,
    CLEAN_TEXT_FILENAME,
    MAX_CUES_LIMIT,
    MAX_KWIC_HITS,
    RAW_TEXT_FILENAME,
    SEGMENT_KIND_VALUES,
    SEGMENTS_JSONL_FILENAME,
    SUPPORTED_LANGUAGES,
)
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore
from howimetyourcorpus.core.storage.db_align import _escape_like
from howimetyourcorpus.api.jobs import JOB_TYPES, get_job_store
from howimetyourcorpus.core.adapters.tvmaze import TvmazeAdapter
from howimetyourcorpus.core.adapters.subslikescript import SubslikescriptAdapter
from howimetyourcorpus import __version__ as VERSION

app = FastAPI(
    title="HIMYC API",
    version=VERSION,
    description="Backend HTTP pour le frontend Tauri HIMYC (constitution, inspection, alignement).",
)

# CORS : dev Vite (1421) + Tauri WebView
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1421",
        "tauri://localhost",
        "https://tauri.localhost",
    ],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

# â”€â”€â”€ DÃ©pendances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def _require_project_path() -> Path:
    """Lit HIMYC_PROJECT_PATH depuis l env et valide le dossier."""
    raw = os.environ.get("HIMYC_PROJECT_PATH", "").strip()
    if not raw:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "NO_PROJECT",
                "message": (
                    "Variable d environnement HIMYC_PROJECT_PATH non definie. "
                    f"Lancez : HIMYC_PROJECT_PATH=/chemin/projet uvicorn ... --port {API_PORT}"
                ),
            },
        )
    path = Path(raw)
    if not path.is_dir():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "PROJECT_NOT_FOUND",
                "message": f"Dossier projet introuvable : {raw}",
            },
        )
    return path


def _get_store(path: Path = Depends(_require_project_path)) -> ProjectStore:
    return ProjectStore(path)


def _get_db_optional(path: Path = Depends(_require_project_path)) -> CorpusDB | None:
    """Retourne CorpusDB si corpus.db existe, sinon None (pas bloquant)."""
    db_path = path / CORPUS_DB_FILENAME
    if not db_path.exists():
        return None
    return CorpusDB(db_path)


def _get_db(path: Path = Depends(_require_project_path)) -> CorpusDB:
    """Retourne CorpusDB â€” lÃ¨ve 503 si corpus.db absent (endpoints qui exigent la DB)."""
    db_path = path / CORPUS_DB_FILENAME
    if not db_path.exists():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "NO_DB",
                "message": "corpus.db introuvable â€” indexez d'abord le projet.",
            },
        )
    return CorpusDB(db_path)


def _distinct_speakers_from_segments_jsonl(store: ProjectStore, episode_ids: list[str]) -> list[str]:
    """Locuteurs distincts depuis segments.jsonl (flux API sans upsert SQLite)."""
    if not episode_ids:
        return []
    labels: set[str] = set()
    root = store.root_dir
    for eid in episode_ids:
        path = root / EPISODES_DIR_NAME / eid / SEGMENTS_JSONL_FILENAME
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            sp = (obj.get("speaker_explicit") or "").strip()
            if sp:
                labels.add(sp)
    return sorted(labels)


# â”€â”€â”€ /project/init_corpus_db â€” crÃ©ation paresseuse de corpus.db â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.post("/project/init_corpus_db", summary="CrÃ©e corpus.db si absent (schÃ©ma + migrations)")
def init_corpus_db(
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    """
    Les projets crÃ©Ã©s hors flux PyQt peuvent n'avoir que config.toml / fichiers Ã©pisodes
    sans base SQLite. Les endpoints qui exigent _get_db() renvoient NO_DB tant que ce
    fichier n'existe pas. Cette route applique CorpusDB.init() une fois.
    """
    db_path = store.get_db_path()
    if db_path.exists():
        return {"created": False, "path": str(db_path)}
    db = CorpusDB(db_path)
    db.init()
    return {"created": True, "path": str(db_path)}


# â”€â”€â”€ /health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


# ─── /project/rebuild_segments_fts ──────────────────────────────────────────


@app.post(
    "/project/rebuild_segments_fts",
    summary="Reconstruit l'index FTS5 segments_fts depuis la table segments",
)
def rebuild_segments_fts(
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """
    Exécute la commande FTS5 rebuild pour resynchroniser l'index full-text
    des segments avec la table segments. Utile en cas d'incohérence détectée
    via le bouton Réindexer FTS du concordancier.
    """
    result = db.rebuild_segments_fts()
    return {"ok": True, **result}



@app.get("/health", summary="Healthcheck â€” verifie que le backend est en ligne")
def health() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}


# â”€â”€â”€ /config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get("/config", summary="Configuration du projet courant")
def config(store: ProjectStore = Depends(_get_store)) -> dict[str, Any]:
    extra = store.load_config_extra()
    languages = store.load_project_languages()
    return {
        "project_name":     extra.get("project_name", store.root_dir.name),
        "project_path":     str(store.root_dir),
        "source_id":        extra.get("source_id", ""),
        "series_url":       extra.get("series_url", ""),
        "languages":        languages,
        "normalize_profile": extra.get("normalize_profile", DEFAULT_NORMALIZE_PROFILE),
    }


class _ConfigBody(BaseModel):
    project_name:      str | None = None
    source_id:         str | None = None
    series_url:        str | None = None
    normalize_profile: str | None = None
    languages:         list[str] | None = None


@app.put("/config", summary="Mettre Ã  jour la configuration du projet")
def update_config(
    body: _ConfigBody,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    from howimetyourcorpus.core.normalize.profiles import get_all_profile_ids
    valid_profiles = get_all_profile_ids()
    updates: dict[str, Any] = {}
    if body.project_name is not None:
        n = body.project_name.strip()
        if not n:
            raise HTTPException(422, detail={"error": "EMPTY_NAME", "message": "Le nom du projet ne peut pas Ãªtre vide."})
        updates["project_name"] = n
    if body.source_id is not None:
        updates["source_id"] = body.source_id.strip()
    if body.series_url is not None:
        updates["series_url"] = body.series_url.strip()
    if body.normalize_profile is not None:
        p = body.normalize_profile.strip()
        if p and p not in valid_profiles:
            raise HTTPException(422, detail={"error": "INVALID_PROFILE", "message": f"Profil inconnu : {p}. Disponibles : {', '.join(valid_profiles)}"})
        updates["normalize_profile"] = p
    if updates:
        store.save_config_extra(updates)
    if body.languages is not None:
        langs = [l.strip().lower() for l in body.languages if l.strip()]
        store.save_project_languages(langs)
    # Return updated config
    extra = store.load_config_extra()
    return {
        "project_name":     extra.get("project_name", store.root_dir.name),
        "project_path":     str(store.root_dir),
        "source_id":        extra.get("source_id", ""),
        "series_url":       extra.get("series_url", ""),
        "languages":        store.load_project_languages(),
        "normalize_profile": extra.get("normalize_profile", DEFAULT_NORMALIZE_PROFILE),
    }


# â”€â”€â”€ /normalize/preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _NormalizePreviewBody(BaseModel):
    text: str
    profile: str = DEFAULT_NORMALIZE_PROFILE
    options: dict = {}


@app.post("/normalize/preview", summary="AperÃ§u normalisation sans sauvegarder")
def normalize_preview(body: _NormalizePreviewBody) -> dict[str, Any]:
    """Applique la normalisation sur un texte fourni et retourne le rÃ©sultat sans sauvegarder."""
    from howimetyourcorpus.core.normalize.profiles import get_profile, NormalizationProfile

    profile = get_profile(body.profile) or NormalizationProfile(id=body.profile)
    _bool_fields = {
        "merge_subtitle_breaks", "fix_double_spaces", "fix_french_punctuation",
        "fix_english_punctuation", "normalize_apostrophes", "normalize_quotes",
        "strip_line_spaces", "strip_empty_lines",
    }
    _valid_cases = {"none", "lowercase", "UPPERCASE", "Title Case", "Sentence case"}
    for key, val in body.options.items():
        if key in _bool_fields and isinstance(val, bool):
            setattr(profile, key, val)
        elif key == "case_transform" and val in _valid_cases:
            profile.case_transform = val
    clean, stats, _ = profile.apply(body.text)
    return {"clean": clean, "merges": stats.merges}


# â”€â”€â”€ /segment/preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _SegmentPreviewBody(BaseModel):
    text: str
    lang_hint: str = "en"
    utterance_options: dict[str, Any] | None = None


@app.post("/segment/preview", summary="AperÃ§u segmentation (phrases + tours) sans sauvegarder")
def segment_preview(body: _SegmentPreviewBody) -> dict[str, Any]:
    """
    Segmente le texte fourni en phrases et en tours (utterances) en mÃ©moire,
    sans aucune Ã©criture en base. MÃªme moteur que le job segment_transcript.
    Les tours utilisent les options PrÃ©parer (regex locuteur, tirets, marqueurs) si fournies.
    """
    from howimetyourcorpus.core.preparer.segmentation import normalize_segmentation_options
    from howimetyourcorpus.core.segment.segmenters import (
        segmenter_sentences,
        segmenter_utterances_with_options,
    )

    merged = normalize_segmentation_options(body.utterance_options)
    sentences = segmenter_sentences(body.text, lang_hint=body.lang_hint)
    try:
        utterances = segmenter_utterances_with_options(body.text, "preview", merged)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "n_sentences":  len(sentences),
        "n_utterances": len(utterances),
        "sentences": [
            {"n": s.n, "text": s.text, "speaker_explicit": s.speaker_explicit}
            for s in sentences
        ],
        "utterances": [
            {"n": s.n, "text": s.text, "speaker_explicit": s.speaker_explicit}
            for s in utterances
        ],
    }


class _EpisodeSegmentationOptionsBody(BaseModel):
    source_key: str = "transcript"
    options: dict[str, Any]


@app.get(
    "/episodes/{episode_id}/segmentation_options",
    summary="Options segmentation utterances (Ã©pisode + source)",
)
def get_episode_segmentation_options(
    episode_id: str,
    source_key: str = Query("transcript"),
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    from howimetyourcorpus.core.preparer.segmentation import DEFAULT_SEGMENTATION_OPTIONS

    opts = store.get_episode_segmentation_options(episode_id, source_key, default=DEFAULT_SEGMENTATION_OPTIONS)
    return {"episode_id": episode_id, "source_key": source_key, "options": opts}


@app.put(
    "/episodes/{episode_id}/segmentation_options",
    summary="Enregistrer les options segmentation utterances",
)
def put_episode_segmentation_options(
    episode_id: str,
    body: _EpisodeSegmentationOptionsBody,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    from howimetyourcorpus.core.preparer.segmentation import normalize_segmentation_options, validate_segmentation_options

    try:
        normalized = normalize_segmentation_options(body.options)
        validate_segmentation_options(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    store.set_episode_segmentation_options(episode_id, body.source_key, normalized)
    return {"episode_id": episode_id, "source_key": body.source_key, "options": normalized}


# â”€â”€â”€ /series_index â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get("/series_index", summary="Lire l'index sÃ©rie complet (avec URLs par Ã©pisode)")
def get_series_index(store: ProjectStore = Depends(_get_store)) -> dict[str, Any]:
    from howimetyourcorpus.core.models import SeriesIndex
    index: SeriesIndex = store.load_series_index()
    return {
        "series_title": index.series_title,
        "series_url":   index.series_url,
        "episodes": [
            {
                "episode_id": ep.episode_id,
                "season":     ep.season,
                "episode":    ep.episode,
                "title":      ep.title,
                "url":        ep.url,
                "source_id":  ep.source_id,
            }
            for ep in index.episodes
        ],
    }


class _EpisodeRefBody(BaseModel):
    episode_id: str
    season:     int
    episode:    int
    title:      str = ""
    url:        str = ""
    source_id:  str | None = None


class _SeriesIndexBody(BaseModel):
    series_title: str = ""
    series_url:   str = ""
    episodes:     list[_EpisodeRefBody]


@app.put("/series_index", summary="Sauvegarder l'index sÃ©rie et crÃ©er les rÃ©pertoires Ã©pisodes")
def put_series_index(
    body: _SeriesIndexBody,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex

    if not body.episodes:
        raise HTTPException(422, detail={"error": "EMPTY_EPISODES", "message": "La liste d'Ã©pisodes ne peut pas Ãªtre vide."})

    # Valider les episode_id
    seen: set[str] = set()
    for ep in body.episodes:
        eid = ep.episode_id.strip()
        if not eid:
            raise HTTPException(422, detail={"error": "INVALID_EPISODE_ID", "message": "episode_id ne peut pas Ãªtre vide."})
        if eid in seen:
            raise HTTPException(422, detail={"error": "DUPLICATE_EPISODE_ID", "message": f"episode_id dupliquÃ© : {eid}"})
        seen.add(eid)

    episodes = [
        EpisodeRef(
            episode_id=ep.episode_id.strip(),
            season=ep.season,
            episode=ep.episode,
            title=ep.title.strip(),
            url=ep.url.strip(),
            source_id=ep.source_id,
        )
        for ep in body.episodes
    ]
    index = SeriesIndex(
        series_title=body.series_title.strip(),
        series_url=body.series_url.strip(),
        episodes=episodes,
    )
    store.save_series_index(index)

    # CrÃ©er les rÃ©pertoires Ã©pisodes manquants
    episodes_dir = Path(store.root_dir) / EPISODES_DIR_NAME
    episodes_dir.mkdir(exist_ok=True)
    created: list[str] = []
    for ep in episodes:
        ep_dir = episodes_dir / ep.episode_id
        if not ep_dir.exists():
            ep_dir.mkdir()
            created.append(ep.episode_id)

    return {
        "saved": len(episodes),
        "dirs_created": created,
        "series_title": index.series_title,
    }


# â”€â”€â”€ /episodes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get("/episodes", summary="Liste des episodes avec sources et etats")
def list_episodes(
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB | None = Depends(_get_db_optional),
) -> dict[str, Any]:
    index = store.load_series_index()
    if index is None:
        return {"series_title": None, "episodes": []}

    prep_status: dict[str, dict[str, str]] = {}
    try:
        prep_status = store.load_episode_prep_status()
    except Exception as exc:
        logger.warning("list_episodes: impossible de charger prep_status: %s", exc)

    # Tracks SRT par episode (batch si DB disponible)
    tracks_by_episode: dict[str, list[dict[str, Any]]] = {}
    if db is not None:
        episode_ids = [ep.episode_id for ep in index.episodes]
        try:
            tracks_by_episode = db.get_tracks_for_episodes(episode_ids)
        except Exception as exc:
            logger.warning("list_episodes: impossible de charger les pistes SRT: %s", exc)

    episodes = []
    for ep in index.episodes:
        eid = ep.episode_id
        ep_status = prep_status.get(eid, {})

        # Source transcript â€” Ã©tat dÃ©rivÃ© des fichiers sur disque
        # (le store natif ne supporte pas "segmented", on le dÃ©tecte via segments.jsonl)
        from pathlib import Path as _Path
        _seg_file = _Path(store.root_dir) / EPISODES_DIR_NAME / eid / SEGMENTS_JSONL_FILENAME
        if _seg_file.exists():
            _transcript_state = "segmented"
        elif store.has_episode_clean(eid):
            _transcript_state = "normalized"
        elif store.has_episode_raw(eid):
            _transcript_state = "raw"
        else:
            _transcript_state = ep_status.get("transcript", "unknown")

        sources: list[dict[str, Any]] = [
            {
                "source_key": "transcript",
                # Contenu exploitable = raw et/ou clean (GET /sources/transcript sert aux deux)
                "available": store.has_episode_raw(eid) or store.has_episode_clean(eid),
                "has_clean": store.has_episode_clean(eid),
                "state": _transcript_state,
            }
        ]

        # Sources SRT (depuis DB si disponible)
        for track in tracks_by_episode.get(eid, []):
            lang = track.get("lang", "")
            if lang:
                sources.append(
                    {
                        "source_key": f"srt_{lang}",
                        "available": True,
                        "language": lang,
                        "state": ep_status.get(f"srt_{lang}", "unknown"),
                        "nb_cues": track.get("nb_cues", 0),
                        "format": track.get("fmt", "srt"),
                    }
                )

        episodes.append(
            {
                "episode_id": eid,
                "season": ep.season,
                "episode": ep.episode,
                "title": ep.title,
                "url": ep.url or "",
                "sources": sources,
            }
        )

    return {
        "series_title": index.series_title,
        "episodes": episodes,
    }


# â”€â”€â”€ /episodes/{id}/sources/{source_key} â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/episodes/{episode_id}/sources/{source_key}",
    summary="Contenu d une source (transcript ou SRT)",
)
def get_episode_source(
    episode_id: str,
    source_key: str,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    if source_key == "transcript":
        has_raw = store.has_episode_raw(episode_id)
        has_clean = store.has_episode_clean(episode_id)
        if not has_raw and not has_clean:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "SOURCE_NOT_FOUND",
                    "message": (
                        f"Aucun fichier transcript (raw.txt / clean.txt) pour l'Ã©pisode {episode_id!r}."
                    ),
                },
            )
        return {
            "episode_id": episode_id,
            "source_key": "transcript",
            "raw": store.load_episode_text(episode_id, kind="raw") if has_raw else "",
            "clean": store.load_episode_text(episode_id, kind="clean"),
        }

    if source_key.startswith("srt_"):
        lang = source_key[4:]
        result = store.load_episode_subtitle_content(episode_id, lang)
        if result is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "SOURCE_NOT_FOUND",
                    "message": f"Piste SRT Â« {lang} Â» introuvable pour l episode {episode_id}.",
                },
            )
        content, fmt = result
        return {
            "episode_id": episode_id,
            "source_key": source_key,
            "language": lang,
            "format": fmt,
            "content": content,
        }

    raise HTTPException(
        status_code=400,
        detail={
            "error": "INVALID_SOURCE_KEY",
            "message": (
                f"Cle source invalide : Â« {source_key} Â». "
                "Valeurs valides : transcript, srt_<lang> (ex: srt_en, srt_fr)."
            ),
        },
    )


# â”€â”€â”€ /episodes/{id}/sources/{source_key} POST (import â€” MX-005) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _TranscriptImport(BaseModel):
    content: str | None = None    # texte dÃ©jÃ  dÃ©codÃ© (legacy / coller du texte)
    raw_b64: str | None = None    # fichier encodÃ© base64 : .txt, .docx, .odt
    filename: str = ""            # nom du fichier pour la dÃ©tection du format

    @model_validator(mode="after")
    def _require_one(self) -> "_TranscriptImport":
        if self.content is None and self.raw_b64 is None:
            raise ValueError("'content' ou 'raw_b64' est requis")
        return self


class _SrtImport(BaseModel):
    content: str
    fmt: str = "srt"  # "srt" | "vtt"


# â”€â”€ Extracteurs de fichiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _decode_text_bytes(data: bytes) -> str:
    """DÃ©code des octets texte en dÃ©tectant automatiquement l'encodage.

    StratÃ©gie :
    1. Essai UTF-8 strict â€” si Ã§a passe, c'est UTF-8 (cas le plus frÃ©quent).
    2. Sinon le texte n'est PAS UTF-8 ; chardet est utilisÃ© sans seuil de confiance
       (on sait dÃ©jÃ  que l'UTF-8 a Ã©chouÃ©, l'alternative dÃ©tectÃ©e est forcÃ©ment meilleure).
    3. Repli final sur Windows-1252 si chardet ne trouve rien (meilleur choix pour
       les fichiers occidentaux exportÃ©s depuis Word / Notepad).
    4. Le BOM UTF-8 (U+FEFF) est retirÃ© s'il est prÃ©sent en dÃ©but de texte.
    """
    # 1. UTF-8 strict (inclut l'ASCII pur)
    try:
        text = data.decode("utf-8")
        return text.lstrip("\ufeff")
    except UnicodeDecodeError:
        pass

    # 2. DÃ©tection chardet â€” pas de seuil de confiance car UTF-8 est dÃ©jÃ  exclu
    import chardet
    detected = chardet.detect(data)
    encoding = detected.get("encoding") or "windows-1252"
    text = data.decode(encoding, errors="replace")
    return text.lstrip("\ufeff")


def _extract_docx(data: bytes) -> str:
    """Extrait le texte brut d'un fichier .docx / .docm (python-docx).

    Parcoure rÃ©cursivement tous les Ã©lÃ©ments w:p du corps du document
    (paragraphes normaux, cellules de tableau, zones de texte w:txbx).
    Les sauts de ligne doux (w:br type textWrapping) sont prÃ©servÃ©s en \\n.

    Limite restante : en-tÃªtes, pieds de page et notes de bas de page
    ne sont pas extraits.
    """
    from docx import Document as DocxDocument
    from docx.oxml.ns import qn

    _W_P  = qn("w:p")
    _W_T  = qn("w:t")
    _W_BR = qn("w:br")

    def _iter_paragraphs(element):
        """Parcours en profondeur : yield chaque w:p sans rÃ©curser dans w:p."""
        for child in element:
            if child.tag == _W_P:
                yield child
            else:
                yield from _iter_paragraphs(child)

    def _para_text(para_elem) -> str:
        """Texte d'un w:p : concatÃ¨ne w:t et convertit w:br textWrapping en \\n."""
        parts: list[str] = []
        for el in para_elem.iter():
            if el.tag == _W_T:
                parts.append(el.text or "")
            elif el.tag == _W_BR:
                # Sans attribut w:type ou type="textWrapping" â†’ saut de ligne doux
                if el.get(qn("w:type"), "textWrapping") == "textWrapping":
                    parts.append("\n")
        return "".join(parts)

    doc = DocxDocument(io.BytesIO(data))
    lines = [_para_text(p) for p in _iter_paragraphs(doc.element.body)]
    # On conserve les lignes non vides, mais on laisse les vides entre blocs
    # pour prÃ©server la structure du texte (ex. rÃ©pliques sÃ©parÃ©es par des blancs).
    non_empty = [ln for ln in lines if ln.strip()]
    return "\n".join(non_empty)


def _extract_odt(data: bytes) -> str:
    """Extrait le texte brut d'un fichier .odt (odfpy / teletype).

    Utilise teletype.extractText() sur chaque paragraphe pour capturer
    correctement les <text:span>, listes et Ã©lÃ©ments imbriquÃ©s.
    """
    from odf import teletype as odf_teletype
    from odf.opendocument import load as odf_load
    from odf.text import P
    doc = odf_load(io.BytesIO(data))
    texts: list[str] = []
    for para in doc.getElementsByType(P):
        text = odf_teletype.extractText(para).strip()
        if text:
            texts.append(text)
    return "\n".join(texts)


# Extensions ODF texte non supportÃ©es (Flat ODT non compressÃ©, template ODT)
# .fodt = Flat OpenDocument Text (XML brut, non ZIP) â€” odfpy.load() nÃ©cessite un ZIP
# .ott  = OpenDocument Text Template
# .otp  = OpenDocument Presentation Template (cas exotique)
_UNSUPPORTED_ODT_EXTS = frozenset({".fodt", ".ott", ".otp"})

# Formats Word non supportÃ©s :
# .doc  = Word 97â€“2003 binaire (format BIFF/OLE2, non ZIP)
# .docm  est intentionnellement ABSENT : sa structure ZIP est identique Ã  .docx,
# python-docx peut l'ouvrir et en extraire le texte normalement.
_UNSUPPORTED_DOC_EXTS = frozenset({".doc"})


def _extract_text_from_bytes(data: bytes, filename: str) -> str:
    """Dispatch selon l'extension du fichier.

    Formats supportÃ©s : .txt (tout encodage), .docx, .docm, .odt.
    LÃ¨ve ValueError pour les formats reconnus mais non supportÃ©s
    afin d'afficher un message clair Ã  l'utilisateur.

    PrioritÃ© si raw_b64 et content sont tous les deux fournis : raw_b64 est utilisÃ©.
    """
    ext = Path(filename).suffix.lower() if filename else ""

    if ext in _UNSUPPORTED_ODT_EXTS:
        raise ValueError(
            f"Le format Â« {ext} Â» n'est pas pris en charge. "
            "Enregistrez le document en .odt depuis LibreOffice Writer."
        )
    if ext in _UNSUPPORTED_DOC_EXTS:
        raise ValueError(
            "Le format .doc (Word 97â€“2003) n'est pas pris en charge. "
            "Enregistrez le document en .docx depuis Word ou LibreOffice."
        )

    if ext in (".docx", ".docm"):
        return _extract_docx(data)
    if ext == ".odt":
        return _extract_odt(data)
    # .txt ou extension inconnue : dÃ©tection d'encodage automatique
    return _decode_text_bytes(data)


@app.delete(
    "/episodes/{episode_id}/sources/transcript",
    status_code=200,
    summary="Supprimer le transcript d'un Ã©pisode (G-002)",
)
def delete_transcript(
    episode_id: str,
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Supprime raw.txt, clean.txt et segments.jsonl pour cet Ã©pisode.
    Remet le prep_status Ã  'absent'. N'efface pas les runs d'alignement existants.
    """
    ep_dir = store._episode_dir(episode_id)
    removed: list[str] = []
    for name in (RAW_TEXT_FILENAME, CLEAN_TEXT_FILENAME, SEGMENTS_JSONL_FILENAME):
        path = ep_dir / name
        if path.exists():
            path.unlink()
            removed.append(name)
    # RÃ©initialiser le prep_status pour transcript
    store.set_episode_prep_status(episode_id, "transcript", "absent")
    # Supprimer les segments en DB si elle existe
    if db is not None:
        try:
            db.delete_segments_for_episode(episode_id)
        except Exception:
            pass
    return {"episode_id": episode_id, "source_key": "transcript", "removed": removed}


@app.delete(
    "/episodes/{episode_id}/sources/{source_key}",
    status_code=200,
    summary="Supprimer une piste SRT d'un Ã©pisode (G-002)",
)
def delete_source(
    episode_id: str,
    source_key: str,
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Supprime les fichiers .srt/.vtt et les cues_jsonl pour ce lang.
    RÃ©initialise le prep_status. Supprime aussi les cues en DB et les runs d'alignement liÃ©s.
    """
    if not source_key.startswith("srt_") or len(source_key) < 5:
        raise HTTPException(
            400,
            detail={
                "error": "INVALID_SOURCE_KEY",
                "message": f"ClÃ© source invalide : Â« {source_key} Â». Format attendu : srt_<lang>.",
            },
        )
    lang = source_key[4:]
    store.remove_episode_subtitle(episode_id, lang)
    store.set_episode_prep_status(episode_id, source_key, "absent")
    # Supprimer les cues et les runs d'alignement liÃ©s en DB
    if db is not None:
        try:
            db.delete_subtitle_track(episode_id, lang)
        except Exception:
            pass
        try:
            db.delete_align_runs_for_episode(episode_id)
        except Exception:
            pass
    return {"episode_id": episode_id, "source_key": source_key, "lang": lang}


class _TranscriptPatch(BaseModel):
    clean: str


@app.patch(
    "/episodes/{episode_id}/sources/transcript",
    status_code=200,
    summary="Ã‰diter le texte normalisÃ© (clean) d'un transcript (G-001 / MX-041)",
)
def patch_transcript(
    episode_id: str,
    body: _TranscriptPatch,
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Ã‰crase clean.txt avec le texte fourni.
    Invalide les segments (supprime segments.jsonl + DB segments) car ils seraient pÃ©rimÃ©s.
    Remet le prep_status Ã  'normalized'.
    Le frontend doit relancer le job 'segment' aprÃ¨s coup si besoin.
    """
    if not body.clean.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "EMPTY_CONTENT",
                "message": "Le texte clean ne peut pas Ãªtre vide.",
            },
        )
    ep_dir = store._episode_dir(episode_id)
    if not ep_dir.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": "EPISODE_NOT_FOUND", "message": f"Ã‰pisode inconnu : {episode_id}"},
        )
    # Ã‰crire clean.txt
    (ep_dir / CLEAN_TEXT_FILENAME).write_text(body.clean, encoding="utf-8")
    # Invalider segments.jsonl (devenu pÃ©rimÃ©)
    seg_file = ep_dir / SEGMENTS_JSONL_FILENAME
    if seg_file.exists():
        seg_file.unlink()
    # Invalider les segments en DB
    if db is not None:
        try:
            db.delete_segments_for_episode(episode_id)
        except Exception:
            pass
    store.set_episode_prep_status(episode_id, "transcript", "normalized")
    return {
        "episode_id": episode_id,
        "source_key": "transcript",
        "state": "normalized",
        "chars": len(body.clean),
    }


@app.post(
    "/episodes/{episode_id}/sources/transcript",
    status_code=201,
    summary="Importer un transcript (texte brut) pour un episode",
)
def import_transcript(
    episode_id: str,
    body: _TranscriptImport,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    # RÃ©solution du contenu textuel
    if body.raw_b64 is not None:
        try:
            raw_bytes = base64.b64decode(body.raw_b64)
        except Exception:
            raise HTTPException(
                status_code=422,
                detail={"error": "INVALID_BASE64", "message": "Encodage base64 invalide."},
            )
        try:
            content = _extract_text_from_bytes(raw_bytes, body.filename)
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "EXTRACTION_ERROR",
                    "message": f"Impossible d'extraire le texte du fichier Â« {body.filename} Â» : {exc}",
                },
            )
    else:
        content = body.content or ""

    if not content.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "EMPTY_CONTENT",
                "message": "Le contenu du transcript est vide.",
            },
        )
    ep_dir = store._episode_dir(episode_id)
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / RAW_TEXT_FILENAME).write_text(content, encoding="utf-8")
    store.set_episode_prep_status(episode_id, "transcript", "raw")
    return {"episode_id": episode_id, "source_key": "transcript", "state": "raw"}


@app.post(
    "/episodes/{episode_id}/sources/{source_key}",
    status_code=201,
    summary="Importer une piste SRT/VTT pour un episode",
)
def import_source(
    episode_id: str,
    source_key: str,
    body: _SrtImport,
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB | None = Depends(_get_db_optional),
) -> dict[str, Any]:
    if not source_key.startswith("srt_") or len(source_key) < 5:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_SOURCE_KEY",
                "message": (
                    f"Cle source invalide : Â« {source_key} Â». "
                    "Format attendu : srt_<lang> (ex: srt_en, srt_fr)."
                ),
            },
        )
    lang = source_key[4:]
    fmt = body.fmt if body.fmt in ("srt", "vtt") else "srt"
    if not body.content.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "EMPTY_CONTENT",
                "message": f"Le contenu de la piste {source_key} est vide.",
            },
        )
    store.save_episode_subtitle_content(episode_id, lang, body.content, fmt)
    store.set_episode_prep_status(episode_id, source_key, "raw")

    # Indexer immÃ©diatement dans la DB (si disponible) pour que GET /episodes
    # retourne la nouvelle piste dÃ¨s le prochain refresh du panneau.
    nb_cues = 0
    if db is not None:
        from howimetyourcorpus.core.subtitles.parsers import parse_subtitle_content
        from datetime import datetime, timezone
        try:
            cues, _ = parse_subtitle_content(body.content)
            track_id = f"{episode_id}:{lang}"
            imported_at = datetime.now(timezone.utc).isoformat()
            db.add_track(track_id, episode_id, lang, fmt, imported_at=imported_at)
            db.upsert_cues(track_id, episode_id, lang, cues)
            nb_cues = len(cues)
        except Exception as exc:
            logger.warning(
                "import_source: indexation DB échouée pour %s/%s. Cause : %s",
                episode_id, source_key, exc,
            )

    return {
        "episode_id": episode_id,
        "source_key": source_key,
        "language": lang,
        "fmt": fmt,
        "state": "raw",
        "nb_cues": nb_cues,
    }


# â”€â”€â”€ /episodes/{id}/alignment_runs (MX-009) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/episodes/{episode_id}/alignment_runs",
    summary="Liste les runs d alignement pour un episode",
)
def list_alignment_runs(
    episode_id: str,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    align_dir = store.align_dir(episode_id)
    runs: list[dict[str, Any]] = []
    if align_dir.is_dir():
        import json as _json
        for sub in sorted(align_dir.iterdir()):
            if not sub.is_dir():
                continue
            run_id = sub.name
            # Lire le rapport si prÃ©sent
            report_path = sub / "report.json"
            if report_path.exists():
                try:
                    rep = _json.loads(report_path.read_text(encoding="utf-8"))
                    runs.append({
                        "run_id":       run_id,
                        "episode_id":   episode_id,
                        "pivot_lang":   rep.get("pivot_lang", ""),
                        "target_langs": rep.get("target_langs", []),
                        "segment_kind": rep.get("segment_kind", "sentence"),
                        "created_at":   rep.get("created_at", ""),
                    })
                except Exception:
                    runs.append({"run_id": run_id, "episode_id": episode_id})
    return {"episode_id": episode_id, "runs": runs}


# â”€â”€â”€ Alignment Audit (MX-028) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/episodes/{episode_id}/alignment_runs/{run_id}/stats",
    summary="Statistiques d'un run d'alignement (MX-028)",
)
def get_alignment_run_stats(
    episode_id: str,
    run_id: str,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Retourne nb_links, by_status (auto/accepted/rejected), avg_confidence, n_collisions."""
    stats = db.get_align_stats_for_run(episode_id, run_id)
    collisions = db.get_collisions_for_run(episode_id, run_id)
    # Calcul couverture : % de liens non-rejetÃ©s et non-ignorÃ©s / total pivot
    nb_pivot         = stats.get("nb_pivot", 0)
    # Utiliser by_status_pivot (liens pivot uniquement) pour ne pas biaiser coverage_pct
    # avec les statuts des liens cibles (rejected sur un lien cible ≠ pivot rejeté).
    by_status_pivot  = stats.get("by_status_pivot", stats.get("by_status", {}))
    nb_rejected      = by_status_pivot.get("rejected", 0)
    nb_ignored       = by_status_pivot.get("ignored",  0)
    nb_active        = max(0, nb_pivot - nb_rejected - nb_ignored)
    coverage_pct     = round(nb_active / nb_pivot * 100, 1) if nb_pivot else None
    return {
        **stats,
        "n_collisions": len(collisions),
        "coverage_pct": coverage_pct,
    }


@app.get(
    "/episodes/{episode_id}/alignment_runs/{run_id}/links",
    summary="Liens d'alignement paginÃ©s + enrichis (MX-028)",
)
def get_alignment_run_links(
    episode_id: str,
    run_id: str,
    status: str | None = Query(None, pattern="^(auto|accepted|rejected|ignored)$"),
    q: str | None = Query(None, max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(DEFAULT_AUDIT_LIMIT, ge=1, le=MAX_AUDIT_LIMIT),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Liens enrichis avec texte (segment transcript + cue pivot + cue cible). PaginÃ©s."""
    rows, total = db.get_audit_links(
        episode_id, run_id,
        status_filter=status,
        q=q or None,
        offset=offset,
        limit=limit,
    )
    return {
        "episode_id": episode_id,
        "run_id": run_id,
        "total": total,
        "offset": offset,
        "limit": limit,
        "links": rows,
    }


@app.get(
    "/episodes/{episode_id}/alignment_runs/{run_id}/collisions",
    summary="Collisions d'alignement pour un run (MX-028)",
)
def get_alignment_run_collisions(
    episode_id: str,
    run_id: str,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Retourne les cues pivot avec plusieurs liens target dans le mÃªme lang (collisions)."""
    collisions = db.get_collisions_for_run(episode_id, run_id)
    return {"episode_id": episode_id, "run_id": run_id, "collisions": collisions}


@app.get(
    "/episodes/{episode_id}/alignment_runs/{run_id}/links/positions",
    summary="Positions minimap des liens pivot (MX-047)",
)
def get_link_positions(
    episode_id: str,
    run_id: str,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Retourne (n, status) pour chaque lien pivot â€” usage minimap, sans texte."""
    positions = db.get_link_positions(episode_id, run_id)
    return {"episode_id": episode_id, "run_id": run_id, "positions": positions}


_VALID_LINK_STATUSES = frozenset(ALIGN_STATUS_VALUES)


class _AlignLinkPatchBody(BaseModel):
    status: str | None = None   # "accepted" | "rejected" | "auto" | "ignored"
    note:   str | None = None   # annotation libre (G-008 / MX-049)


@app.patch(
    "/alignment_links/{link_id}",
    summary="Mettre Ã  jour statut et/ou note d'un lien (MX-028 + G-008)",
)
def patch_alignment_link(
    link_id: str,
    body: _AlignLinkPatchBody,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Met Ã  jour le statut et/ou la note d'un lien d'alignement.
    Au moins un des champs (status, note) doit Ãªtre fourni.
    """
    if body.status is None and body.note is None:
        raise HTTPException(422, detail={"error": "NOTHING_TO_UPDATE", "message": "Fournissez au moins status ou note."})
    # Vérifier que le lien existe avant de tenter la mise à jour (évite un 200 silencieux sur ID inconnu)
    with db.connection() as conn:
        exists = conn.execute(
            "SELECT 1 FROM align_links WHERE link_id = ? LIMIT 1", (link_id,)
        ).fetchone()
    if not exists:
        raise HTTPException(404, detail={"error": "LINK_NOT_FOUND", "message": f"Lien {link_id!r} introuvable."})
    result: dict[str, Any] = {"link_id": link_id}
    if body.status is not None:
        if body.status not in _VALID_LINK_STATUSES:
            raise HTTPException(422, detail={"error": "INVALID_STATUS", "message": "status doit Ãªtre accepted, rejected, auto ou ignored."})
        db.set_align_status(link_id, body.status)
        result["status"] = body.status
    if body.note is not None:
        db.set_align_note(link_id, body.note or None)
        result["note"] = body.note
    return result


class _BulkAlignStatusBody(BaseModel):
    """Corps pour la mise Ã  jour groupÃ©e des statuts (MX-039).

    Deux modes exclusifs :
    - ``link_ids`` fourni  â†’ met Ã  jour la liste explicite d'IDs.
    - ``link_ids`` absent  â†’ met Ã  jour tous les liens du run filtrÃ© par ``filter_status``
      et/ou ``conf_lt`` (confidence strictement infÃ©rieure, 0â€“1).
    """

    new_status: str
    link_ids: list[str] | None = None
    filter_status: str | None = None
    conf_lt: float | None = None


@app.patch(
    "/episodes/{episode_id}/alignment_runs/{run_id}/links/bulk",
    summary="Mise Ã  jour groupÃ©e des statuts de liens (MX-039)",
)
def bulk_patch_alignment_links(
    episode_id: str,
    run_id: str,
    body: _BulkAlignStatusBody,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Modifie le statut de plusieurs liens en une seule opÃ©ration atomique.

    - ``new_status``    : statut Ã  appliquer (accepted / rejected / auto / ignored).
    - ``link_ids``      : liste explicite d'IDs Ã  mettre Ã  jour (mode liste).
    - ``filter_status`` : filtre sur le statut courant (mode filtre).
    - ``conf_lt``       : filtre sur la confidence < valeur (mode filtre).

    En mode filtre, si aucun critÃ¨re n'est fourni, tous les liens du run sont mis Ã  jour.
    """
    if body.new_status not in _VALID_LINK_STATUSES:
        raise HTTPException(422, detail={"error": "INVALID_STATUS", "message": f"new_status doit Ãªtre parmi {sorted(_VALID_LINK_STATUSES)}."})
    if body.filter_status is not None and body.filter_status not in _VALID_LINK_STATUSES:
        raise HTTPException(422, detail={"error": "INVALID_STATUS", "message": f"filter_status doit Ãªtre parmi {sorted(_VALID_LINK_STATUSES)}."})
    if body.link_ids is not None and len(body.link_ids) == 0:
        return {"updated": 0, "new_status": body.new_status}

    n = db.bulk_set_align_status(
        run_id,
        episode_id,
        body.new_status,
        link_ids=body.link_ids,
        filter_status=body.filter_status,
        conf_lt=body.conf_lt,
    )
    return {"updated": n, "new_status": body.new_status}


# â”€â”€â”€ Retarget (MX-040) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/episodes/{episode_id}/subtitle_cues",
    summary="Recherche de cues SRT pour un Ã©pisode/lang (MX-040)",
)
def get_subtitle_cues(
    episode_id: str,
    lang: str = Query(..., min_length=1, max_length=20),
    q: str | None = Query(None, max_length=200),
    around_cue_id: str | None = Query(None),
    around_window: int = Query(DEFAULT_CUES_WINDOW, ge=1, le=50),
    limit: int = Query(DEFAULT_CUES_LIMIT, ge=1, le=MAX_CUES_LIMIT),
    offset: int = Query(0, ge=0),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Retourne des cues SRT pour le retarget d'un lien d'alignement.

    Modes :
    - ``q`` : recherche FTS5 sur le texte des cues (prioritaire).
    - ``around_cue_id`` : Â±``around_window`` cues voisins par numÃ©ro de sÃ©quence.
    - Sans filtre : liste paginÃ©e triÃ©e par n.
    """
    rows, total = db.search_subtitle_cues(
        episode_id,
        lang,
        q=q or None,
        around_cue_id=around_cue_id or None,
        around_window=around_window,
        limit=limit,
        offset=offset,
    )
    return {
        "episode_id": episode_id,
        "lang": lang,
        "total": total,
        "offset": offset,
        "limit": limit,
        "cues": rows,
    }


class _CuePatch(BaseModel):
    text_clean: str


@app.patch(
    "/subtitle_cues/{cue_id}",
    summary="Ã‰dite le text_clean d'une cue SRT (MX-042)",
)
def patch_subtitle_cue(
    cue_id: str,
    body: _CuePatch,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Met Ã  jour manuellement le champ text_clean d'une cue SRT."""
    text = body.text_clean.strip()
    db.update_cue_text_clean(cue_id, text)
    return {"cue_id": cue_id, "text_clean": text}


class _RetargetBody(BaseModel):
    cue_id_target: str  # Nouveau cue cible


@app.patch(
    "/alignment_links/{link_id}/retarget",
    summary="RÃ©assigner la cue cible d'un lien d'alignement (MX-040)",
)
def retarget_alignment_link(
    link_id: str,
    body: _RetargetBody,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Met Ã  jour le cue_id_target d'un lien et passe son statut Ã  'accepted'."""
    if not body.cue_id_target.strip():
        raise HTTPException(422, detail={"error": "INVALID_CUE_ID", "message": "cue_id_target est requis."})
    db.update_align_link_cues(link_id, cue_id_target=body.cue_id_target)
    return {"link_id": link_id, "cue_id_target": body.cue_id_target, "status": "accepted"}


# â”€â”€â”€ Concordancier parallÃ¨le (MX-029) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/episodes/{episode_id}/alignment_runs/{run_id}/concordance",
    summary="Concordancier parallÃ¨le segment+pivot+cibles (MX-029)",
)
def get_alignment_concordance(
    episode_id: str,
    run_id: str,
    status: str | None = Query(None, pattern="^(auto|accepted|rejected|ignored)$"),
    q: str | None = Query(None, max_length=200),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """
    Retourne les lignes du concordancier parallÃ¨le :
    segment transcript + cue pivot + cue(s) cible(s) alignÃ©es.
    Optionnel : filtre status (auto/accepted/rejected) + recherche texte q.
    """
    run = db.get_align_run(run_id)
    pivot_lang = (run.get("pivot_lang") or DEFAULT_PIVOT_LANG).strip().lower() if run else DEFAULT_PIVOT_LANG
    # Filtre q et LIMIT délégués à get_parallel_concordance pour limiter la charge mémoire
    rows, has_more = db.get_parallel_concordance(
        episode_id, run_id,
        status_filter=status or None,
        q=q or None,
        limit=MAX_KWIC_HITS,
    )
    return {
        "episode_id": episode_id,
        "run_id": run_id,
        "pivot_lang": pivot_lang,
        "total": len(rows),
        "has_more": has_more,
        "rows": rows,
    }


# â”€â”€â”€ Segments longtext (MX-029) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get(
    "/episodes/{episode_id}/segments",
    summary="Liste des segments d'un Ã©pisode (MX-029)",
)
def get_episode_segments(
    episode_id: str,
    kind: str = Query("sentence", pattern="^(sentence|utterance)$"),
    q: str | None = Query(None, max_length=200),
    db: CorpusDB | None = Depends(_get_db_optional),
) -> dict[str, Any]:
    """
    Retourne les segments d'un Ã©pisode (kind=sentence|utterance).
    Filtre optionnel full-text q (FTS si DB dispo, sinon LIKE).
    """
    if db is None:
        return {"episode_id": episode_id, "kind": kind, "total": 0, "segments": []}
    from howimetyourcorpus.core.storage import db_segments as _db_seg
    conn = db._conn()
    try:
        if q:
            # FTS5 search — q est échappé pour éviter les erreurs de syntaxe FTS5
            from howimetyourcorpus.core.storage.db_kwic import fts5_match_query as _fts5_match_query
            try:
                conn.row_factory = __import__("sqlite3").Row
                fts_rows = conn.execute(
                    "SELECT segment_id FROM segments_fts WHERE episode_id=? AND kind=? AND text MATCH ? ORDER BY rank LIMIT 500",
                    [episode_id, kind, _fts5_match_query(q)],
                ).fetchall()
                ids = [r["segment_id"] for r in fts_rows]
                if ids:
                    placeholders = ",".join("?" * len(ids))
                    segs = conn.execute(
                        f"SELECT segment_id, n, kind, text, speaker_explicit FROM segments WHERE segment_id IN ({placeholders}) ORDER BY n",
                        ids,
                    ).fetchall()
                    segments = [dict(s) for s in segs]
                else:
                    segments = []
            except Exception:
                # FTS fallback: LIKE (avec ESCAPE pour les métacaractères % et _)
                conn.row_factory = __import__("sqlite3").Row
                like = f"%{_escape_like(q)}%"
                segs = conn.execute(
                    "SELECT segment_id, n, kind, text, speaker_explicit FROM segments WHERE episode_id=? AND kind=? AND text LIKE ? ESCAPE '\\' ORDER BY n LIMIT 500",
                    [episode_id, kind, like],
                ).fetchall()
                segments = [dict(s) for s in segs]
        else:
            segments = _db_seg.get_segments_for_episode(conn, episode_id, kind=kind)
    finally:
        conn.close()
    return {"episode_id": episode_id, "kind": kind, "total": len(segments), "segments": segments}


class _SegmentPatch(BaseModel):
    text: str | None = None
    speaker_explicit: str | None = None


@app.patch(
    "/episodes/{episode_id}/segments/{segment_id}",
    summary="Ã‰diter le texte ou le locuteur d'un segment (P2-4)",
)
def patch_segment(
    episode_id: str,
    segment_id: str,
    body: _SegmentPatch,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """
    Met Ã  jour text et/ou speaker_explicit d'un segment.
    Retourne le segment mis Ã  jour.
    """
    from howimetyourcorpus.core.storage import db_segments as _db_seg
    if body.text is None and body.speaker_explicit is None:
        raise HTTPException(status_code=422, detail="Au moins text ou speaker_explicit requis.")
    conn = db._conn()
    try:
        # VÃ©rifier que le segment appartient bien Ã  l'Ã©pisode
        conn.row_factory = __import__("sqlite3").Row
        row = conn.execute(
            "SELECT segment_id FROM segments WHERE segment_id = ? AND episode_id = ?",
            [segment_id, episode_id],
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Segment {segment_id!r} non trouvÃ© pour l'Ã©pisode {episode_id!r}.")
        if body.text is not None:
            _db_seg.update_segment_text(conn, segment_id, body.text.strip())
        if body.speaker_explicit is not None:
            val = body.speaker_explicit.strip() or None
            _db_seg.update_segment_speaker(conn, segment_id, val)
        conn.commit()
        updated = conn.execute(
            "SELECT segment_id, episode_id, kind, n, text, speaker_explicit FROM segments WHERE segment_id = ?",
            [segment_id],
        ).fetchone()
        return dict(updated)
    finally:
        conn.close()


# â”€â”€â”€ /jobs (MX-006) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _JobCreate(BaseModel):
    job_type: str
    episode_id: str
    source_key: str = ""
    params: dict[str, Any] = {}


@app.get("/jobs", summary="Liste des jobs avec statut")
def list_jobs(path: Path = Depends(_require_project_path)) -> dict[str, Any]:
    store = get_job_store(path)
    jobs = [j.to_dict() for j in store.list_all()]
    # Tri : running en premier, puis pending, puis par date desc
    order = {"running": 0, "pending": 1, "done": 2, "error": 3, "cancelled": 4}
    jobs.sort(key=lambda j: (order.get(j["status"], 9), j["created_at"]))
    return {"jobs": jobs}


@app.post("/jobs", status_code=201, summary="Creer un job")
def create_job(
    body: _JobCreate,
    path: Path = Depends(_require_project_path),
) -> dict[str, Any]:
    if body.job_type not in JOB_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_JOB_TYPE",
                "message": (
                    f"Type de job invalide : {body.job_type!r}. "
                    f"Valeurs : {sorted(JOB_TYPES)}"
                ),
            },
        )
    store = get_job_store(path)
    job = store.create(body.job_type, body.episode_id, body.source_key, params=body.params)
    return job.to_dict()


@app.get("/jobs/{job_id}", summary="Statut d un job")
def get_job(
    job_id: str,
    path: Path = Depends(_require_project_path),
) -> dict[str, Any]:
    store = get_job_store(path)
    job = store.get(job_id)
    if not job:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "JOB_NOT_FOUND",
                "message": f"Job {job_id!r} introuvable.",
            },
        )
    return job.to_dict()


@app.delete("/jobs/{job_id}", summary="Annuler un job pending")
def cancel_job(
    job_id: str,
    path: Path = Depends(_require_project_path),
) -> dict[str, Any]:
    store = get_job_store(path)
    if not store.get(job_id):
        raise HTTPException(
            status_code=404,
            detail={"error": "JOB_NOT_FOUND", "message": f"Job {job_id!r} introuvable."},
        )
    cancelled = store.cancel(job_id)
    if not cancelled:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "JOB_NOT_CANCELLABLE",
                "message": "Seuls les jobs en 'pending' peuvent Ãªtre annulÃ©s.",
            },
        )
    return {"job_id": job_id, "status": "cancelled"}


# â”€â”€â”€ /query (MX-022) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

QUERY_SCOPES = frozenset(["episodes", "segments", "cues"])
QUERY_KINDS  = frozenset(SEGMENT_KIND_VALUES)


class _QueryRequest(BaseModel):
    term:           str
    scope:          str       = "segments"
    kind:           str | None = None   # segments uniquement
    lang:           str | None = None   # cues uniquement
    episode_id:     str | None = None   # filtre post-query par episode_id
    speaker:        str | None = None   # filtre post-query par locuteur
    window:         int        = 60
    limit:          int        = 200
    case_sensitive: bool       = False


@app.post("/query", summary="Recherche KWIC concordancier (MX-022)")
def query_corpus(
    body: _QueryRequest,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    term = body.term.strip()
    if not term:
        raise HTTPException(
            status_code=422,
            detail={"error": "EMPTY_TERM", "message": "Le terme de recherche est vide."},
        )
    if body.scope not in QUERY_SCOPES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_SCOPE",
                "message": f"Scope invalide : {body.scope!r}. Valeurs : {sorted(QUERY_SCOPES)}",
            },
        )
    if body.kind and body.kind not in QUERY_KINDS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_KIND",
                "message": f"Kind invalide : {body.kind!r}. Valeurs : {sorted(QUERY_KINDS)}",
            },
        )

    limit = max(1, min(body.limit, MAX_KWIC_HITS))
    window = max(10, min(body.window, MAX_AUDIT_LIMIT))

    cs = body.case_sensitive
    if body.scope == "segments":
        hits = db.query_kwic_segments(term, kind=body.kind, window=window, limit=limit, case_sensitive=cs)
    elif body.scope == "cues":
        hits = db.query_kwic_cues(term, lang=body.lang, window=window, limit=limit, case_sensitive=cs)
    else:
        hits = db.query_kwic(term, window=window, limit=limit, case_sensitive=cs)

    raw_count = len(hits)  # avant post-filtres (pour déterminer si la DB avait plus)

    # Filtres post-query (non délégués à la DB pour éviter la complexité FTS)
    if body.episode_id:
        hits = [h for h in hits if h.episode_id == body.episode_id]
    if body.speaker:
        needle = body.speaker.lower()
        hits = [h for h in hits if h.speaker and needle in h.speaker.lower()]

    # has_more est vrai si la DB a retourné exactement `limit` résultats bruts
    # (il pourrait y en avoir d'autres), indépendamment des filtres post-requête.
    has_more = raw_count >= limit

    from dataclasses import asdict
    return {
        "term":     term,
        "scope":    body.scope,
        "total":    len(hits),
        "has_more": has_more,
        "hits":     [asdict(h) for h in hits],
    }


# â”€â”€â”€ /query/facets (MX-025) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@app.post("/query/facets", summary="Facettes concordancier (MX-025)")
def query_facets(
    body: _QueryRequest,
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """AgrÃ¨ge total_hits, Ã©pisodes distincts, langues distinctes et top-Ã©pisodes."""
    term = body.term.strip()
    if not term:
        raise HTTPException(
            status_code=422,
            detail={"error": "EMPTY_TERM", "message": "Le terme est vide."},
        )

    if body.scope == "segments":
        hits = db.query_kwic_segments(term, kind=body.kind, window=KWIC_FACETS_WINDOW, limit=FACETS_FETCH_LIMIT)
    elif body.scope == "cues":
        hits = db.query_kwic_cues(term, lang=body.lang, window=KWIC_FACETS_WINDOW, limit=FACETS_FETCH_LIMIT)
    else:
        hits = db.query_kwic(term, window=KWIC_FACETS_WINDOW, limit=FACETS_FETCH_LIMIT)

    if body.episode_id:
        hits = [h for h in hits if h.episode_id == body.episode_id]
    if body.speaker:
        needle = body.speaker.lower()
        hits = [h for h in hits if h.speaker and needle in h.speaker.lower()]

    ep_counts: dict[str, dict] = {}
    langs: set[str] = set()
    for h in hits:
        if h.episode_id not in ep_counts:
            ep_counts[h.episode_id] = {"episode_id": h.episode_id, "title": h.title, "count": 0}
        ep_counts[h.episode_id]["count"] += 1
        if h.lang:
            langs.add(h.lang)

    top_episodes = sorted(ep_counts.values(), key=lambda x: x["count"], reverse=True)[:8]

    return {
        "term":               term,
        "scope":              body.scope,
        "total_hits":         len(hits),
        "distinct_episodes":  len(ep_counts),
        "distinct_langs":     len(langs),
        "top_episodes":       top_episodes,
    }


# â”€â”€â”€ /stats (statistiques lexicales) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import re as _re_stats
from collections import Counter as _Counter

_TOKEN_RE = _re_stats.compile(r"[^\W\d_]+", _re_stats.UNICODE)


class _StatsSlot(BaseModel):
    episode_ids: list[str] | None = None  # None = tout le corpus
    kind:        str | None       = None  # "utterance" | "sentence" | None
    speaker:     str | None       = None
    top_n:       int              = 50
    min_length:  int              = 2


class _StatsRequest(BaseModel):
    slot:  _StatsSlot
    label: str = ""


class _StatsCompareRequest(BaseModel):
    a:       _StatsSlot
    b:       _StatsSlot
    label_a: str = "A"
    label_b: str = "B"


def _stats_fetch_texts(conn, slot: _StatsSlot) -> list[str]:
    sql    = "SELECT COALESCE(text,'') FROM segments WHERE 1=1"
    params: list = []
    if slot.episode_ids:
        ph  = ",".join("?" * len(slot.episode_ids))
        sql += f" AND episode_id IN ({ph})"
        params.extend(slot.episode_ids)
    if slot.kind:
        sql += " AND kind = ?"
        params.append(slot.kind)
    if slot.speaker:
        sql += " AND LOWER(COALESCE(speaker_explicit,'')) LIKE ? ESCAPE '\\'"
        params.append(f"%{_escape_like(slot.speaker.lower())}%")
    return [row[0] for row in conn.execute(sql, params).fetchall()]


def _stats_count_episodes(conn, slot: _StatsSlot) -> int:
    sql    = "SELECT COUNT(DISTINCT episode_id) FROM segments WHERE 1=1"
    params: list = []
    if slot.episode_ids:
        ph  = ",".join("?" * len(slot.episode_ids))
        sql += f" AND episode_id IN ({ph})"
        params.extend(slot.episode_ids)
    if slot.kind:
        sql += " AND kind = ?"
        params.append(slot.kind)
    if slot.speaker:
        sql += " AND LOWER(COALESCE(speaker_explicit,'')) LIKE ? ESCAPE '\\'"
        params.append(f"%{_escape_like(slot.speaker.lower())}%")
    return conn.execute(sql, params).fetchone()[0]


def _stats_tokenize(text: str, min_length: int) -> list[str]:
    return [w for w in _TOKEN_RE.findall(text.lower()) if len(w) >= min_length]


def _stats_compute(
    texts: list[str], slot: _StatsSlot, n_episodes: int, label: str = ""
) -> tuple[dict, "_Counter[str]", int]:
    """Retourne (rÃ©sultat_dict, counter, total_tokens) pour Ã©viter une re-tokenisation."""
    tokens: list[str] = []
    for t in texts:
        tokens.extend(_stats_tokenize(t, slot.min_length))
    total   = len(tokens)
    counter = _Counter(tokens)
    vocab   = len(counter)
    top     = counter.most_common(slot.top_n)
    rare    = list(reversed(counter.most_common()))[:slot.top_n]

    def _fmt(pairs: list) -> list[dict]:
        return [
            {"word": w, "count": c,
             "freq_pct": round(c / total * 100, 3) if total else 0.0}
            for w, c in pairs
        ]

    result = {
        "label":                  label,
        "total_tokens":           total,
        "total_segments":         len(texts),
        "total_episodes":         n_episodes,
        "vocabulary_size":        vocab,
        "avg_tokens_per_segment": round(total / len(texts), 1) if texts else 0.0,
        "top_words":              _fmt(top),
        "rare_words":             _fmt(rare),
    }
    return result, counter, total


@app.post("/stats/lexical", summary="Statistiques lexicales d'un corpus ou d'une sÃ©lection")
def stats_lexical(
    body: _StatsRequest,
    db:   CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    with db.connection() as conn:
        texts = _stats_fetch_texts(conn, body.slot)
        if not texts:
            return {"label": body.label, "total_tokens": 0, "total_segments": 0,
                    "total_episodes": 0, "vocabulary_size": 0,
                    "avg_tokens_per_segment": 0.0, "top_words": [], "rare_words": []}
        n_ep         = _stats_count_episodes(conn, body.slot)
        result, _, _ = _stats_compute(texts, body.slot, n_ep, body.label)
    return result


@app.post("/stats/compare", summary="Comparaison lexicale de deux sous-corpus")
def stats_compare(
    body: _StatsCompareRequest,
    db:   CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    with db.connection() as conn:
        texts_a = _stats_fetch_texts(conn, body.a)
        texts_b = _stats_fetch_texts(conn, body.b)
        n_ep_a  = _stats_count_episodes(conn, body.a)
        n_ep_b  = _stats_count_episodes(conn, body.b)

    # _stats_compute retourne aussi le Counter â†’ pas de re-tokenisation
    stats_a, ca, ta = _stats_compute(texts_a, body.a, n_ep_a, body.label_a)
    stats_b, cb, tb = _stats_compute(texts_b, body.b, n_ep_b, body.label_b)

    top_n       = body.a.top_n
    words_union = {w for w, _ in ca.most_common(top_n)} | {w for w, _ in cb.most_common(top_n)}

    comparison: list[dict] = []
    for w in words_union:
        cnt_a = ca.get(w, 0)
        cnt_b = cb.get(w, 0)
        fa    = round(cnt_a / ta * 100, 3) if ta else 0.0
        fb    = round(cnt_b / tb * 100, 3) if tb else 0.0
        ratio = round(fa / fb, 2) if fb > 0 else (999.0 if fa > 0 else 1.0)
        comparison.append({"word": w, "count_a": cnt_a, "count_b": cnt_b,
                           "freq_a": fa, "freq_b": fb, "ratio": ratio})
    comparison.sort(key=lambda x: x["freq_a"] + x["freq_b"], reverse=True)

    return {"label_a": body.label_a, "label_b": body.label_b,
            "a": stats_a, "b": stats_b, "comparison": comparison}


# â”€â”€â”€ /characters (MX-021c) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class _CharacterCatalogBody(BaseModel):
    characters: list[dict[str, Any]]


class _ImportSpeakersBody(BaseModel):
    """Si episode_ids est vide ou absent, tous les Ã©pisodes de l'index sont pris (comportement PyQt)."""

    episode_ids: list[str] | None = None


class _AssignmentsBody(BaseModel):
    assignments: list[dict[str, Any]]


@app.get("/characters", summary="Liste le catalogue personnages (MX-021c)")
def list_characters(store: ProjectStore = Depends(_get_store)) -> dict[str, Any]:
    return {"characters": store.load_character_names()}


@app.put("/characters", summary="Sauvegarde le catalogue personnages (MX-021c)")
def save_characters(
    body: _CharacterCatalogBody,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    try:
        store.save_character_names(body.characters)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_CATALOG", "message": str(exc)},
        ) from exc
    return {"saved": len(body.characters)}


@app.post(
    "/characters/import_from_segments",
    status_code=200,
    summary="Ajoute au catalogue les locuteurs distincts (speaker_explicit) des segments (paritÃ© PyQt)",
)
def import_characters_from_segments(
    body: _ImportSpeakersBody | None = Body(default=None),
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB | None = Depends(_get_db_optional),
) -> dict[str, Any]:
    """MÃªme logique que PersonnagesTabWidget._import_speakers_from_segments."""
    index = store.load_series_index()
    if not index or not index.episodes:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "NO_EPISODES",
                "message": "Aucun Ã©pisode dans l'index. Ajoutez des Ã©pisodes au corpus.",
            },
        )
    b = body or _ImportSpeakersBody()
    episode_ids = list(b.episode_ids) if b.episode_ids else [e.episode_id for e in index.episodes]
    if not episode_ids:
        raise HTTPException(
            status_code=422,
            detail={"error": "NO_EPISODE_IDS", "message": "Liste d'Ã©pisodes vide."},
        )
    speakers: list[str] = []
    if db is not None:
        speakers = db.get_distinct_speaker_explicit(episode_ids)
    if not speakers:
        speakers = _distinct_speakers_from_segments_jsonl(store, episode_ids)
    if not speakers:
        return {
            "added": 0,
            "total_characters": len(store.load_character_names()),
            "distinct_speakers_found": 0,
            "message": (
                "Aucun locuteur (speaker_explicit) dans les segments. "
                "Segmentez d'abord les Ã©pisodes."
            ),
        }
    characters = list(store.load_character_names())
    langs = store.load_project_languages()
    first_lang = (langs[0] if langs else "en").lower()
    existing_canonical_lower = {(ch.get("canonical") or "").strip().lower() for ch in characters}
    existing_id_lower = {(ch.get("id") or "").strip().lower() for ch in characters}
    added = 0
    for name in speakers:
        n = (name or "").strip()
        if not n:
            continue
        norm_id = n.lower().replace(" ", "_")
        if n.lower() in existing_canonical_lower or norm_id in existing_id_lower:
            continue
        row: dict[str, Any] = {
            "id": norm_id,
            "canonical": n,
            "names_by_lang": {first_lang: n},
        }
        characters.append(row)
        existing_canonical_lower.add(n.lower())
        existing_id_lower.add(norm_id)
        added += 1
    if added:
        try:
            store.save_character_names(characters)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail={"error": "INVALID_CATALOG", "message": str(exc)},
            ) from exc
    out: dict[str, Any] = {
        "added": added,
        "total_characters": len(characters),
        "distinct_speakers_found": len(speakers),
    }
    if added == 0:
        out["message"] = "Tous les locuteurs trouvÃ©s sont dÃ©jÃ  dans le catalogue."
    return out


@app.get("/assignments", summary="Liste les assignations personnage (MX-021c)")
def list_assignments(store: ProjectStore = Depends(_get_store)) -> dict[str, Any]:
    return {"assignments": store.load_character_assignments()}


@app.put("/assignments", summary="Sauvegarde les assignations personnage (MX-021c)")
def save_assignments(
    body: _AssignmentsBody,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    try:
        store.save_character_assignments(body.assignments)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_ASSIGNMENTS", "message": str(exc)},
        ) from exc
    return {"saved": len(body.assignments)}


# â”€â”€â”€ /web â€” Sources web (MX-021b) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _TvmazeDiscoverBody(BaseModel):
    series_name: str


class _SubslikeDiscoverBody(BaseModel):
    series_url: str


class _SubslikeFetchBody(BaseModel):
    episode_id: str
    episode_url: str


def _episode_ref_to_dict(ep) -> dict[str, Any]:
    return {
        "episode_id": ep.episode_id,
        "season": ep.season,
        "episode": ep.episode,
        "title": ep.title,
        "url": ep.url,
    }


@app.post("/web/tvmaze/discover", summary="DÃ©couvrir une sÃ©rie via TVMaze (MX-021b)")
def web_tvmaze_discover(body: _TvmazeDiscoverBody) -> dict[str, Any]:
    """Recherche une sÃ©rie par nom sur TVMaze et retourne la liste des Ã©pisodes."""
    name = body.series_name.strip()
    if not name:
        raise HTTPException(
            status_code=422,
            detail={"error": "EMPTY_NAME", "message": "Le nom de la sÃ©rie est requis."},
        )
    try:
        adapter = TvmazeAdapter()
        index = adapter.discover_series(name)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "TVMAZE_ERROR", "message": "Service TVMaze indisponible ou réponse inattendue."},
        ) from exc
    return {
        "series_title": index.series_title,
        "series_url": index.series_url,
        "episode_count": len(index.episodes),
        "episodes": [_episode_ref_to_dict(ep) for ep in index.episodes],
    }


@app.post("/web/subslikescript/discover", summary="DÃ©couvrir une sÃ©rie via Subslikescript (MX-021b)")
def web_subslikescript_discover(body: _SubslikeDiscoverBody) -> dict[str, Any]:
    """Parse la page sÃ©rie Subslikescript et retourne la liste des Ã©pisodes."""
    url = body.series_url.strip()
    if not url:
        raise HTTPException(
            status_code=422,
            detail={"error": "EMPTY_URL", "message": "L'URL de la sÃ©rie est requise."},
        )
    try:
        adapter = SubslikescriptAdapter()
        index = adapter.discover_series(url)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "SUBSLIKE_ERROR", "message": "Service Subslikescript indisponible ou réponse inattendue."},
        ) from exc
    return {
        "series_title": index.series_title,
        "series_url": index.series_url,
        "episode_count": len(index.episodes),
        "episodes": [_episode_ref_to_dict(ep) for ep in index.episodes],
    }


@app.post(
    "/web/subslikescript/fetch_transcript",
    status_code=201,
    summary="TÃ©lÃ©charger et importer un transcript depuis Subslikescript (MX-021b)",
)
def web_subslikescript_fetch_transcript(
    body: _SubslikeFetchBody,
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    """RÃ©cupÃ¨re le transcript d'un Ã©pisode depuis Subslikescript et le sauvegarde dans le projet."""
    episode_id = body.episode_id.strip()
    episode_url = body.episode_url.strip()
    if not episode_id or not episode_url:
        raise HTTPException(
            status_code=422,
            detail={"error": "MISSING_FIELDS", "message": "episode_id et episode_url sont requis."},
        )
    try:
        adapter = SubslikescriptAdapter()
        html = adapter.fetch_episode_html(episode_url)
        raw_text, _meta = adapter.parse_episode(html, episode_url)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "FETCH_ERROR", "message": "Impossible de récupérer le transcript (service externe indisponible ou URL invalide)."},
        ) from exc
    ep_dir = store._episode_dir(episode_id)
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / RAW_TEXT_FILENAME).write_text(raw_text, encoding="utf-8")
    store.set_episode_prep_status(episode_id, "transcript", "raw")
    return {
        "episode_id": episode_id,
        "source_key": "transcript",
        "chars": len(raw_text),
        "state": "raw",
    }


# â”€â”€â”€ /export (MX-021b Exporter) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _ExportBody(BaseModel):
    scope: str = "corpus"          # "corpus" | "segments" | "jobs" | "characters" | "assignments"
    fmt: str = "txt"               # "txt" | "csv" | "json" | "tsv" | "jsonl"
    use_clean: bool = True         # clean.txt si disponible, sinon raw.txt
    episode_ids: list[str] | None = None  # corpus / segments : sous-ensemble (None = tous l'index)


@app.post("/export", status_code=201, summary="Exporter corpus, segments ou jobs (Exporter section)")
def run_export(
    body: _ExportBody,
    path: Path = Depends(_require_project_path),
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    """GÃ©nÃ¨re un fichier d'export dans {project_path}/exports/ et retourne son chemin."""
    import json as _json
    from howimetyourcorpus.core.export_utils import (
        export_corpus_txt, export_corpus_csv, export_corpus_json, export_corpus_docx,
        export_corpus_utterances_jsonl,
        export_segments_txt, export_segments_csv, export_segments_tsv, export_segments_docx,
        _csv_safe,
    )
    from howimetyourcorpus.core.models import EpisodeRef

    scope = body.scope
    fmt = body.fmt
    if scope not in ("corpus", "segments", "jobs", "characters", "assignments"):
        raise HTTPException(422, detail={"error": "INVALID_SCOPE", "message": f"scope invalide: {scope}"})
    if fmt not in ("txt", "csv", "json", "tsv", "docx", "jsonl"):
        raise HTTPException(422, detail={"error": "INVALID_FORMAT", "message": f"format invalide: {fmt}"})

    export_dir = Path(store.root_dir) / EXPORTS_DIR_NAME
    export_dir.mkdir(exist_ok=True)
    out_path = export_dir / f"{scope}.{fmt}"

    # â”€â”€ characters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if scope == "characters":
        if fmt not in ("json", "csv"):
            raise HTTPException(422, detail={"error": "UNSUPPORTED_FORMAT", "message": "Personnages: formats supportÃ©s: json, csv."})
        characters = store.load_character_names()
        if fmt == "json":
            out_path.write_text(_json.dumps({"characters": characters}, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            import csv as _csv
            # Collect all lang keys present across characters
            all_langs: list[str] = []
            for c in characters:
                for lang in (c.get("names_by_lang") or {}).keys():
                    if lang not in all_langs:
                        all_langs.append(lang)
            all_langs.sort()
            with out_path.open("w", encoding="utf-8", newline="") as f:
                w = _csv.writer(f)
                w.writerow(["id", "canonical"] + [f"name_{lg}" for lg in all_langs] + ["aliases"])
                for c in characters:
                    names = c.get("names_by_lang") or {}
                    aliases = ";".join(c.get("aliases") or [])
                    w.writerow(
                        [_csv_safe(c.get("id", "")), _csv_safe(c.get("canonical", ""))]
                        + [_csv_safe(names.get(lg, "")) for lg in all_langs]
                        + [_csv_safe(aliases)]
                    )
        return {"scope": scope, "fmt": fmt, "characters": len(characters), "path": str(out_path)}

    # â”€â”€ assignments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if scope == "assignments":
        if fmt not in ("json", "csv"):
            raise HTTPException(422, detail={"error": "UNSUPPORTED_FORMAT", "message": "Assignations: formats supportÃ©s: json, csv."})
        assignments = store.load_character_assignments()
        if fmt == "json":
            out_path.write_text(_json.dumps({"assignments": assignments}, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            import csv as _csv
            with out_path.open("w", encoding="utf-8", newline="") as f:
                w = _csv.writer(f)
                w.writerow(["character_id", "speaker_label", "episode_id", "segment_id", "cue_id"])
                for a in assignments:
                    # Supports both old (source_type/source_id) and new (segment_id/cue_id) formats
                    seg_id = a.get("segment_id") or (a.get("source_id") if a.get("source_type") == "segment" else "")
                    cue_id = a.get("cue_id") or (a.get("source_id") if a.get("source_type") == "cue" else "")
                    w.writerow([
                        _csv_safe(a.get("character_id", "")),
                        _csv_safe(a.get("speaker_label", "")),
                        _csv_safe(a.get("episode_id", "")),
                        _csv_safe(seg_id or ""),
                        _csv_safe(cue_id or ""),
                    ])
        return {"scope": scope, "fmt": fmt, "assignments": len(assignments), "path": str(out_path)}

    index = store.load_series_index()
    if index is None or not index.episodes:
        raise HTTPException(422, detail={"error": "NO_EPISODES", "message": "Aucun Ã©pisode dans le projet."})

    index_ids = {ep.episode_id for ep in index.episodes}
    ep_filter: set[str] | None = None
    if body.episode_ids is not None:
        if len(body.episode_ids) == 0:
            raise HTTPException(
                422,
                detail={"error": "EMPTY_EPISODE_FILTER", "message": "episode_ids vide : sÃ©lectionnez au moins un Ã©pisode."},
            )
        unknown = [eid for eid in body.episode_ids if eid not in index_ids]
        if unknown:
            raise HTTPException(
                422,
                detail={
                    "error": "INVALID_EPISODE_FILTER",
                    "message": f"Ã‰pisode(s) inconnus dans l'index : {unknown[:5]}",
                },
            )
        ep_filter = set(body.episode_ids)

    if scope == "corpus":
        pairs: list[tuple[EpisodeRef, str]] = []
        for ep in index.episodes:
            if ep_filter is not None and ep.episode_id not in ep_filter:
                continue
            kind = "clean" if (body.use_clean and store.has_episode_clean(ep.episode_id)) else "raw"
            text = store.load_episode_text(ep.episode_id, kind=kind)
            if text.strip():
                pairs.append((ep, text))
        if not pairs:
            raise HTTPException(422, detail={"error": "NO_TEXT", "message": "Aucun texte disponible pour l'export."})
        if fmt == "txt":     export_corpus_txt(pairs, out_path)
        elif fmt == "csv":   export_corpus_csv(pairs, out_path)
        elif fmt == "json":  export_corpus_json(pairs, out_path)
        elif fmt == "docx":  export_corpus_docx(pairs, out_path)
        elif fmt == "jsonl": export_corpus_utterances_jsonl(pairs, out_path)
        else:
            raise HTTPException(422, detail={"error": "UNSUPPORTED_FORMAT", "message": f"Format {fmt} non supportÃ© pour corpus."})
        return {"scope": scope, "fmt": fmt, "episodes": len(pairs), "path": str(out_path)}

    if scope == "jobs":
        job_store_inst = get_job_store(path)
        all_jobs = [j.to_dict() for j in job_store_inst.list_all()]
        if fmt not in ("jsonl", "json"):
            raise HTTPException(422, detail={"error": "UNSUPPORTED_FORMAT", "message": "Jobs: formats supportÃ©s: jsonl, json."})
        out_path = export_dir / f"jobs.{fmt}"
        if fmt == "jsonl":
            lines = "\n".join(_json.dumps(j, ensure_ascii=False) for j in all_jobs)
            out_path.write_text(lines, encoding="utf-8")
        else:
            out_path.write_text(_json.dumps(all_jobs, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"scope": scope, "fmt": fmt, "jobs": len(all_jobs), "path": str(out_path)}

    # scope == "segments"
    all_segments: list[dict[str, Any]] = []
    for ep in index.episodes:
        if ep_filter is not None and ep.episode_id not in ep_filter:
            continue
        seg_path = Path(store.root_dir) / EPISODES_DIR_NAME / ep.episode_id / SEGMENTS_JSONL_FILENAME
        if seg_path.exists():
            for line in seg_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    try:
                        all_segments.append(_json.loads(line))
                    except Exception:
                        pass
    if not all_segments:
        raise HTTPException(422, detail={"error": "NO_SEGMENTS", "message": "Aucun segment disponible. Lancez la segmentation d'abord."})
    if fmt == "txt":     export_segments_txt(all_segments, out_path)
    elif fmt == "csv":   export_segments_csv(all_segments, out_path)
    elif fmt == "tsv":   export_segments_tsv(all_segments, out_path)
    elif fmt == "docx":  export_segments_docx(all_segments, out_path)
    else:
        raise HTTPException(422, detail={"error": "UNSUPPORTED_FORMAT", "message": f"Format {fmt} non supportÃ© pour segments."})
    return {"scope": scope, "fmt": fmt, "segments": len(all_segments), "path": str(out_path)}


# â”€â”€â”€ /export/qa (MX-027) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get("/export/qa", summary="Rapport QA corpus (MX-027)")
def export_qa_report(
    policy: str = Query("lenient", pattern="^(strict|lenient)$"),
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB | None = Depends(_get_db_optional),
) -> dict[str, Any]:
    """Diagnostics corpus : Ã©tat normalisation, segmentation, alignement."""
    import json as _json

    index = store.load_series_index()
    if index is None or not index.episodes:
        # En lenient, pas de bandeau Â« bloquant Â» : projet vide = avertissement seulement.
        empty_gate = "warnings" if policy == "lenient" else "blocking"
        empty_level = "warning" if policy == "lenient" else "blocking"
        return {
            "gate": empty_gate,
            "policy": policy,
            "total_episodes": 0,
            "n_raw": 0,
            "n_normalized": 0,
            "n_segmented": 0,
            "n_with_srts": 0,
            "n_alignment_runs": 0,
            "issues": [{"level": empty_level, "code": "NO_EPISODES", "message": "Aucun Ã©pisode dans le projet."}],
        }

    episodes = index.episodes
    n_total = len(episodes)
    n_raw = n_normalized = n_segmented = n_with_srts = n_alignment_runs = 0
    issues: list[dict[str, Any]] = []

    # Batch SRT tracks from DB
    tracks_by_episode: dict[str, list[dict[str, Any]]] = {}
    if db is not None:
        try:
            tracks_by_episode = db.get_tracks_for_episodes([ep.episode_id for ep in episodes])
        except Exception as exc:
            logger.warning("export/qa: impossible de charger les pistes SRT depuis la DB: %s", exc)

    for ep in episodes:
        eid = ep.episode_id
        has_raw = store.has_episode_raw(eid)
        has_clean = store.has_episode_clean(eid)
        seg_path = Path(store.root_dir) / EPISODES_DIR_NAME / eid / SEGMENTS_JSONL_FILENAME
        has_segments = seg_path.exists() and seg_path.stat().st_size > 0

        # SRT coverage
        if tracks_by_episode.get(eid):
            n_with_srts += 1

        # Alignment runs
        align_dir = store.align_dir(eid)
        if align_dir.is_dir():
            for sub in align_dir.iterdir():
                if sub.is_dir() and (sub / "report.json").exists():
                    n_alignment_runs += 1

        # Ne pas exiger raw.txt si clean ou segments existent (workflow sans fichier raw conservÃ©).
        has_any_transcript = bool(has_raw or has_clean or has_segments)
        if not has_any_transcript:
            # Ã‰pisode listÃ© dans lâ€™index TV sans aucun contenu sur disque (catalogue seul).
            level = "blocking" if policy == "strict" else "warning"
            issues.append({
                "level": level,
                "code": "NO_EPISODE_CONTENT",
                "episode": eid,
                "message": f"Aucun transcript (raw/clean/segments) : {eid}",
            })
            continue

        if has_segments:
            n_segmented += 1
        elif has_clean:
            n_normalized += 1
            level = "warning"
            issues.append({
                "level": level,
                "code": "NOT_SEGMENTED",
                "episode": eid,
                "message": f"Non segmentÃ© : {eid}",
            })
        else:
            n_raw += 1
            level = "blocking" if policy == "strict" else "warning"
            issues.append({
                "level": level,
                "code": "NOT_NORMALIZED",
                "episode": eid,
                "message": f"Non normalisÃ© : {eid}",
            })

    has_blocking = any(i["level"] == "blocking" for i in issues)
    has_warnings = any(i["level"] == "warning" for i in issues)
    # Politique lenient : jamais de gate Â« blocking Â» (export reste possible ; dÃ©tails dans issues).
    if policy == "lenient":
        has_blocking = False
    gate = "blocking" if has_blocking else ("warnings" if has_warnings else "ok")

    return {
        "gate": gate,
        "policy": policy,
        "total_episodes": n_total,
        "n_raw": n_raw,
        "n_normalized": n_normalized,
        "n_segmented": n_segmented,
        "n_with_srts": n_with_srts,
        "n_alignment_runs": n_alignment_runs,
        "issues": issues,
    }


# â”€â”€â”€ /assignments/auto (MX-032) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.post("/assignments/auto", status_code=200, summary="Auto-assignation speaker_explicit â†’ personnages (MX-032)")
def auto_assign_characters(
    dry_run: bool = Query(False, description="Simuler sans sauvegarder"),
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """
    Parcourt tous les segments du projet, compare speaker_explicit avec le catalogue
    personnages (id / canonical / names_by_lang / aliases, insensible Ã  la casse),
    et crÃ©e les assignations manquantes de type source_type=segment.
    Les assignations existantes ne sont pas modifiÃ©es.
    Si dry_run=true, retourne uniquement les statistiques sans sauvegarder.
    """
    characters = store.load_character_names()
    if not characters:
        raise HTTPException(422, detail={"error": "NO_CHARACTERS", "message": "Aucun personnage dÃ©fini."})

    # Build lowercase label â†’ character_id lookup
    label_to_char: dict[str, str] = {}
    for char in characters:
        char_id = (char.get("id") or char.get("canonical") or "").strip()
        if not char_id:
            continue
        labels: set[str] = {char_id, char.get("canonical") or ""}
        labels.update((char.get("names_by_lang") or {}).values())
        labels.update(char.get("aliases") or [])
        for label in labels:
            clean = (label or "").strip()
            if clean:
                label_to_char[clean.lower()] = char_id

    index = store.load_series_index()
    if index is None or not index.episodes:
        return {"created": 0, "unmatched_labels": [], "dry_run": dry_run}

    # Load existing assignments to skip duplicates.
    # RÃ©trocompat : les anciens enregistrements peuvent utiliser source_type/source_id
    # ou le nouveau format segment_id/cue_id.
    existing = store.load_character_assignments()
    existing_seg_ids: set[str] = set()
    for a in existing:
        seg_id = a.get("segment_id") or a.get("source_id") or ""
        if seg_id:
            existing_seg_ids.add(str(seg_id))

    new_assignments: list[dict[str, Any]] = []
    unmatched: set[str] = set()
    created = 0

    for ep in index.episodes:
        segments = db.get_segments_for_episode(ep.episode_id)
        for seg in segments:
            speaker = (seg.get("speaker_explicit") or "").strip()
            if not speaker:
                continue
            char_id = label_to_char.get(speaker.lower())
            if not char_id:
                unmatched.add(speaker)
                continue
            seg_id = seg["segment_id"]
            if seg_id in existing_seg_ids:
                continue
            new_assignments.append({
                "segment_id":   seg_id,
                "character_id": char_id,
                "episode_id":   ep.episode_id,
                "speaker_label": speaker,
            })
            existing_seg_ids.add(seg_id)
            created += 1

    if new_assignments and not dry_run:
        store.save_character_assignments(existing + new_assignments)

    return {
        "created": created,
        "total_after": len(existing) + (created if not dry_run else 0),
        "unmatched_labels": sorted(unmatched),
        "dry_run": dry_run,
    }


# â”€â”€â”€ /episodes/{id}/propagate_characters (MX-031) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class _PropagateBody(BaseModel):
    run_id: str


@app.post(
    "/episodes/{episode_id}/propagate_characters",
    status_code=200,
    summary="Propage les personnages vers segments/cues et rÃ©Ã©crit les SRT (MX-031 + G-003)",
)
def propagate_characters(
    episode_id: str,
    body: _PropagateBody,
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """
    Ã€ partir des assignations et des liens d'alignement du run :
    - Met Ã  jour segments.speaker_explicit avec le nom canonique du personnage
    - PrÃ©fixe les text_clean des cues alignÃ©es avec le nom par langue
    - RÃ©Ã©crit les fichiers SRT dans le projet
    Retourne le nombre de segments et de cues mis Ã  jour.
    """

    run = db.get_align_run(body.run_id)
    if run is None or run.get("episode_id") != episode_id:
        raise HTTPException(404, detail={"error": "RUN_NOT_FOUND", "message": f"Run {body.run_id!r} introuvable pour l'Ã©pisode {episode_id!r}."})

    nb_seg, nb_cue = store.propagate_character_names(db, episode_id, body.run_id)
    return {
        "episode_id": episode_id,
        "run_id": body.run_id,
        "nb_segments_updated": nb_seg,
        "nb_cues_updated": nb_cue,
    }


# â”€â”€â”€ /alignment_runs (MX-030) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get("/alignment_runs", summary="Toutes les runs d'alignement du projet (MX-030)")
def list_all_alignment_runs(
    store: ProjectStore = Depends(_get_store),
    db: CorpusDB = Depends(_get_db),
) -> dict[str, Any]:
    """Retourne toutes les runs d'alignement pour tous les Ã©pisodes du projet."""
    index = store.load_series_index()
    if index is None or not index.episodes:
        return {"runs": []}
    episode_ids = [ep.episode_id for ep in index.episodes]
    runs_by_ep = db.get_align_runs_for_episodes(episode_ids)
    all_runs: list[dict[str, Any]] = []
    for ep in index.episodes:
        for r in runs_by_ep.get(ep.episode_id, []):
            all_runs.append(r)
    return {"runs": all_runs}


# â”€â”€â”€ /export/alignments (MX-030) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@app.get("/export/alignments", summary="Export CSV/TSV du concordancier parallÃ¨le d'un run (MX-030)")
def export_alignments(
    episode_id: str = Query(..., description="ID de l'Ã©pisode"),
    run_id: str = Query(..., description="ID du run d'alignement"),
    fmt: str = Query("csv", pattern="^(csv|tsv)$"),
    db: CorpusDB = Depends(_get_db),
    store: ProjectStore = Depends(_get_store),
) -> dict[str, Any]:
    """GÃ©nÃ¨re un fichier CSV ou TSV du concordancier parallÃ¨le pour un run d'alignement."""
    import csv as _csv
    import io as _io


    rows, _has_more = db.get_parallel_concordance(episode_id, run_id)
    if not rows:
        raise HTTPException(422, detail={"error": "NO_DATA", "message": "Aucun lien d'alignement pour ce run."})

    export_dir = Path(store.root_dir) / EXPORTS_DIR_NAME
    export_dir.mkdir(exist_ok=True)
    out_path = export_dir / f"alignments_{episode_id}_{run_id[:8]}.{fmt}"

    run = db.get_align_run(run_id)
    pivot_lang = (run.get("pivot_lang") or DEFAULT_PIVOT_LANG).strip().lower() if run else DEFAULT_PIVOT_LANG
    # Determine present langs from data (pivot first, then others alphabetically)
    present_langs = [pivot_lang] + sorted(
        lg for lg in SUPPORTED_LANGUAGES if lg != pivot_lang and any(r.get(f"text_{lg}") for r in rows)
    )

    sep = "," if fmt == "csv" else "\t"
    # Dynamic fieldnames: fixed prefix, then per-lang text+confidence columns
    fieldnames = ["segment_id", "speaker", "text_segment"]
    for lg in present_langs:
        fieldnames.append(f"text_{lg}")
        fieldnames.append("confidence_pivot" if lg == pivot_lang else f"confidence_{lg}")
    buf = _io.StringIO()
    writer = _csv.DictWriter(buf, fieldnames=fieldnames, delimiter=sep, extrasaction="ignore",
                              lineterminator="\n")
    writer.writeheader()
    from howimetyourcorpus.core.export_utils import _csv_safe as _align_csv_safe
    for row in rows:
        # Stringify confidence values (all possible lang columns)
        r = dict(row)
        for k in ("confidence_pivot", "confidence_en", "confidence_fr", "confidence_it"):
            if r.get(k) is not None:
                r[k] = f"{r[k]:.4f}"
            else:
                r[k] = ""
        # Protection injection CSV sur les champs texte
        for k in ("segment_id", "speaker", "text_segment", "text_en", "text_fr", "text_it"):
            if k in r:
                r[k] = _align_csv_safe(r[k])
        writer.writerow(r)

    out_path.write_text(buf.getvalue(), encoding="utf-8")
    return {
        "episode_id": episode_id,
        "run_id": run_id,
        "fmt": fmt,
        "rows": len(rows),
        "path": str(out_path),
    }
