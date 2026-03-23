"""api/jobs.py — File de jobs persistante + worker (MX-006).

Jobs supportés :
  - normalize_transcript : NormalizeEpisodeStep (raw → clean)
  - normalize_srt        : normalize_subtitle_track (cues text_raw → text_clean via DB)
  - segment_transcript   : SegmentEpisodeStep (clean → segments.jsonl + table ``segments`` / FTS)

Persistance : {project_path}/jobs.json (réécrit à chaque mutation).
Reprise     : les jobs "running" au redémarrage sont remis en "pending".
Worker      : thread unique, prend les jobs pending dans l'ordre FIFO.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE

logger = logging.getLogger(__name__)

# ── Statuts ────────────────────────────────────────────────────────────────

PENDING  = "pending"
RUNNING  = "running"
DONE     = "done"
ERROR    = "error"
CANCELLED = "cancelled"

JOB_TYPES = frozenset([
    "normalize_transcript",
    "normalize_srt",
    "segment_transcript",
    "align",
])


# ── JobRecord ──────────────────────────────────────────────────────────────

class JobRecord:
    __slots__ = (
        "job_id", "job_type", "episode_id", "source_key",
        "status", "created_at", "updated_at", "error_msg", "result", "params",
    )

    def __init__(
        self,
        job_type: str,
        episode_id: str,
        source_key: str = "",
        *,
        job_id: str | None = None,
        status: str = PENDING,
        created_at: str | None = None,
        updated_at: str | None = None,
        error_msg: str | None = None,
        result: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> None:
        self.job_id     = job_id or str(uuid.uuid4())
        self.job_type   = job_type
        self.episode_id = episode_id
        self.source_key = source_key
        self.status     = status
        self.created_at = created_at or _now()
        self.updated_at = updated_at or self.created_at
        self.error_msg  = error_msg
        self.result     = result or {}
        self.params     = params or {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id":     self.job_id,
            "job_type":   self.job_type,
            "episode_id": self.episode_id,
            "source_key": self.source_key,
            "status":     self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "error_msg":  self.error_msg,
            "result":     self.result,
            "params":     self.params,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "JobRecord":
        return cls(
            job_type   = d["job_type"],
            episode_id = d["episode_id"],
            source_key = d.get("source_key", ""),
            job_id     = d["job_id"],
            status     = d.get("status", PENDING),
            created_at = d.get("created_at"),
            updated_at = d.get("updated_at"),
            error_msg  = d.get("error_msg"),
            result     = d.get("result", {}),
            params     = d.get("params", {}),
        )


# ── JobStore ───────────────────────────────────────────────────────────────

class JobStore:
    """File de jobs persistante sur disque.

    Thread-safe via Lock interne. Le worker thread appelle get_next_pending() /
    mark_running() / mark_done() / mark_error() au fil de l'exécution.
    """

    def __init__(self, project_path: Path) -> None:
        self._path = project_path / "jobs.json"
        self._lock = threading.Lock()
        self._jobs: dict[str, JobRecord] = {}
        self._load()
        self._recover_interrupted()

    # ── Persistance ────────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            for d in data.get("jobs", []):
                rec = JobRecord.from_dict(d)
                self._jobs[rec.job_id] = rec
        except Exception:
            logger.exception("JobStore : erreur lecture jobs.json — démarrage avec file vide")

    def _save(self) -> None:
        """Réécrit jobs.json (appelé sous lock)."""
        try:
            payload = {"jobs": [j.to_dict() for j in self._jobs.values()]}
            self._path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            logger.exception("JobStore : erreur écriture jobs.json")

    def _recover_interrupted(self) -> None:
        """Remet en 'pending' les jobs bloqués en 'running' au redémarrage."""
        with self._lock:
            recovered = 0
            for job in self._jobs.values():
                if job.status == RUNNING:
                    job.status     = PENDING
                    job.updated_at = _now()
                    recovered += 1
            if recovered:
                self._save()
                logger.info("JobStore : %d job(s) remis en pending après redémarrage", recovered)

    # ── CRUD ────────────────────────────────────────────────────────────

    def create(
        self, job_type: str, episode_id: str, source_key: str = "",
        *, params: dict[str, Any] | None = None,
    ) -> JobRecord:
        rec = JobRecord(job_type, episode_id, source_key, params=params)
        with self._lock:
            self._jobs[rec.job_id] = rec
            self._save()
        return rec

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_all(self) -> list[JobRecord]:
        with self._lock:
            return list(self._jobs.values())

    def cancel(self, job_id: str) -> bool:
        """Annule un job en 'pending'. Retourne True si annulé."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.status == PENDING:
                job.status     = CANCELLED
                job.updated_at = _now()
                self._save()
                return True
        return False

    def get_next_pending(self) -> JobRecord | None:
        with self._lock:
            for job in self._jobs.values():
                if job.status == PENDING:
                    return job
        return None

    def mark_running(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status     = RUNNING
                job.updated_at = _now()
                self._save()

    def mark_done(self, job_id: str, result: dict[str, Any] | None = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status     = DONE
                job.updated_at = _now()
                job.result     = result or {}
                self._save()

    def mark_error(self, job_id: str, error_msg: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status     = ERROR
                job.updated_at = _now()
                job.error_msg  = error_msg
                self._save()

    def mark_progress(self, job_id: str, progress: dict[str, Any]) -> None:
        """Met à jour _progress dans result pendant l'exécution (G-007 / MX-048).
        Mise à jour en mémoire uniquement — pas de flush disque pour éviter la contention."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job and job.status == RUNNING:
                job.result = {**job.result, "_progress": progress}

    def has_active(self) -> bool:
        """True si au moins un job est pending ou running."""
        with self._lock:
            return any(j.status in (PENDING, RUNNING) for j in self._jobs.values())


# ── Worker ─────────────────────────────────────────────────────────────────

class JobWorker:
    """Worker thread unique qui exécute les jobs pending dans l'ordre FIFO."""

    def __init__(self, store: JobStore, get_project_path: Any) -> None:
        self._store            = store
        self._get_project_path = get_project_path
        self._thread: threading.Thread | None = None
        self._stop_event       = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="himyc-job-worker")
        self._thread.start()
        logger.info("JobWorker démarré")

    def stop(self) -> None:
        self._stop_event.set()

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            job = self._store.get_next_pending()
            if job:
                self._run_job(job)
            else:
                time.sleep(0.5)

    def _run_job(self, job: JobRecord) -> None:
        logger.info("JobWorker : démarrage %s %s/%s", job.job_type, job.episode_id, job.source_key)
        self._store.mark_running(job.job_id)

        import re as _re

        def _on_progress(_step: str, pct_float: float, message: str) -> None:
            """Callback transmis à AlignEpisodeStep.run() → mise à jour _progress."""
            m = _re.search(r"(\d+)/(\d+)", message)
            segments_done  = int(m.group(1)) if m else 0
            segments_total = int(m.group(2)) if m else 0
            self._store.mark_progress(job.job_id, {
                "progress_pct":    round(pct_float * 100),
                "segments_done":   segments_done,
                "segments_total":  segments_total,
            })

        try:
            project_path = self._get_project_path()
            result = _execute_job(job, project_path, on_progress=_on_progress)
            self._store.mark_done(job.job_id, result)
            logger.info("JobWorker : done %s %s", job.job_type, job.episode_id)
        except Exception as e:
            logger.exception("JobWorker : erreur %s %s", job.job_type, job.episode_id)
            self._store.mark_error(job.job_id, str(e))


# ── Exécution job ──────────────────────────────────────────────────────────

def _ensure_corpus_db(store: Any) -> Any:
    """Crée ``corpus.db`` si absent. Les étapes pipeline doivent recevoir ``db`` pour
    persister les segments dans SQLite (FTS concordancier, alignement)."""
    from howimetyourcorpus.core.storage.db import CorpusDB

    db_path = store.get_db_path()
    if not db_path.exists():
        CorpusDB(db_path).init()
    return CorpusDB(db_path)


def _execute_job(
    job: JobRecord,
    project_path: Path,
    on_progress: Any = None,
) -> dict[str, Any]:
    """Exécute un job de façon synchrone. Lève une exception en cas d'erreur."""
    from howimetyourcorpus.core.storage.project_store import ProjectStore
    from howimetyourcorpus.core.pipeline.runner import PipelineRunner
    from howimetyourcorpus.core.pipeline.tasks import NormalizeEpisodeStep, SegmentEpisodeStep

    store = ProjectStore(project_path)

    if job.job_type == "normalize_transcript":
        # Pré-condition (MX-008) : raw.txt doit exister
        if not store.has_episode_raw(job.episode_id):
            raise RuntimeError(
                f"Transcript RAW introuvable pour {job.episode_id!r}. "
                "Importez un transcript avant de normaliser."
            )
        extra = store.load_config_extra()
        # Priorité : paramètre du job > config globale > défaut
        profile_id = (
            job.params.get("normalize_profile")
            or extra.get("normalize_profile", DEFAULT_NORMALIZE_PROFILE)
        )
        normalize_options = job.params.get("normalize_options") or {}
        runner = PipelineRunner()
        step   = NormalizeEpisodeStep(job.episode_id, profile_id, normalize_options=normalize_options)
        ctx: dict[str, Any] = {"store": store}
        results = runner.run([step], ctx, force=True)
        if results and not results[0].success:
            raise RuntimeError(results[0].message)
        store.set_episode_prep_status(job.episode_id, "transcript", "normalized")
        return {"profile": profile_id}

    if job.job_type == "segment_transcript":
        # Pré-condition (MX-008) : clean.txt doit exister (normalisé)
        if not store.has_episode_clean(job.episode_id):
            raise RuntimeError(
                f"Transcript normalisé introuvable pour {job.episode_id!r}. "
                "Normalisez le transcript avant de segmenter."
            )
        lang_hint = job.params.get("lang_hint", "en")
        db = _ensure_corpus_db(store)
        runner = PipelineRunner()
        step   = SegmentEpisodeStep(job.episode_id, lang_hint=lang_hint)
        ctx: dict[str, Any] = {"store": store, "db": db}
        results = runner.run([step], ctx, force=True)
        if results and not results[0].success:
            raise RuntimeError(results[0].message)
        # L'état "segmented" est dérivé de la présence de segments.jsonl dans server.py.
        # Le store natif HIMYC ne supporte pas "segmented" dans PREP_STATUS_VALUES.
        return {}

    if job.job_type == "normalize_srt":
        lang = job.source_key.removeprefix("srt_") if job.source_key.startswith("srt_") else job.source_key
        # Pré-condition (MX-008) : piste SRT doit exister
        if not store.has_episode_subs(job.episode_id, lang):
            raise RuntimeError(
                f"Piste SRT {lang!r} introuvable pour {job.episode_id!r}. "
                "Importez la piste SRT avant de normaliser."
            )
        db_path = store.get_db_path()
        if not db_path.exists():
            raise RuntimeError("corpus.db introuvable — indexez d'abord le projet.")
        from howimetyourcorpus.core.storage.db import CorpusDB
        db = CorpusDB(db_path)
        extra = store.load_config_extra()
        profile_id = extra.get("normalize_profile", DEFAULT_NORMALIZE_PROFILE)
        n = store.normalize_subtitle_track(db, job.episode_id, lang, profile_id)
        store.set_episode_prep_status(job.episode_id, job.source_key, "normalized")
        return {"cues_updated": n}

    if job.job_type == "align":
        pivot_lang           = job.params.get("pivot_lang", "en")
        target_langs         = job.params.get("target_langs", [])
        segment_kind         = job.params.get("segment_kind", "sentence")
        min_confidence       = float(job.params.get("min_confidence", 0.3))
        use_similarity       = bool(job.params.get("use_similarity_for_cues", False))
        run_id               = job.params.get("run_id") or job.job_id[:8]

        db_path = store.get_db_path()
        if not db_path.exists():
            raise RuntimeError("corpus.db introuvable — indexez d'abord le projet.")

        from howimetyourcorpus.core.storage.db import CorpusDB
        from howimetyourcorpus.core.pipeline.tasks import AlignEpisodeStep
        db = CorpusDB(db_path)

        runner = PipelineRunner()
        step = AlignEpisodeStep(
            job.episode_id,
            pivot_lang=pivot_lang,
            target_langs=target_langs,
            segment_kind=segment_kind,
            min_confidence=min_confidence,
            use_similarity_for_cues=use_similarity,
        )
        ctx: dict[str, Any] = {"store": store, "db": db}
        results = runner.run([step], ctx, force=True, on_progress=on_progress)
        if results and not results[0].success:
            raise RuntimeError(results[0].message)

        # Sauvegarder un rapport minimal pour GET /alignment_runs
        import json as _json
        from datetime import datetime, timezone
        align_dir = store.align_dir(job.episode_id)
        run_dir = align_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        report = {
            "run_id":                 run_id,
            "pivot_lang":             pivot_lang,
            "target_langs":           target_langs,
            "segment_kind":           segment_kind,
            "min_confidence":         min_confidence,
            "use_similarity_for_cues": use_similarity,
            "created_at":             datetime.now(timezone.utc).isoformat(),
        }
        (run_dir / "report.json").write_text(
            _json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"run_id": run_id, "pivot_lang": pivot_lang, "target_langs": target_langs}

    raise ValueError(f"Type de job inconnu : {job.job_type!r}")


# ── Singleton par projet ───────────────────────────────────────────────────

_workers: dict[str, JobWorker] = {}
_stores:  dict[str, JobStore]  = {}
_stores_lock = threading.Lock()


def get_job_store(project_path: Path) -> JobStore:
    """Retourne (et initialise si besoin) le JobStore pour ce projet."""
    key = str(project_path)
    with _stores_lock:
        if key not in _stores:
            store  = JobStore(project_path)
            worker = JobWorker(store, lambda: project_path)
            worker.start()
            _stores[key]  = store
            _workers[key] = worker
        return _stores[key]


# ── Helpers ────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
