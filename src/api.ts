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
