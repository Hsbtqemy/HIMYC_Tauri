/**
 * api.ts — Client API HIMYC backend
 *
 * Tous les appels vers le backend Python passent par `sidecar_fetch_loopback`
 * (commande Tauri Rust) qui contourne les restrictions CSP Tauri pour loopback.
 * Jamais de fetch() direct vers localhost depuis le frontend.
 */

import { invoke } from "@tauri-apps/api/core";

export { API_BASE, SUPPORTED_LANGUAGES } from "./constants";
import { API_BASE, DEFAULT_ERROR_CODE, TAURI_SIDECAR_CMD } from "./constants";

/** Encode un segment de chemin API (`episode_id`, `run_id`, `segment_id`, `source_key`…). */
function epSeg(s: string): string {
  return encodeURIComponent(s);
}

interface FetchResult {
  status: number;
  ok: boolean;
  body: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Formate une erreur inconnue en message lisible pour l'utilisateur. */
export function formatApiError(e: unknown): string {
  if (e instanceof ApiError) return `${e.errorCode} — ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * FastAPI renvoie souvent les erreurs sous la forme
 * `{ "detail": { "error": "CODE", "message": "…" } }` (HTTPException).
 * Sans ce parsing, le client voyait UNKNOWN et le JSON brut.
 */
function parseApiErrorBody(body: string): { errorCode: string; message: string } {
  let errorCode = DEFAULT_ERROR_CODE;
  let message = body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;

    if (parsed.detail !== undefined) {
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      } else if (parsed.detail && typeof parsed.detail === "object" && !Array.isArray(parsed.detail)) {
        const d = parsed.detail as Record<string, unknown>;
        if (typeof d.error === "string") errorCode = d.error;
        if (typeof d.message === "string") message = d.message;
      }
    }
    if (errorCode === DEFAULT_ERROR_CODE && typeof parsed.error === "string") {
      errorCode = parsed.error;
    }
    if (message === body && typeof parsed.message === "string") {
      message = parsed.message as string;
    }
  } catch {
    /* corps non JSON — garder le texte brut */
  }
  return { errorCode, message };
}

async function _loopbackFetch(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<FetchResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // VITE_E2E=true : bypass Tauri invoke, use native fetch (Playwright E2E tests)
  if (import.meta.env.VITE_E2E === "true") {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const bodyText = await res.text();
    return { status: res.status, ok: res.ok, body: bodyText };
  }
  return invoke<FetchResult>(TAURI_SIDECAR_CMD, {
    url: `${API_BASE}${path}`,
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers,
  });
}

function _parseBody<T>(body: string): T {
  const trimmed = body ? body.trim() : "";
  if (!trimmed || trimmed === "null") return undefined as unknown as T;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new ApiError(0, "INVALID_JSON", `Corps de réponse non JSON : ${trimmed.slice(0, 120)}`);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await _loopbackFetch(path);
  if (!res.ok) {
    const { errorCode, message } = parseApiErrorBody(res.body);
    throw new ApiError(res.status, errorCode, message);
  }
  return _parseBody<T>(res.body);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiPost<T>(path, body, "PATCH");
}

export async function apiPost<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const res = await _loopbackFetch(path, method, body);
  if (!res.ok) {
    const { errorCode, message } = parseApiErrorBody(res.body);
    throw new ApiError(res.status, errorCode, message);
  }
  return _parseBody<T>(res.body);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await _loopbackFetch(path, "PUT", body);
  if (!res.ok) {
    const { errorCode, message } = parseApiErrorBody(res.body);
    throw new ApiError(res.status, errorCode, message);
  }
  return _parseBody<T>(res.body);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await _loopbackFetch(path, "DELETE");
  if (!res.ok) {
    const { errorCode, message } = parseApiErrorBody(res.body);
    throw new ApiError(res.status, errorCode, message);
  }
  return _parseBody<T>(res.body);
}

// ── Endpoints typés (MX-003) ──────────────────────────────────────────────────

// /health

export interface HealthResponse {
  status: "ok";
  version: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return apiGet<HealthResponse>("/health");
}

/** Crée `corpus.db` (schéma + migrations) si le fichier n’existe pas encore. */
export interface InitCorpusDbResult {
  created: boolean;
  path: string;
}

export async function initCorpusDb(): Promise<InitCorpusDbResult> {
  return apiPost<InitCorpusDbResult>("/project/init_corpus_db", {});
}

/** Rebuild FTS5 `segments_fts` depuis la table `segments` (concordancier). */
export interface RebuildSegmentsFtsResult {
  ok: boolean;
  segments_rows: number;
  segments_fts_rows: number;
}

export async function rebuildSegmentsFts(): Promise<RebuildSegmentsFtsResult> {
  return apiPost<RebuildSegmentsFtsResult>("/project/rebuild_segments_fts", {});
}

/**
 * Exécute `fn` ; si le backend répond NO_DB (corpus.db absent), tente `initCorpusDb()` puis réessaie une fois.
 */
export async function withNoDbRecovery<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ApiError) || e.errorCode !== "NO_DB") throw e;
    try {
      await initCorpusDb();
    } catch {
      throw e;
    }
    return await fn();
  }
}

// /config

export interface ConfigResponse {
  project_name: string;
  project_path: string;
  source_id: string;
  series_url: string;
  languages: string[];
  normalize_profile: string;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  return apiGet<ConfigResponse>("/config");
}

export interface ConfigUpdate {
  project_name?:      string;
  source_id?:         string;
  series_url?:        string;
  normalize_profile?: string;
  languages?:         string[];
}

export async function saveConfig(update: ConfigUpdate): Promise<ConfigResponse> {
  return apiPut<ConfigResponse>("/config", update);
}

// /series_index

export interface EpisodeRefInput {
  episode_id: string;
  season: number;
  episode: number;
  title?: string;
  url?: string;
  source_id?: string;
}

export interface SeriesIndexInput {
  series_title?: string;
  series_url?: string;
  episodes: EpisodeRefInput[];
}

export interface SeriesIndexSaveResult {
  saved: number;
  dirs_created: string[];
  series_title: string;
}

export async function fetchSeriesIndex(): Promise<SeriesIndexInput & { series_title: string; series_url: string }> {
  return apiGet("/series_index");
}

export async function saveSeriesIndex(index: SeriesIndexInput): Promise<SeriesIndexSaveResult> {
  return apiPut<SeriesIndexSaveResult>("/series_index", index);
}

// /episodes

export interface EpisodeSource {
  source_key: string;   // "transcript" | "srt_<lang>"
  available: boolean;
  has_clean?: boolean;
  state: string;        // "unknown" | "raw" | "normalized" | "segmented" | "ready_for_alignment"
  language?: string;
  nb_cues?: number;
  format?: string;
}

export interface Episode {
  episode_id: string;
  season: number;
  episode: number;
  title: string;
  url?: string;
  sources: EpisodeSource[];
}

export interface EpisodesResponse {
  series_title: string | null;
  episodes: Episode[];
}

export async function fetchEpisodes(): Promise<EpisodesResponse> {
  return apiGet<EpisodesResponse>("/episodes");
}

// /episodes/{id}/sources/{source_key}

export interface TranscriptSourceContent {
  episode_id: string;
  source_key: "transcript";
  raw: string;
  clean: string;
}

export interface SrtSourceContent {
  episode_id: string;
  source_key: string;
  language: string;
  format: "srt" | "vtt";
  content: string;
}

export type SourceContent = TranscriptSourceContent | SrtSourceContent;

export async function fetchEpisodeSource(
  episodeId: string,
  sourceKey: string,
): Promise<SourceContent> {
  return apiGet<SourceContent>(`/episodes/${epSeg(episodeId)}/sources/${epSeg(sourceKey)}`);
}

// /episodes/{id}/sources/transcript  POST (MX-005)
// /episodes/{id}/sources/srt_{lang}  POST (MX-005)

export interface ImportResult {
  episode_id: string;
  source_key: string;
  state: string;
  language?: string;
}

export async function importTranscript(
  episodeId: string,
  content: string,
): Promise<ImportResult> {
  return apiPost<ImportResult>(`/episodes/${epSeg(episodeId)}/sources/transcript`, {
    content,
  });
}

/**
 * Import d'un transcript depuis des octets bruts (fichier .txt, .docx, .odt).
 * Le backend détecte l'encodage (.txt) ou extrait le texte (.docx / .odt).
 */
export async function importTranscriptFile(
  episodeId: string,
  rawB64: string,
  filename: string,
): Promise<ImportResult> {
  return apiPost<ImportResult>(`/episodes/${epSeg(episodeId)}/sources/transcript`, {
    raw_b64: rawB64,
    filename,
  });
}

export async function deleteTranscript(
  episodeId: string,
): Promise<{ episode_id: string; source_key: string; removed: string[] }> {
  return apiDelete(`/episodes/${epSeg(episodeId)}/sources/transcript`);
}

export async function deleteSrt(
  episodeId: string,
  lang: string,
): Promise<{ episode_id: string; source_key: string; lang: string }> {
  return apiDelete(`/episodes/${epSeg(episodeId)}/sources/${epSeg(`srt_${lang}`)}`);
}

export async function patchTranscript(
  episodeId: string,
  clean: string,
): Promise<{ episode_id: string; source_key: string; state: string; chars: number }> {
  return apiPatch(`/episodes/${epSeg(episodeId)}/sources/transcript`, { clean });
}

export async function fetchNormalizePreview(
  text: string,
  profile: string,
  options: Record<string, unknown>,
): Promise<{ clean: string; merges: number }> {
  return apiPost<{ clean: string; merges: number }>("/normalize/preview", { text, profile, options });
}

/** Ligne d’aperçu segmentation (GET /segment/preview) */
export interface SegmentPreviewLine {
  n: number;
  kind: string;
  text: string;
  speaker_explicit: string | null;
}

export interface SegmentPreviewResponse {
  lang_hint: string;
  sentences: SegmentPreviewLine[];
  utterances: SegmentPreviewLine[];
  n_sentences: number;
  n_utterances: number;
}

/** Options utterances (épisode transcript) — alignées sur Préparer / ``episode_segmentation_options.json``. */
export interface UtteranceSegmentationOptions {
  speaker_regex: string;
  enable_dash_rule: boolean;
  dash_regex: string;
  continuation_markers: string[];
  merge_if_prev_ends_with_marker: boolean;
  attach_unmarked_to_previous: boolean;
}

export async function fetchEpisodeSegmentationOptions(
  episodeId: string,
  sourceKey = "transcript",
): Promise<{ episode_id: string; source_key: string; options: UtteranceSegmentationOptions }> {
  const q = encodeURIComponent(sourceKey);
  return apiGet<{ episode_id: string; source_key: string; options: UtteranceSegmentationOptions }>(
    `/episodes/${epSeg(episodeId)}/segmentation_options?source_key=${q}`,
  );
}

export async function putEpisodeSegmentationOptions(
  episodeId: string,
  options: Record<string, unknown>,
  sourceKey = "transcript",
): Promise<{ episode_id: string; source_key: string; options: UtteranceSegmentationOptions }> {
  return apiPut<{ episode_id: string; source_key: string; options: UtteranceSegmentationOptions }>(
    `/episodes/${epSeg(episodeId)}/segmentation_options`,
    { source_key: sourceKey, options },
  );
}

/** Même moteur Python que le job segment_transcript, sans écriture disque. */
export async function fetchSegmentPreview(
  text: string,
  langHint: string,
  utteranceOptions?: UtteranceSegmentationOptions | Record<string, unknown> | null,
): Promise<SegmentPreviewResponse> {
  const body: Record<string, unknown> = { text, lang_hint: langHint };
  if (utteranceOptions != null) body.utterance_options = utteranceOptions;
  return apiPost<SegmentPreviewResponse>("/segment/preview", body);
}

export async function importSrt(
  episodeId: string,
  lang: string,
  content: string,
  fmt: "srt" | "vtt" = "srt",
): Promise<ImportResult> {
  return apiPost<ImportResult>(`/episodes/${epSeg(episodeId)}/sources/${epSeg(`srt_${lang}`)}`, {
    content,
    fmt,
  });
}

// /jobs  (MX-006)

export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled";
export type JobType =
  | "normalize_transcript"
  | "normalize_srt"
  | "segment_transcript"
  | "align"
  | "derive_utterances";

export interface JobRecord {
  job_id: string;
  job_type: JobType;
  episode_id: string;
  source_key: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  error_msg: string | null;
  result: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface JobsResponse {
  jobs: JobRecord[];
}

export async function fetchJobs(): Promise<JobsResponse> {
  return apiGet<JobsResponse>("/jobs");
}

export async function createJob(
  jobType: JobType,
  episodeId: string,
  sourceKey = "",
  params: Record<string, unknown> = {},
): Promise<JobRecord> {
  return apiPost<JobRecord>("/jobs", {
    job_type: jobType,
    episode_id: episodeId,
    source_key: sourceKey,
    params,
  });
}

export async function fetchJob(jobId: string): Promise<JobRecord> {
  return apiGet<JobRecord>(`/jobs/${epSeg(jobId)}`);
}

// /episodes/{id}/alignment_runs  (MX-009)

export interface AlignmentRun {
  run_id: string;
  episode_id: string;
  pivot_lang: string;
  target_langs: string[];
  segment_kind: string;
  created_at: string;
}

export interface AlignmentRunsResponse {
  episode_id: string;
  runs: AlignmentRun[];
}

export async function fetchAlignmentRuns(
  episodeId: string,
): Promise<AlignmentRunsResponse> {
  return apiGet<AlignmentRunsResponse>(`/episodes/${epSeg(episodeId)}/alignment_runs`);
}

// ── Alignment Audit (MX-028) ──────────────────────────────────────────────────

export interface AlignRunStats {
  episode_id: string;
  run_id: string;
  nb_links: number;
  nb_pivot: number;
  nb_target: number;
  by_status: { auto?: number; accepted?: number; rejected?: number; ignored?: number };
  /** Statuts filtrés sur les liens pivot uniquement — source correcte pour coverage_pct. */
  by_status_pivot?: { auto?: number; accepted?: number; rejected?: number; ignored?: number };
  avg_confidence: number | null;
  n_collisions: number;
  coverage_pct: number | null;
}

export interface AuditLink {
  link_id: string;
  role: "pivot" | "target";
  lang: string;
  confidence: number | null;
  status: "auto" | "accepted" | "rejected" | "ignored";
  segment_id: string | null;
  cue_id: string | null;
  cue_id_target: string | null;
  text_segment: string | null;
  speaker_explicit: string | null;
  segment_n: number | null;
  text_pivot: string | null;
  text_target: string | null;
  note: string | null;
}

export interface AuditLinksResponse {
  episode_id: string;
  run_id: string;
  total: number;
  offset: number;
  limit: number;
  links: AuditLink[];
}

export interface AlignCollisionTarget {
  link_id: string;
  cue_id_target: string;
  target_text: string;
  confidence: number | null;
  status: string;
}

export interface AlignCollision {
  pivot_cue_id: string;
  pivot_text: string;
  lang: string;
  n_targets: number;
  targets: AlignCollisionTarget[];
}

export interface AlignCollisionsResponse {
  episode_id: string;
  run_id: string;
  collisions: AlignCollision[];
}

export async function fetchAlignRunStats(
  episodeId: string,
  runId: string,
): Promise<AlignRunStats> {
  return apiGet<AlignRunStats>(
    `/episodes/${epSeg(episodeId)}/alignment_runs/${epSeg(runId)}/stats`,
  );
}

export async function fetchAuditLinks(
  episodeId: string,
  runId: string,
  params: { status?: string; q?: string; offset?: number; limit?: number } = {},
): Promise<AuditLinksResponse> {
  const qs = new URLSearchParams();
  if (params.status)  qs.set("status", params.status);
  if (params.q)       qs.set("q", params.q);
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.limit  != null) qs.set("limit",  String(params.limit));
  const query = qs.toString() ? `?${qs}` : "";
  return apiGet<AuditLinksResponse>(
    `/episodes/${epSeg(episodeId)}/alignment_runs/${epSeg(runId)}/links${query}`,
  );
}

export async function fetchAlignCollisions(
  episodeId: string,
  runId: string,
): Promise<AlignCollisionsResponse> {
  return apiGet<AlignCollisionsResponse>(
    `/episodes/${epSeg(episodeId)}/alignment_runs/${epSeg(runId)}/collisions`,
  );
}

export async function setAlignLinkStatus(
  linkId: string,
  status: "accepted" | "rejected" | "auto" | "ignored",
): Promise<{ link_id: string; status: string }> {
  return apiPatch(`/alignment_links/${epSeg(linkId)}`, { status });
}

export async function setAlignLinkNote(
  linkId: string,
  note: string,
): Promise<{ link_id: string; note: string }> {
  return apiPatch(`/alignment_links/${epSeg(linkId)}`, { note });
}

export interface BulkAlignStatusParams {
  new_status: "accepted" | "rejected" | "auto" | "ignored";
  /** Mode liste : liste explicite de link_ids à mettre à jour. */
  link_ids?: string[];
  /** Mode filtre : ne met à jour que les liens ayant ce statut courant. */
  filter_status?: "accepted" | "rejected" | "auto" | "ignored";
  /** Mode filtre : ne met à jour que les liens avec confidence < cette valeur (0–1). */
  conf_lt?: number;
}

export async function bulkSetAlignLinkStatus(
  episodeId: string,
  runId: string,
  params: BulkAlignStatusParams,
): Promise<{ updated: number; new_status: string }> {
  return apiPatch(
    `/episodes/${epSeg(episodeId)}/alignment_runs/${epSeg(runId)}/links/bulk`,
    params,
  );
}

// ── Retarget cues (MX-040) ───────────────────────────────────────────────────

export interface SubtitleCue {
  cue_id: string;
  episode_id: string;
  lang: string;
  /** Numéro de séquence dans le fichier SRT. */
  n: number;
  start_ms: number;
  end_ms: number;
  text_raw: string;
  text_clean: string;
}

export interface SubtitleCuesResponse {
  episode_id: string;
  lang: string;
  total: number;
  offset: number;
  limit: number;
  cues: SubtitleCue[];
}

export async function fetchSubtitleCues(
  episodeId: string,
  params: {
    lang: string;
    q?: string;
    around_cue_id?: string;
    around_window?: number;
    limit?: number;
    offset?: number;
  },
): Promise<SubtitleCuesResponse> {
  const qs = new URLSearchParams({ lang: params.lang });
  if (params.q)              qs.set("q",              params.q);
  if (params.around_cue_id)  qs.set("around_cue_id",  params.around_cue_id);
  if (params.around_window != null) qs.set("around_window", String(params.around_window));
  if (params.limit  != null) qs.set("limit",  String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  return apiGet<SubtitleCuesResponse>(`/episodes/${epSeg(episodeId)}/subtitle_cues?${qs}`);
}

/** Toutes les cues d’une langue (pagination serveur max 100). */
export async function fetchAllSubtitleCues(episodeId: string, lang: string): Promise<SubtitleCue[]> {
  const out: SubtitleCue[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const r = await fetchSubtitleCues(episodeId, { lang, limit, offset });
    out.push(...r.cues);
    if (out.length >= r.total || r.cues.length === 0) break;
    offset += limit;
  }
  return out;
}

export async function patchSubtitleCue(
  cueId: string,
  textClean: string,
): Promise<{ cue_id: string; text_clean: string }> {
  return apiPatch(`/subtitle_cues/${encodeURIComponent(cueId)}`, { text_clean: textClean });
}

export async function retargetAlignLink(
  linkId: string,
  cueIdTarget: string,
): Promise<{ link_id: string; cue_id_target: string; status: string }> {
  return apiPatch(`/alignment_links/${epSeg(linkId)}/retarget`, { cue_id_target: cueIdTarget });
}

// ── Concordancier parallèle + Segments longtext (MX-029) ─────────────────────

export interface ConcordanceRow {
  segment_id: string | null;
  speaker: string;
  text_segment: string;
  text_en: string;
  confidence_pivot: number | null;
  confidence_en: number | null;
  text_fr: string;
  confidence_fr: number | null;
  text_it: string;
  confidence_it: number | null;
}

export interface ConcordanceResponse {
  episode_id: string;
  run_id: string;
  pivot_lang: string;
  total: number;
  /** true si des lignes supplémentaires ont été tronquées (limite MAX_KWIC_HITS atteinte). */
  has_more?: boolean;
  rows: ConcordanceRow[];
}

export interface SegmentRow {
  segment_id: string;
  n: number;
  kind: string;
  text: string;
  speaker_explicit: string | null;
}

export interface SegmentsResponse {
  episode_id: string;
  kind: string;
  total: number;
  segments: SegmentRow[];
}

export async function fetchConcordance(
  episodeId: string,
  runId: string,
  params: { status?: string; q?: string } = {},
): Promise<ConcordanceResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q)      qs.set("q", params.q);
  const query = qs.toString() ? `?${qs}` : "";
  return apiGet<ConcordanceResponse>(
    `/episodes/${epSeg(episodeId)}/alignment_runs/${epSeg(runId)}/concordance${query}`,
  );
}

export async function fetchEpisodeSegments(
  episodeId: string,
  kind: "sentence" | "utterance" = "sentence",
  q?: string,
): Promise<SegmentsResponse> {
  const qs = new URLSearchParams({ kind });
  if (q) qs.set("q", q);
  return apiGet<SegmentsResponse>(`/episodes/${epSeg(episodeId)}/segments?${qs}`);
}

export async function patchSegment(
  episodeId: string,
  segmentId: string,
  patch: { text?: string; speaker_explicit?: string | null },
): Promise<SegmentRow> {
  return apiPatch<SegmentRow>(`/episodes/${epSeg(episodeId)}/segments/${epSeg(segmentId)}`, patch);
}

export async function cancelJob(jobId: string): Promise<{ job_id: string; status: string }> {
  return apiDelete(`/jobs/${epSeg(jobId)}`);
}

// ── /characters + /assignments (MX-021c) ─────────────────────────────────────

export interface Character {
  id: string;
  canonical: string;
  names_by_lang: Record<string, string>;
  aliases: string[];
}

export interface CharactersResponse {
  characters: Character[];
}

export interface CharacterAssignment {
  /** segment_id or cue_id */
  segment_id?: string;
  cue_id?: string;
  character_id: string;
  /** Raw speaker label from SRT/transcript (for display) */
  speaker_label?: string;
  episode_id?: string;
  source_key?: string;
}

export interface AssignmentsResponse {
  assignments: CharacterAssignment[];
}

export async function fetchCharacters(): Promise<CharactersResponse> {
  return apiGet<CharactersResponse>("/characters");
}

export async function saveCharacters(characters: Character[]): Promise<{ saved: number }> {
  return apiPut<{ saved: number }>("/characters", { characters });
}

/** Locuteurs distincts des segments → entrées catalogue (équivalent PyQt « Importer depuis les segments »). */
export async function importCharactersFromSegments(episodeIds?: string[] | null): Promise<{
  added: number;
  total_characters: number;
  distinct_speakers_found: number;
  message?: string;
}> {
  return apiPost("/characters/import_from_segments", { episode_ids: episodeIds ?? null });
}

export async function fetchAssignments(): Promise<AssignmentsResponse> {
  return apiGet<AssignmentsResponse>("/assignments");
}

export async function saveAssignments(
  assignments: CharacterAssignment[],
): Promise<{ saved: number }> {
  return apiPut<{ saved: number }>("/assignments", { assignments });
}


// ── Web sources (MX-021b) ─────────────────────────────────────────────────────

export interface WebEpisodeRef {
  episode_id: string;
  season: number;
  episode: number;
  title: string;
  url: string;
}

export interface WebDiscoverResult {
  series_title: string;
  series_url: string;
  episode_count: number;
  episodes: WebEpisodeRef[];
}

export async function discoverTvmaze(series_name: string): Promise<WebDiscoverResult> {
  return apiPost<WebDiscoverResult>("/web/tvmaze/discover", { series_name });
}

export async function discoverSubslikescript(series_url: string): Promise<WebDiscoverResult> {
  return apiPost<WebDiscoverResult>("/web/subslikescript/discover", { series_url });
}

export async function fetchSubslikescriptTranscript(
  episode_id: string,
  episode_url: string,
): Promise<{ episode_id: string; source_key: string; chars: number; state: string }> {
  return apiPost<{ episode_id: string; source_key: string; chars: number; state: string }>(
    "/web/subslikescript/fetch_transcript",
    { episode_id, episode_url },
  );
}


// ── Export (Exporter section) ─────────────────────────────────────────────────

export interface ExportResult {
  scope: string;
  fmt: string;
  episodes?: number;
  segments?: number;
  jobs?: number;
  characters?: number;
  assignments?: number;
  path: string;
}

export async function runExport(
  scope: "corpus" | "segments" | "jobs" | "characters" | "assignments",
  fmt: string,
  use_clean = true,
): Promise<ExportResult> {
  return apiPost<ExportResult>("/export", { scope, fmt, use_clean });
}

export interface QaIssue {
  level: "blocking" | "warning";
  code: string;
  episode?: string;
  message: string;
}

export interface QaReport {
  gate: "ok" | "warnings" | "blocking";
  policy: "lenient" | "strict";
  total_episodes: number;
  n_raw: number;
  n_normalized: number;
  n_segmented: number;
  n_with_srts: number;
  n_alignment_runs: number;
  issues: QaIssue[];
}

export async function fetchQaReport(policy: "lenient" | "strict" = "lenient"): Promise<QaReport> {
  return apiGet<QaReport>(`/export/qa?policy=${policy}`);
}

// ── /assignments/auto (MX-032) ───────────────────────────────────────────────

export interface AutoAssignResult {
  created: number;
  total_after: number;
  unmatched_labels: string[];
  dry_run: boolean;
}

export async function autoAssignCharacters(dryRun = false): Promise<AutoAssignResult> {
  return apiPost<AutoAssignResult>(`/assignments/auto${dryRun ? "?dry_run=true" : ""}`, {});
}

// ── /episodes/{id}/propagate_characters (MX-031) ─────────────────────────────

export interface PropagateResult {
  episode_id: string;
  run_id: string;
  nb_segments_updated: number;
  nb_cues_updated: number;
}

export async function propagateCharacters(
  episodeId: string,
  runId: string,
): Promise<PropagateResult> {
  return apiPost<PropagateResult>(
    `/episodes/${epSeg(episodeId)}/propagate_characters`,
    { run_id: runId },
  );
}

// ── /alignment_runs (MX-030) ──────────────────────────────────────────────────

export interface AlignmentRunFlat extends AlignmentRun {
  // same shape as AlignmentRun, listed together for all episodes
}

export interface AllAlignmentRunsResponse {
  runs: AlignmentRunFlat[];
}

export async function fetchAllAlignmentRuns(): Promise<AllAlignmentRunsResponse> {
  return apiGet<AllAlignmentRunsResponse>("/alignment_runs");
}

// ── /links/positions minimap (MX-047) ─────────────────────────────────────────

export interface LinkPosition {
  n: number;
  status: string;
}

export async function fetchLinkPositions(
  episodeId: string,
  runId: string,
): Promise<{ positions: LinkPosition[] }> {
  return apiGet(`/episodes/${epSeg(episodeId)}/alignment_runs/${epSeg(runId)}/links/positions`);
}

// ── /export/alignments (MX-030) ───────────────────────────────────────────────

export interface AlignExportResult {
  episode_id: string;
  run_id: string;
  fmt: string;
  rows: number;
  path: string;
}

export async function exportAlignments(
  episodeId: string,
  runId: string,
  fmt: "csv" | "tsv" = "csv",
): Promise<AlignExportResult> {
  const qs = new URLSearchParams({ episode_id: episodeId, run_id: runId, fmt });
  return apiGet<AlignExportResult>(`/export/alignments?${qs}`);
}

// ── /stats (statistiques lexicales) ──────────────────────────────────────────

export interface StatsSlot {
  episode_ids?: string[] | null;
  kind?: string | null;
  speaker?: string | null;
  top_n?: number;
  min_length?: number;
}

export interface StatsWord {
  word: string;
  count: number;
  freq_pct: number;
}

export interface StatsResult {
  label: string;
  total_tokens: number;
  total_segments: number;
  total_episodes: number;
  vocabulary_size: number;
  avg_tokens_per_segment: number;
  top_words: StatsWord[];
  rare_words: StatsWord[];
}

export interface StatsCompareWord {
  word: string;
  count_a: number;
  count_b: number;
  freq_a: number;
  freq_b: number;
  ratio: number;
}

export interface StatsCompareResult {
  label_a: string;
  label_b: string;
  a: StatsResult;
  b: StatsResult;
  comparison: StatsCompareWord[];
}

export async function fetchLexicalStats(slot: StatsSlot, label?: string): Promise<StatsResult> {
  return apiPost<StatsResult>("/stats/lexical", { slot, label: label ?? "" });
}

export async function fetchStatsCompare(
  a: StatsSlot,
  b: StatsSlot,
  labelA?: string,
  labelB?: string,
): Promise<StatsCompareResult> {
  return apiPost<StatsCompareResult>("/stats/compare", {
    a, b, label_a: labelA ?? "A", label_b: labelB ?? "B",
  });
}
