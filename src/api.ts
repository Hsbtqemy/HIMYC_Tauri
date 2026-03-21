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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await _loopbackFetch(path);
  if (!res.ok) {
    let errorCode = DEFAULT_ERROR_CODE;
    let message = res.body;
    try {
      const parsed = JSON.parse(res.body);
      errorCode = parsed.error ?? errorCode;
      message = parsed.message ?? message;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, errorCode, message);
  }
  return JSON.parse(res.body) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiPost<T>(path, body, "PATCH");
}

export async function apiPost<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const res = await _loopbackFetch(path, method, body);
  if (!res.ok) {
    let errorCode = DEFAULT_ERROR_CODE;
    let message = res.body;
    try {
      const parsed = JSON.parse(res.body);
      errorCode = parsed.error ?? errorCode;
      message = parsed.message ?? message;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, errorCode, message);
  }
  return JSON.parse(res.body) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await _loopbackFetch(path, "PUT", body);
  if (!res.ok) {
    let errorCode = DEFAULT_ERROR_CODE;
    let message = res.body;
    try {
      const parsed = JSON.parse(res.body);
      errorCode = parsed.error ?? errorCode;
      message = parsed.message ?? message;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, errorCode, message);
  }
  return JSON.parse(res.body) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await _loopbackFetch(path, "DELETE");
  if (!res.ok) {
    let errorCode = DEFAULT_ERROR_CODE;
    let message = res.body;
    try {
      const parsed = JSON.parse(res.body);
      errorCode = parsed.error ?? errorCode;
      message = parsed.message ?? message;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, errorCode, message);
  }
  return JSON.parse(res.body) as T;
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
  return apiGet<SourceContent>(`/episodes/${episodeId}/sources/${sourceKey}`);
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
  return apiPost<ImportResult>(`/episodes/${episodeId}/sources/transcript`, {
    content,
  });
}

export async function deleteTranscript(
  episodeId: string,
): Promise<{ episode_id: string; source_key: string; removed: string[] }> {
  return apiDelete(`/episodes/${episodeId}/sources/transcript`);
}

export async function deleteSrt(
  episodeId: string,
  lang: string,
): Promise<{ episode_id: string; source_key: string; lang: string }> {
  return apiDelete(`/episodes/${episodeId}/sources/srt_${lang}`);
}

export async function patchTranscript(
  episodeId: string,
  clean: string,
): Promise<{ episode_id: string; source_key: string; state: string; chars: number }> {
  return apiPatch(`/episodes/${episodeId}/sources/transcript`, { clean });
}

export async function fetchNormalizePreview(
  text: string,
  profile: string,
  options: Record<string, unknown>,
): Promise<{ clean: string; merges: number }> {
  return apiPost<{ clean: string; merges: number }>("/normalize/preview", { text, profile, options });
}

export async function importSrt(
  episodeId: string,
  lang: string,
  content: string,
  fmt: "srt" | "vtt" = "srt",
): Promise<ImportResult> {
  return apiPost<ImportResult>(`/episodes/${episodeId}/sources/srt_${lang}`, {
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
  | "align";

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
  return apiGet<JobRecord>(`/jobs/${jobId}`);
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
  return apiGet<AlignmentRunsResponse>(`/episodes/${episodeId}/alignment_runs`);
}

// ── Alignment Audit (MX-028) ──────────────────────────────────────────────────

export interface AlignRunStats {
  episode_id: string;
  run_id: string;
  nb_links: number;
  nb_pivot: number;
  nb_target: number;
  by_status: { auto?: number; accepted?: number; rejected?: number; ignored?: number };
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
    `/episodes/${episodeId}/alignment_runs/${runId}/stats`,
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
    `/episodes/${episodeId}/alignment_runs/${runId}/links${query}`,
  );
}

export async function fetchAlignCollisions(
  episodeId: string,
  runId: string,
): Promise<AlignCollisionsResponse> {
  return apiGet<AlignCollisionsResponse>(
    `/episodes/${episodeId}/alignment_runs/${runId}/collisions`,
  );
}

export async function setAlignLinkStatus(
  linkId: string,
  status: "accepted" | "rejected" | "auto" | "ignored",
): Promise<{ link_id: string; status: string }> {
  return apiPatch(`/alignment_links/${linkId}`, { status });
}

export async function setAlignLinkNote(
  linkId: string,
  note: string,
): Promise<{ link_id: string; note: string }> {
  return apiPatch(`/alignment_links/${linkId}`, { note });
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
    `/episodes/${episodeId}/alignment_runs/${runId}/links/bulk`,
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
  return apiGet<SubtitleCuesResponse>(`/episodes/${episodeId}/subtitle_cues?${qs}`);
}

export async function retargetAlignLink(
  linkId: string,
  cueIdTarget: string,
): Promise<{ link_id: string; cue_id_target: string; status: string }> {
  return apiPatch(`/alignment_links/${linkId}/retarget`, { cue_id_target: cueIdTarget });
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
    `/episodes/${episodeId}/alignment_runs/${runId}/concordance${query}`,
  );
}

export async function fetchEpisodeSegments(
  episodeId: string,
  kind: "sentence" | "utterance" = "sentence",
  q?: string,
): Promise<SegmentsResponse> {
  const qs = new URLSearchParams({ kind });
  if (q) qs.set("q", q);
  return apiGet<SegmentsResponse>(`/episodes/${episodeId}/segments?${qs}`);
}

export async function patchSegment(
  episodeId: string,
  segmentId: string,
  patch: { text?: string; speaker_explicit?: string | null },
): Promise<SegmentRow> {
  return apiPatch<SegmentRow>(`/episodes/${episodeId}/segments/${segmentId}`, patch);
}

export async function cancelJob(jobId: string): Promise<{ job_id: string; status: string }> {
  return apiDelete(`/jobs/${jobId}`);
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
    `/episodes/${episodeId}/propagate_characters`,
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
  return apiGet(`/episodes/${episodeId}/alignment_runs/${runId}/links/positions`);
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
