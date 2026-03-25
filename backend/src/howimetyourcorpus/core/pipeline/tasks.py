"""Tâches concrètes du pipeline : FetchIndex, FetchEpisode, Normalize, BuildIndex, Segment (Phase 2)."""

from __future__ import annotations

import datetime
import json
import logging
from pathlib import Path
from typing import Callable

from howimetyourcorpus.core.constants import (
    CLEAN_TEXT_FILENAME,
    DEFAULT_NORMALIZE_PROFILE,
    EPISODES_DIR_NAME,
    SEGMENTS_JSONL_FILENAME,
)
from howimetyourcorpus.core.adapters.base import AdapterRegistry
from howimetyourcorpus.core.models import EpisodeRef, EpisodeStatus, ProjectConfig, SeriesIndex
from howimetyourcorpus.core.normalize.profiles import get_profile
from howimetyourcorpus.core.pipeline.context import PipelineContext
from howimetyourcorpus.core.pipeline.steps import Step, StepResult
from howimetyourcorpus.core.preparer.segmentation import DEFAULT_SEGMENTATION_OPTIONS
from howimetyourcorpus.core.segment import Segment, segmenter_sentences, segmenter_utterances_with_options
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore
from howimetyourcorpus.core.opensubtitles import OpenSubtitlesClient, OpenSubtitlesError
from howimetyourcorpus.core.subtitles import cues_to_audit_rows, parse_subtitle_content
from howimetyourcorpus.core.subtitles.parsers import read_subtitle_file_content

logger = logging.getLogger(__name__)


def _segments_by_kind_from_jsonl(segments_path: Path) -> tuple[list[Segment], list[Segment]]:
    """Lit ``segments.jsonl`` en listes ``sentence`` / ``utterance`` pour upsert SQLite."""
    sentences: list[Segment] = []
    utterances: list[Segment] = []
    text = segments_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = obj.get("kind") or "sentence"
        seg = Segment(
            episode_id=str(obj.get("episode_id", "")),
            kind=kind if kind in ("sentence", "utterance") else "sentence",
            n=int(obj.get("n", 0)),
            start_char=int(obj.get("start_char", 0)),
            end_char=int(obj.get("end_char", 0)),
            text=str(obj.get("text") or ""),
            speaker_explicit=obj.get("speaker_explicit"),
            meta=obj.get("meta") if isinstance(obj.get("meta"), dict) else {},
        )
        if seg.kind == "utterance":
            utterances.append(seg)
        else:
            sentences.append(seg)
    sentences.sort(key=lambda s: s.n)
    utterances.sort(key=lambda s: s.n)
    return sentences, utterances


class FetchSeriesIndexStep(Step):
    """Récupère la page série, parse, sauvegarde series_index.json."""

    name = "fetch_series_index"

    def __init__(self, series_url: str, user_agent: str | None = None) -> None:
        self.series_url = series_url
        self.user_agent = user_agent

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        config: ProjectConfig = context["config"]
        adapter = AdapterRegistry.get(config.source_id)
        if not adapter:
            return StepResult(False, f"Adapter not found: {config.source_id}")

        def log(level: str, msg: str) -> None:
            if on_log:
                on_log(level, msg)
            getattr(logger, level.lower(), logger.info)(msg)

        series_url = (self.series_url or config.series_url or "").strip()
        # Projet exemple : pas d'appel réseau, on reprend l'index déjà présent
        if "example.com" in series_url:
            if on_progress:
                on_progress(self.name, 0.0, "Projet exemple : utilisation de l'index local...")
            index = store.load_series_index()
            if not index or not index.episodes:
                return StepResult(
                    False,
                    "Projet exemple : l'URL example.com n'est pas accessible. L'index est dans series_index.json ; "
                    "si le projet est vide, lancez « reset_example.py » ou « create_demo_db.py ».",
                )
            if on_progress:
                on_progress(self.name, 1.0, f"Index local : {len(index.episodes)} épisode(s)")
        else:
            if on_progress:
                on_progress(self.name, 0.0, "Discovering episodes...")
            try:
                rate_limit = getattr(config, "rate_limit_s", 2.0)
                cache_dir = store.get_cache_dir() if store else None
                index = adapter.discover_series(
                    series_url,
                    user_agent=self.user_agent or config.user_agent,
                    rate_limit_s=rate_limit,
                    cache_dir=cache_dir,
                )
            except Exception as e:
                log("error", str(e))
                return StepResult(False, str(e))
        # Marquer chaque épisode avec la source du projet (multi-sources §7.2)
        for ref in index.episodes:
            if ref.source_id is None:
                ref.source_id = config.source_id
        store.save_series_index(index)
        for ref in index.episodes:
            context.get("db") and context["db"].upsert_episode(ref, EpisodeStatus.NEW.value)
        if on_progress:
            on_progress(self.name, 1.0, f"Found {len(index.episodes)} episodes")
        return StepResult(True, f"Index saved: {len(index.episodes)} episodes", {"series_index": index})


class FetchAndMergeSeriesIndexStep(Step):
    """Découvre une série depuis une autre source/URL et fusionne avec l'index existant (sans écraser)."""

    name = "fetch_and_merge_series_index"

    def __init__(self, series_url: str, source_id: str, user_agent: str | None = None) -> None:
        self.series_url = series_url
        self.source_id = source_id
        self.user_agent = user_agent

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        config: ProjectConfig = context["config"]
        adapter = AdapterRegistry.get(self.source_id)
        if not adapter:
            return StepResult(False, f"Adapter not found: {self.source_id}")

        def log(level: str, msg: str) -> None:
            if on_log:
                on_log(level, msg)
            getattr(logger, level.lower(), logger.info)(msg)

        if on_progress:
            on_progress(self.name, 0.0, "Discovering episodes from source...")
        try:
            rate_limit = getattr(config, "rate_limit_s", 2.0)
            cache_dir = store.get_cache_dir() if store else None
            new_index = adapter.discover_series(
                self.series_url,
                user_agent=self.user_agent or config.user_agent,
                rate_limit_s=rate_limit,
                cache_dir=cache_dir,
            )
        except Exception as e:
            log("error", str(e))
            return StepResult(False, str(e))

        # Marquer chaque épisode découvert avec cette source
        refs_from_source = [
            EpisodeRef(
                episode_id=e.episode_id,
                season=e.season,
                episode=e.episode,
                title=e.title,
                url=e.url,
                source_id=self.source_id,
            )
            for e in new_index.episodes
        ]
        existing = store.load_series_index()
        existing_ids = {e.episode_id for e in (existing.episodes or [])} if existing else set()
        merged_episodes = list(existing.episodes or []) if existing else []
        added = 0
        for ref in refs_from_source:
            if ref.episode_id not in existing_ids:
                merged_episodes.append(ref)
                existing_ids.add(ref.episode_id)
                added += 1

        merged = SeriesIndex(
            series_title=existing.series_title if existing else new_index.series_title,
            series_url=existing.series_url if existing else new_index.series_url,
            episodes=merged_episodes,
        )
        store.save_series_index(merged)
        db = context.get("db")
        if db:
            for ref in refs_from_source:
                db.upsert_episode(ref, EpisodeStatus.NEW.value)
        if on_progress:
            on_progress(self.name, 1.0, f"Merged: {added} new, {len(merged_episodes)} total")
        return StepResult(True, f"Merged: {added} new episode(s), {len(merged_episodes)} total", {"series_index": merged})


class FetchEpisodeStep(Step):
    """Télécharge une page épisode, extrait raw, sauvegarde (skip si déjà présent sauf force)."""

    name = "fetch_episode"

    def __init__(self, episode_id: str, episode_url: str) -> None:
        self.episode_id = episode_id
        self.episode_url = episode_url

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        config: ProjectConfig = context["config"]
        db: CorpusDB | None = context.get("db")
        source_id = config.source_id
        index = store.load_series_index()
        if index and index.episodes:
            ref = next((e for e in index.episodes if e.episode_id == self.episode_id), None)
            if ref and ref.source_id:
                source_id = ref.source_id
        adapter = AdapterRegistry.get(source_id)
        if not adapter:
            return StepResult(False, f"Adapter not found: {source_id}")
        if not force and store.has_episode_raw(self.episode_id):
            if on_progress:
                on_progress(self.name, 1.0, f"Skip (already fetched): {self.episode_id}")
            if db:
                db.set_episode_status(self.episode_id, EpisodeStatus.FETCHED.value)
            return StepResult(True, f"Already fetched: {self.episode_id}")

        def log(level: str, msg: str) -> None:
            if on_log:
                on_log(level, msg)

        if on_progress:
            on_progress(self.name, 0.0, f"Fetching {self.episode_id}...")
        try:
            config = context.get("config")
            rate_limit = getattr(config, "rate_limit_s", 2.0) if config else 2.0
            cache_dir = store.get_cache_dir() if store else None
            html = adapter.fetch_episode_html(
                self.episode_url,
                user_agent=getattr(config, "user_agent", None) if config else None,
                rate_limit_s=rate_limit,
                cache_dir=cache_dir,
            )
            store.save_episode_html(self.episode_id, html)
            raw_text, meta = adapter.parse_episode(html, self.episode_url)
            store.save_episode_raw(self.episode_id, raw_text, meta)
            if db:
                db.set_episode_status(self.episode_id, EpisodeStatus.FETCHED.value)
            if on_progress:
                on_progress(self.name, 1.0, f"Fetched: {self.episode_id}")
            return StepResult(True, f"Fetched: {self.episode_id}", {"meta": meta})
        except Exception as e:
            if db:
                db.set_episode_status(self.episode_id, EpisodeStatus.ERROR.value)
            logger.exception("Fetch episode failed")
            return StepResult(False, str(e))


class NormalizeEpisodeStep(Step):
    """Normalise un épisode (raw -> clean), sauvegarde (skip si clean existe sauf force)."""

    name = "normalize_episode"

    def __init__(
        self,
        episode_id: str,
        profile_id: str,
        normalize_options: dict | None = None,
    ) -> None:
        self.episode_id = episode_id
        self.profile_id = profile_id
        self.normalize_options: dict = normalize_options or {}

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        db: CorpusDB | None = context.get("db")
        custom = context.get("custom_profiles") or {}
        profile = get_profile(self.profile_id, custom)
        if not profile:
            return StepResult(False, f"Profile not found: {self.profile_id}")
        # Appliquer les surcharges par-job (options individuelles)
        _bool_fields = {
            "merge_subtitle_breaks", "fix_double_spaces", "fix_french_punctuation",
            "fix_english_punctuation", "normalize_apostrophes", "normalize_quotes",
            "strip_line_spaces", "strip_empty_lines",
        }
        _valid_cases = {"none", "lowercase", "UPPERCASE", "Title Case", "Sentence case"}
        for key, val in self.normalize_options.items():
            if key in _bool_fields and isinstance(val, bool):
                setattr(profile, key, val)
            elif key == "case_transform" and val in _valid_cases:
                profile.case_transform = val
        if not force and store.has_episode_clean(self.episode_id):
            if on_progress:
                on_progress(self.name, 1.0, f"Skip (already normalized): {self.episode_id}")
            if db:
                db.set_episode_status(self.episode_id, EpisodeStatus.NORMALIZED.value)
            return StepResult(True, f"Already normalized: {self.episode_id}")
        raw = store.load_episode_text(self.episode_id, kind="raw")
        if not raw.strip():
            return StepResult(False, f"No raw text: {self.episode_id}")
        if on_progress:
            on_progress(self.name, 0.5, f"Normalizing {self.episode_id}...")
        clean_text, stats, debug = profile.apply(raw)
        store.save_episode_clean(self.episode_id, clean_text, stats, debug)
        if db:
            db.set_episode_status(self.episode_id, EpisodeStatus.NORMALIZED.value)
        if on_progress:
            on_progress(self.name, 1.0, f"Normalized: {self.episode_id}")
        return StepResult(True, f"Normalized: {self.episode_id}", {"stats": stats, "debug": debug})


class BuildDbIndexStep(Step):
    """Indexe les épisodes normalisés dans la DB (FTS). Skip si déjà indexé sauf force."""

    name = "build_db_index"

    def __init__(self, episode_ids: list[str] | None = None) -> None:
        """Si episode_ids is None, indexe tous les épisodes ayant clean.txt."""
        self.episode_ids = episode_ids

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        db: CorpusDB = context["db"]
        if not db:
            return StepResult(False, "No DB in context")
        to_index: list[str] = []
        if self.episode_ids is not None:
            to_index = [eid for eid in self.episode_ids if store.has_episode_clean(eid)]
        else:
            index = store.load_series_index()
            if index:
                to_index = [e.episode_id for e in index.episodes if store.has_episode_clean(e.episode_id)]
            else:
                # Parcourir episodes/
                for d in (store.root_dir / EPISODES_DIR_NAME).iterdir():
                    if d.is_dir() and (d / CLEAN_TEXT_FILENAME).exists():
                        to_index.append(d.name)
        n = len(to_index)
        is_cancelled = context.get("is_cancelled")
        indexed: set[str] = set(db.get_episode_ids_indexed()) if not force else set()
        for i, eid in enumerate(to_index):
            if is_cancelled and is_cancelled():
                return StepResult(False, "Cancelled")
            if not force and eid in indexed:
                continue
            clean = store.load_episode_text(eid, kind="clean")
            if clean:
                db.index_episode_text(eid, clean)
            if on_progress and n:
                on_progress(self.name, (i + 1) / n, f"Indexed {eid}")
        if on_progress:
            on_progress(self.name, 1.0, f"Indexed {len(to_index)} episodes")
        return StepResult(True, f"Indexed {len(to_index)} episodes")


class SegmentEpisodeStep(Step):
    """Phase 2 : segmente un épisode (phrases + tours), écrit segments.jsonl, upsert DB."""

    name = "segment_episode"

    def __init__(self, episode_id: str, lang_hint: str = "en") -> None:
        self.episode_id = episode_id
        self.lang_hint = lang_hint

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        db: CorpusDB | None = context.get("db")
        ep_dir = store._episode_dir(self.episode_id)  # noqa: SLF001 - sanitation centralisée côté store
        segments_path = ep_dir / SEGMENTS_JSONL_FILENAME
        if not force and segments_path.exists():
            if db:
                # jsonl déjà présent mais SQLite parfois vide (anciens jobs sans ``db``) :
                # réinjecter pour FTS concordancier / align.
                sents, utts = _segments_by_kind_from_jsonl(segments_path)
                db.upsert_segments(self.episode_id, "sentence", sents)
                db.upsert_segments(self.episode_id, "utterance", utts)
            if on_progress:
                on_progress(self.name, 1.0, f"Skip (already segmented): {self.episode_id}")
            return StepResult(True, f"Already segmented: {self.episode_id}")
        clean = store.load_episode_text(self.episode_id, kind="clean")
        if not clean.strip():
            return StepResult(False, f"No clean text: {self.episode_id}")
        if on_progress:
            on_progress(self.name, 0.0, f"Segmenting {self.episode_id}...")
        sentences = segmenter_sentences(clean, self.lang_hint)
        utt_opts = store.get_episode_segmentation_options(
            self.episode_id,
            "transcript",
            default=DEFAULT_SEGMENTATION_OPTIONS,
        )
        utterances = segmenter_utterances_with_options(clean, self.episode_id, utt_opts)
        for s in sentences:
            s.episode_id = self.episode_id
        for u in utterances:
            u.episode_id = self.episode_id
        ep_dir.mkdir(parents=True, exist_ok=True)
        with segments_path.open("w", encoding="utf-8") as f:
            for seg in sentences + utterances:
                obj = {
                    "segment_id": seg.segment_id,
                    "episode_id": seg.episode_id,
                    "kind": seg.kind,
                    "n": seg.n,
                    "start_char": seg.start_char,
                    "end_char": seg.end_char,
                    "text": seg.text,
                    "speaker_explicit": seg.speaker_explicit,
                    "meta": seg.meta,
                }
                f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        if db:
            db.upsert_segments(self.episode_id, "sentence", sentences)
            db.upsert_segments(self.episode_id, "utterance", utterances)
            db.delete_align_runs_for_episode(self.episode_id)
        if on_progress:
            on_progress(self.name, 1.0, f"Segmented: {self.episode_id} ({len(sentences)} sentences, {len(utterances)} utterances)")
        return StepResult(
            True,
            f"Segmented: {self.episode_id}",
            {"sentences": len(sentences), "utterances": len(utterances)},
        )


class RebuildSegmentsIndexStep(Step):
    """Phase 2 : reconstruit l'index segments pour tous les épisodes ayant clean.txt."""

    name = "rebuild_segments_index"

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        db: CorpusDB | None = context.get("db")
        if not db:
            return StepResult(False, "No DB in context")
        to_segment: list[str] = []
        index = store.load_series_index()
        if index:
            to_segment = [e.episode_id for e in index.episodes if store.has_episode_clean(e.episode_id)]
        else:
            for d in (store.root_dir / EPISODES_DIR_NAME).iterdir():
                if d.is_dir() and (d / CLEAN_TEXT_FILENAME).exists():
                    to_segment.append(d.name)
        n = len(to_segment)
        lang_hint = getattr(context.get("config"), "normalize_profile", DEFAULT_NORMALIZE_PROFILE).split("_")[0].replace("default", "en") or "en"
        is_cancelled = context.get("is_cancelled")
        for i, eid in enumerate(to_segment):
            if is_cancelled and is_cancelled():
                return StepResult(False, "Cancelled")
            step = SegmentEpisodeStep(eid, lang_hint=lang_hint)
            step.run(context, force=force, on_progress=on_progress, on_log=on_log)
            if on_progress and n:
                on_progress(self.name, (i + 1) / n, f"Segmented {eid}")
        if on_progress:
            on_progress(self.name, 1.0, f"Rebuilt segments for {n} episodes")
        return StepResult(True, f"Rebuilt segments for {n} episodes")


class ImportSubtitlesStep(Step):
    """Phase 3 : importe un fichier SRT/VTT pour un épisode et une langue. §11 : option profile_id pour normaliser à l'import."""

    name = "import_subtitles"

    def __init__(
        self,
        episode_id: str,
        lang: str,
        file_path: Path | str,
        profile_id: str | None = None,
    ) -> None:
        self.episode_id = episode_id
        self.lang = lang
        self.file_path = Path(file_path)
        self.profile_id = profile_id

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        db: CorpusDB | None = context.get("db")
        if not self.file_path.exists():
            return StepResult(False, f"Fichier introuvable: {self.file_path.name}")
        if on_progress:
            on_progress(self.name, 0.0, f"Parsing {self.file_path.name}...")
        try:
            content = read_subtitle_file_content(self.file_path)
            cues, fmt = parse_subtitle_content(content, str(self.file_path))
        except Exception as e:
            logger.exception("Parse subtitles")
            return StepResult(False, str(e))
        for c in cues:
            c.episode_id = self.episode_id
            c.lang = self.lang
        track_id = f"{self.episode_id}:{self.lang}"
        cues_audit = cues_to_audit_rows(cues)
        store.save_episode_subtitles(self.episode_id, self.lang, content, fmt, cues_audit)
        if db:
            imported_at = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
            db.add_track(
                track_id=track_id,
                episode_id=self.episode_id,
                lang=self.lang,
                fmt=fmt,
                source_path=str(self.file_path),
                imported_at=imported_at,
                meta_json=json.dumps({"source": self.file_path.name}),
            )
            db.upsert_cues(track_id, self.episode_id, self.lang, cues)
            if self.profile_id:
                if on_progress:
                    on_progress(self.name, 0.9, f"Application du profil {self.profile_id}…")
                try:
                    store.normalize_subtitle_track(db, self.episode_id, self.lang, self.profile_id, rewrite_srt=False)
                except Exception as e:
                    logger.exception("Normalisation à l'import")
                    if on_log:
                        on_log("warn", f"Profil non appliqué: {e}")
        if on_progress:
            on_progress(self.name, 1.0, f"Imported {len(cues)} cues for {self.episode_id} ({self.lang})")
        return StepResult(True, f"Imported {len(cues)} cues", {"cues_count": len(cues), "format": fmt})


class DownloadOpenSubtitlesStep(Step):
    """P2 §6.2 : télécharge un sous-titre depuis OpenSubtitles puis l'importe (store + DB)."""

    name = "download_opensubtitles"

    def __init__(
        self,
        episode_id: str,
        season: int,
        episode: int,
        lang: str,
        api_key: str,
        imdb_id: str,
    ) -> None:
        self.episode_id = episode_id
        self.season = season
        self.episode = episode
        self.lang = lang
        self.api_key = api_key
        self.imdb_id = imdb_id.strip().lower()
        if not self.imdb_id.startswith("tt"):
            self.imdb_id = f"tt{self.imdb_id}"

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        store: ProjectStore = context["store"]
        db: CorpusDB | None = context.get("db")
        if on_progress:
            on_progress(self.name, 0.0, f"Search OpenSubtitles {self.episode_id} ({self.lang})...")
        try:
            client = OpenSubtitlesClient(api_key=self.api_key)
            hits = client.search(self.imdb_id, self.season, self.episode, self.lang)
        except OpenSubtitlesError as e:
            return StepResult(False, str(e))
        if not hits:
            return StepResult(False, f"Aucun sous-titre trouvé pour {self.episode_id} ({self.lang})")
        if on_progress:
            on_progress(self.name, 0.3, f"Download {self.episode_id} ({self.lang})...")
        try:
            content = client.download(hits[0].file_id)
        except OpenSubtitlesError as e:
            return StepResult(False, str(e))
        path = store.save_episode_subtitle_content(self.episode_id, self.lang, content, "srt")
        if on_progress:
            on_progress(self.name, 0.7, f"Import {self.episode_id} ({self.lang})...")
        try:
            cues, fmt = parse_subtitle_content(content, str(path))
        except Exception as e:
            logger.exception("Parse subtitles after download")
            return StepResult(False, str(e))
        for c in cues:
            c.episode_id = self.episode_id
            c.lang = self.lang
        track_id = f"{self.episode_id}:{self.lang}"
        cues_audit = cues_to_audit_rows(cues)
        store.save_episode_subtitles(self.episode_id, self.lang, content, "srt", cues_audit)
        if db:
            imported_at = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
            db.add_track(
                track_id=track_id,
                episode_id=self.episode_id,
                lang=self.lang,
                fmt="srt",
                source_path=str(path),
                imported_at=imported_at,
                meta_json=json.dumps({"source": "OpenSubtitles"}),
            )
            db.upsert_cues(track_id, self.episode_id, self.lang, cues)
        if on_progress:
            on_progress(self.name, 1.0, f"Downloaded {len(cues)} cues for {self.episode_id} ({self.lang})")
        return StepResult(True, f"Downloaded {len(cues)} cues", {"cues_count": len(cues)})


class AlignEpisodeStep(Step):
    """Phase 4 : aligne segments (phrases ou tours de parole) ↔ cues pivot puis cues pivot ↔ cues target."""

    name = "align_episode"

    def __init__(
        self,
        episode_id: str,
        pivot_lang: str = "en",
        target_langs: list[str] | None = None,
        min_confidence: float = 0.3,
        use_similarity_for_cues: bool = False,
        segment_kind: str = "sentence",
    ) -> None:
        self.episode_id = episode_id
        self.pivot_lang = pivot_lang
        self.target_langs = list(target_langs) if target_langs is not None else ["fr"]
        self.min_confidence = min_confidence
        self.use_similarity_for_cues = use_similarity_for_cues
        self.segment_kind = segment_kind if segment_kind in ("sentence", "utterance") else "sentence"

    def run(
        self,
        context: PipelineContext,
        *,
        force: bool = False,
        on_progress: Callable[[str, float, str], None] | None = None,
        on_log: Callable[[str, str], None] | None = None,
    ) -> StepResult:
        from howimetyourcorpus.core.align import (
            AlignLink,
            align_segments_to_cues,
            align_cues_by_time,
            align_cues_by_order,
            align_cues_by_similarity,
            cues_have_timecodes,
        )

        store: ProjectStore = context["store"]
        db: CorpusDB | None = context.get("db")
        if not db:
            return StepResult(False, "No DB in context")
        if on_progress:
            on_progress(self.name, 0.0, f"Loading segments and cues for {self.episode_id}...")
        segments = db.get_segments_for_episode(self.episode_id, kind=self.segment_kind)
        has_segments = bool(segments)
        cues_en = db.get_cues_for_episode_lang(self.episode_id, self.pivot_lang)
        if not has_segments and not self.target_langs:
            return StepResult(
                False,
                f"No segments ({self.segment_kind}) and no target language for {self.episode_id}.",
            )
        # Pivot optionnel : si pas de piste pivot (ex. EN), utiliser la première langue cible qui a des cues (ex. FR)
        effective_pivot_lang = self.pivot_lang
        if not cues_en and self.target_langs and has_segments:
            for tl in self.target_langs:
                cues_t = db.get_cues_for_episode_lang(self.episode_id, tl)
                if cues_t:
                    effective_pivot_lang = tl
                    cues_en = cues_t
                    break
        if not cues_en:
            if has_segments:
                return StepResult(
                    False,
                    f"Pour cet épisode, aucune piste de sous-titres (pivot {self.pivot_lang.upper()} ni cibles {', '.join(self.target_langs).upper()}). "
                    f"Importez au moins une piste SRT dans l'onglet Inspecteur (ex. FR pour comparer transcript EN ↔ sous-titres FR)."
                )
            return StepResult(
                False,
                f"Alignement cues↔cues impossible : piste pivot {self.pivot_lang.upper()} absente pour {self.episode_id}.",
            )
        
        pivot_links: list[AlignLink] = []
        all_links: list[AlignLink] = []
        if has_segments:
            # Callback de progression granulaire pour l'alignement segment↔cue pivot
            def on_align_progress(current: int, total: int) -> None:
                if on_progress:
                    progress = 0.1 + 0.3 * (current / total)  # 10% → 40%
                    on_progress(self.name, progress, f"Aligning segments {current}/{total}...")

            pivot_links = align_segments_to_cues(
                segments,
                cues_en,
                min_confidence=self.min_confidence,
                on_progress=on_align_progress,
            )
            all_links = list(pivot_links)
            # Mettre à jour la langue des liens pivot si pivot effectif != EN (ex. segment↔FR direct)
            if effective_pivot_lang != self.pivot_lang:
                for link in all_links:
                    if link.role == "pivot":
                        link.lang = effective_pivot_lang
            if on_progress:
                on_progress(self.name, 0.4, f"Aligned {len(pivot_links)} segment↔cue links; aligning target langs...")
        elif on_progress:
            on_progress(self.name, 0.4, "No transcript segments: cue↔cue alignment only.")
        # Liens cible (cue pivot ↔ cue autre langue) uniquement si pivot classique et autres langues ont des cues
        remaining_targets = [tl for tl in self.target_langs if tl != effective_pivot_lang]
        if not has_segments and not remaining_targets:
            return StepResult(
                False,
                "Alignement cues↔cues impossible : choisissez au moins une langue cible différente du pivot.",
            )
        for tl in remaining_targets:
            cues_target = db.get_cues_for_episode_lang(self.episode_id, tl)
            if cues_target:
                use_time = (
                    not self.use_similarity_for_cues
                    and cues_have_timecodes(cues_en)
                    and cues_have_timecodes(cues_target)
                )
                if use_time:
                    target_links = align_cues_by_time(cues_en, cues_target)
                else:
                    # Sans timecodes (backlog §3) : par ordre d'abord si les deux pistes n'ont pas de timecodes
                    # (fichiers parallèles cue i ↔ cue i), sinon par similarité puis ordre en secours.
                    no_time_pivot = not cues_have_timecodes(cues_en)
                    no_time_target = not cues_have_timecodes(cues_target)
                    if no_time_pivot and no_time_target:
                        target_links = align_cues_by_order(cues_en, cues_target)
                        if not target_links:
                            target_links = align_cues_by_similarity(
                                cues_en, cues_target, min_confidence=self.min_confidence
                            )
                    else:
                        target_links = align_cues_by_similarity(
                            cues_en, cues_target, min_confidence=self.min_confidence
                        )
                        if not target_links and cues_target:
                            target_links = align_cues_by_order(cues_en, cues_target)
                all_links.extend(target_links)
        if not has_segments and not all_links:
            return StepResult(
                False,
                "Aucun lien cue↔cue généré pour cet épisode (vérifiez langues et contenu des pistes).",
            )
        run_id = f"{self.episode_id}:align:{datetime.datetime.now(datetime.UTC).strftime('%Y%m%dT%H%M%SZ')}"
        created_at = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
        params = {
            "pivot_lang": self.pivot_lang,
            "effective_pivot_lang": effective_pivot_lang,
            "target_langs": self.target_langs,
            "min_confidence": self.min_confidence,
            "use_similarity_for_cues": self.use_similarity_for_cues,
            "segment_kind": self.segment_kind,
        }
        summary = {
            "pivot_links": len(pivot_links),
            "total_links": len(all_links),
            "segments_count": len(segments),
            "cues_pivot_count": len(cues_en),
            "segment_kind": self.segment_kind,
        }
        db.create_align_run(run_id, self.episode_id, effective_pivot_lang, json.dumps(params), created_at, json.dumps(summary))
        links_dicts = [link.to_dict(link_id=f"{run_id}:{i}") for i, link in enumerate(all_links)]
        db.upsert_align_links(run_id, self.episode_id, links_dicts)
        links_audit = [{"link_id": d.get("link_id"), "segment_id": d.get("segment_id"), "cue_id": d.get("cue_id"), "cue_id_target": d.get("cue_id_target"), "lang": d.get("lang"), "role": d.get("role"), "confidence": d.get("confidence"), "status": d.get("status")} for d in links_dicts]
        store.save_align_audit(self.episode_id, run_id, links_audit, {"run_id": run_id, "summary": summary, "params": params})
        if on_progress:
            on_progress(self.name, 1.0, f"Align run {run_id}: {len(all_links)} links")
        return StepResult(True, f"Align run {run_id}", {"run_id": run_id, "links_count": len(all_links)})
