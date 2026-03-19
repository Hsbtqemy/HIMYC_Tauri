/**
 * api.ts — Client API HIMYC backend
 *
 * Tous les appels vers le backend Python passent par `sidecar_fetch_loopback`
 * (commande Tauri Rust) qui contourne les restrictions CSP Tauri pour loopback.
 * Jamais de fetch() direct vers localhost depuis le frontend.
 */

import { invoke } from "@tauri-apps/api/core";

export const API_BASE = "http://localhost:8765";

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

async function _loopbackFetch(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<FetchResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  return invoke<FetchResult>("sidecar_fetch_loopback", {
    url: `${API_BASE}${path}`,
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers,
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await _loopbackFetch(path);
  if (!res.ok) {
    let errorCode = "UNKNOWN";
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

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await _loopbackFetch(path, "POST", body);
  if (!res.ok) {
    let errorCode = "UNKNOWN";
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
    let errorCode = "UNKNOWN";
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
  languages: string[];
  normalize_profile: string;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  return apiGet<ConfigResponse>("/config");
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

export async function cancelJob(jobId: string): Promise<{ job_id: string; status: string }> {
  // DELETE via loopback — réutilise _loopbackFetch directement
  const res = await (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ status: number; ok: boolean; body: string }>(
      "sidecar_fetch_loopback",
      {
        url: `${API_BASE}/jobs/${jobId}`,
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      },
    );
  })();
  if (!res.ok) {
    let errorCode = "UNKNOWN";
    let message = res.body;
    try {
      const p = JSON.parse(res.body);
      errorCode = p.error ?? errorCode;
      message = p.message ?? message;
    } catch { /* not JSON */ }
    throw new ApiError(res.status, errorCode, message);
  }
  return JSON.parse(res.body);
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
