/**
 * constituerModule.ts — Mode Constituer (MX-005 + MX-006)
 *
 * Vue principale pour la constitution du corpus :
 * - Table épisodes + colonnes sources (transcript + SRT multi-langues)
 * - Badges état par source (raw / normalized / segmented / ready)
 * - Import transcript et SRT via dialog Tauri (lecture fichier → POST backend)
 * - Dépendances de sources visibles (transcript manquant → SRT bloqué)
 * - Panneau jobs : queue normalisation/segmentation + polling auto (MX-006)
 */

import type { ShellContext } from "../context";
import {
  fetchEpisodes,
  fetchConfig,
  importTranscript,
  importSrt,
  fetchJobs,
  createJob,
  cancelJob,
  fetchCharacters,
  saveCharacters,
  fetchAssignments,
  saveAssignments,
  discoverTvmaze,
  discoverSubslikescript,
  fetchSubslikescriptTranscript,
  runExport,
  type ExportResult,
  type Episode,
  type EpisodeSource,
  type EpisodesResponse,
  type ConfigResponse,
  type JobRecord,
  type JobType,
  type Character,
  type CharacterAssignment,
  type WebEpisodeRef,
  ApiError,
} from "../api";
import {
  guardImportTranscript,
  guardImportSrt,
  guardBatchNormalize,
  guardedAction,
} from "../guards";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { measureAsync } from "../perf";

// ── CSS module ─────────────────────────────────────────────────────────────

const CSS = `
/* ── Sidebar shell (AGRAFES port) ───────────────────────────── */
:root { --cons-nav-w: 220px; }
.cons-shell {
  display: grid;
  grid-template-columns: var(--cons-nav-w) 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.cons-shell.nav-hidden { grid-template-columns: 28px 1fr; }
.cons-shell.nav-hidden .cons-nav  { display: none; }
.cons-shell.nav-hidden .cons-rail { display: flex; }

.cons-nav {
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 10px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cons-nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 4px;
}
.cons-nav-head h2 {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-muted);
  font-weight: 700;
}
.cons-nav-collapse-btn {
  border: 1px solid rgba(30,74,128,0.3);
  border-radius: 6px;
  color: #1e4a80;
  background: #eaf1fb;
  width: 24px; height: 24px;
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  font-size: 10px;
  flex-shrink: 0;
  transition: background .12s;
  font-family: inherit;
}
.cons-nav-collapse-btn:hover { background: #d8e8f8; }

.cons-nav-tab {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 9px 10px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: background .12s, border-color .12s;
  font-family: inherit;
  display: block;
}
.cons-nav-tab:hover { background: #f0faf8; border-color: #cfe8e3; }
.cons-nav-tab.active {
  background: #e8f5f3;
  border-color: #9fd3cc;
  color: #0c4a46;
  font-weight: 700;
}

.cons-rail {
  display: none;
  width: 28px;
  border-right: 1px solid var(--border);
  background: linear-gradient(180deg, #f3f8f7, #eef3f2);
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
}
.cons-rail-expand-btn {
  border: 1px solid rgba(30,74,128,0.3);
  border-radius: 6px;
  color: #1e4a80;
  background: #eaf1fb;
  width: 20px; height: 20px;
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
}

/* Actions nav tree */
.cons-nav-tree { margin: 2px 0 4px 2px; }
.cons-nav-tree-summary {
  list-style: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
  border: 1px solid #cfe8e3;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #0c4a46;
  background: #edf7f5;
  user-select: none;
}
.cons-nav-tree-summary::-webkit-details-marker { display: none; }
.cons-nav-tree-caret { font-size: 10px; color: var(--text-muted); transition: transform .15s ease; }
.cons-nav-tree[open] .cons-nav-tree-caret { transform: rotate(180deg); }
.cons-nav-tree-body {
  margin: 2px 0 0 6px;
  padding: 3px 0 0 8px;
  border-left: 2px solid #cfe8e3;
  display: grid;
  gap: 2px;
}
.cons-nav-tree-link {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 8px;
  background: transparent;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background .1s, border-color .1s;
  font-family: inherit;
}
.cons-nav-tree-link:hover { border-color: #cfe8e3; background: #f6fbfa; }
.cons-nav-tree-link.active {
  border-color: #9fd3cc;
  background: #e8f5f3;
  color: #0c4a46;
  font-weight: 700;
}

.cons-main {
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.cons-section-pane { display: none; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
.cons-section-pane.active { display: flex; }

/* ── Actions sub-views ──────────────────────────────────────── */
.cons-actions-pane { display: none; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
.cons-actions-pane.active { display: flex; }

.acts-hub {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.acts-hub-title { font-size: 1rem; font-weight: 700; color: var(--text); margin-bottom: 0.2rem; }
.acts-hub-desc { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem; }
.acts-hub-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
}
.acts-hub-card {
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 1.5);
  padding: 1rem;
  background: var(--surface);
  cursor: pointer;
  transition: border-color .15s, background .15s, box-shadow .15s;
  text-align: left;
  font-family: inherit;
}
.acts-hub-card:hover { border-color: #9fd3cc; background: #f6fbfa; box-shadow: 0 2px 8px rgba(15,118,110,0.08); }
.acts-hub-card-icon { font-size: 1.4rem; margin-bottom: 0.5rem; }
.acts-hub-card-title { font-size: 0.88rem; font-weight: 700; color: var(--text); margin-bottom: 0.2rem; }
.acts-hub-card-desc { font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; }

.acts-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 3px 7px;
  border-radius: var(--radius);
  transition: color .12s, background .12s;
  font-family: inherit;
  margin-right: 4px;
}
.acts-back-btn:hover { color: var(--text); background: var(--surface2); }

.cons-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.75rem;
  color: var(--text-muted);
  text-align: center;
  padding: 2rem;
}
.cons-placeholder-icon { font-size: 2rem; }
.cons-placeholder-title { font-size: 0.95rem; font-weight: 600; color: var(--text); }
.cons-placeholder-desc { font-size: 0.8rem; line-height: 1.5; max-width: 320px; }

/* ── Cards (Importer) ───────────────────────────────────────── */
.cons-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 1.5);
  padding: 1rem 1.25rem;
}
.cons-card-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.6rem;
}
.cons-card-body { font-size: 0.85rem; }

/* ── Search ─────────────────────────────────────────────────── */
.cons-search { outline: none; }
.cons-search:focus { border-color: var(--accent) !important; }

/* ── Jobs panel ────────────────────────────────────────────── */
.cons-jobs {
  border-top: 1px solid var(--border);
  background: var(--surface2);
  flex-shrink: 0;
  max-height: 220px;
  overflow-y: auto;
}
.cons-jobs-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  cursor: pointer;
  user-select: none;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.cons-jobs-header:hover { background: var(--border); }
.cons-jobs-header .cons-jobs-count {
  margin-left: auto;
  font-weight: 400;
  font-size: 0.75rem;
}
.cons-jobs-list { padding: 4px 0; }
.cons-job-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  font-size: 0.77rem;
  border-bottom: 1px solid var(--border);
}
.cons-job-row:last-child { border-bottom: none; }
.cons-job-status {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cons-job-status.pending   { background: var(--warning); }
.cons-job-status.running   { background: var(--brand); animation: himyc-pulse 1s infinite; }
.cons-job-status.done      { background: var(--success); }
.cons-job-status.error     { background: var(--danger); }
.cons-job-status.cancelled { background: var(--text-muted); }
.cons-job-label { flex: 1; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cons-job-ep    { font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--text-muted); }
.cons-job-err   { color: var(--danger); font-size: 0.72rem; margin-left: 6px; overflow: hidden; text-overflow: ellipsis; max-width: 180px; white-space: nowrap; }
.cons-jobs-actions { display: flex; gap: 6px; padding: 6px 16px; border-bottom: 1px solid var(--border); }
.cons-jobs-empty { padding: 10px 16px; color: var(--text-muted); font-size: 0.77rem; font-style: italic; }

/* ── Personnages ────────────────────────────────────────────── */
.pers-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.pers-toolbar-title { font-size: 0.95rem; font-weight: 700; color: var(--text); flex: 1; }
.pers-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.pers-list {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pers-list-header {
  padding: 8px 12px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
}
.pers-list-scroll { flex: 1; overflow-y: auto; }
.pers-char-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
  transition: background 0.12s;
}
.pers-char-item:hover { background: var(--surface2); }
.pers-char-item.active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-left: 3px solid var(--accent);
  padding-left: 9px;
}
.pers-char-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.pers-char-count { font-size: 0.7rem; color: var(--text-muted); }
.pers-empty-list { padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 0.8rem; font-style: italic; }
.pers-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pers-detail-scroll { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.pers-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 0.85rem;
  gap: 0.5rem;
}
.pers-field { display: flex; flex-direction: column; gap: 4px; }
.pers-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.pers-input {
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 0.82rem;
  outline: none;
}
.pers-input:focus { border-color: var(--accent); }
.pers-textarea { min-height: 60px; resize: vertical; }
.pers-langs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
.pers-lang-item { display: flex; flex-direction: column; gap: 3px; }
.pers-lang-code { font-size: 0.68rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
.pers-detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.pers-msg { font-size: 0.78rem; margin-left: auto; }
.pers-msg.ok  { color: var(--success, #16a34a); }
.pers-msg.err { color: var(--danger, #dc2626); }

/* ── Root layout ───────────────────────────────────────────── */
.cons-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar */
.cons-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.cons-toolbar-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  flex: 1;
}
.cons-toolbar-series {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-style: italic;
}
.cons-api-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.cons-api-dot.online  { background: var(--success); }
.cons-api-dot.offline { background: var(--danger); }

/* Table */
.cons-table-wrap {
  flex: 1;
  overflow: auto;
  padding: 0 16px 16px;
}
.cons-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
  margin-top: 12px;
}
.cons-table th {
  text-align: left;
  padding: 6px 10px;
  background: var(--surface2);
  border-bottom: 2px solid var(--border);
  color: var(--text-muted);
  font-weight: 600;
  white-space: nowrap;
}
.cons-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.cons-table tr:hover td { background: #f9fafb; }

/* State badges */
.cons-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 10px;
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}
.cons-badge.absent   { background: #f3f4f6; color: #9ca3af; }
.cons-badge.raw      { background: #fef9c3; color: #92400e; }
.cons-badge.normalized { background: #dbeafe; color: #1e40af; }
.cons-badge.segmented  { background: #e0e7ff; color: #3730a3; }
.cons-badge.ready    { background: #dcfce7; color: #166534; }

/* Action cell */
.cons-actions { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }

/* Pagination */
.cons-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 0.78rem;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
}
.cons-pagination-gap { flex: 1; }

/* Empty/error states */
.cons-empty {
  padding: 3rem 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
.cons-error {
  margin: 12px 16px;
  padding: 10px 14px;
  border-radius: 6px;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #991b1b;
  font-size: 0.82rem;
}
.cons-loading {
  padding: 3rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* Web sources (MX-021b) */
.web-src-tabs { display: flex; gap: 2px; margin-bottom: 10px; border-bottom: 1px solid var(--border); }
.web-src-tab {
  padding: 5px 14px;
  font-size: 0.8rem;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
}
.web-src-tab:hover { color: var(--text); background: var(--surface2); }
.web-src-tab.active { color: var(--accent, #0f766e); border-bottom-color: var(--accent, #0f766e); font-weight: 600; }
.web-src-pane { display: none; }
.web-src-pane.active { display: block; }
.web-src-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.web-src-input {
  flex: 1;
  min-width: 200px;
  padding: 5px 9px;
  font-size: 0.82rem;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
}
.web-src-input:focus { outline: none; border-color: var(--accent, #0f766e); }
.web-src-results { margin-top: 8px; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; }
.web-src-results table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.web-src-results th { position: sticky; top: 0; background: var(--surface2); padding: 5px 8px; text-align: left; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
.web-src-results td { padding: 4px 8px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: middle; }
.web-src-results tr:last-child td { border-bottom: none; }
.web-src-results tr:hover td { background: var(--surface2); }
.web-src-feedback { margin-top: 6px; font-size: 0.78rem; color: var(--text-muted); min-height: 1.2em; }

/* Exporter section */
.exp-section { padding: 1.25rem; overflow-y: auto; height: 100%; display: flex; flex-direction: column; gap: 1rem; }
.exp-card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
@media (max-width: 600px) { .exp-card-grid { grid-template-columns: 1fr; } }
.exp-fmt-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.exp-result {
  margin-top: 8px;
  font-size: 0.78rem;
  padding: 6px 10px;
  border-radius: 5px;
  background: var(--surface2);
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  word-break: break-all;
  display: none;
}
.exp-result.visible { display: block; }
.exp-result.ok { color: var(--success, #16a34a); background: #f0fdf4; }
.exp-result.err { color: var(--danger, #dc2626); background: #fef2f2; }
`;

// ── Module state ────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;
let _container: HTMLElement | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _jobsExpanded = true;
let _activeSection = "actions";
let _activeActionsSubView: "hub" | "curation" | "segmentation" | "alignement" = "hub";
let _navCollapsed = false;
let _page = 0;
/** Données épisodes en cache pour Documents (rechargées à chaque mount section) */
let _cachedEpisodes: EpisodesResponse | null = null;
/** Config projet en cache */
let _cachedConfig: ConfigResponse | null = null;
/** Référence ShellContext (nécessaire pour navigateTo depuis Documents) */
let _ctx: ShellContext | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function stateBadge(source: EpisodeSource): string {
  if (!source.available) {
    return `<span class="cons-badge absent">—</span>`;
  }
  const state = source.state ?? "unknown";
  const labels: Record<string, string> = {
    unknown: "?",
    raw: "brut",
    normalized: "normalisé",
    segmented: "segmenté",
    ready_for_alignment: "prêt",
  };
  const cls =
    state === "ready_for_alignment"
      ? "ready"
      : (state === "unknown" ? "raw" : state);
  const label = labels[state] ?? state;
  const extra =
    source.nb_cues != null ? ` <span style="opacity:.7">${source.nb_cues} cues</span>` : "";
  return `<span class="cons-badge ${escapeHtml(cls)}">${escapeHtml(label)}${extra}</span>`;
}

/** Collecte toutes les langues SRT présentes dans les épisodes. */
function collectSrtLangs(episodes: Episode[]): string[] {
  const langs = new Set<string>();
  for (const ep of episodes) {
    for (const s of ep.sources) {
      if (s.source_key.startsWith("srt_")) {
        langs.add(s.source_key.slice(4));
      }
    }
  }
  return [...langs].sort();
}

function sourceForKey(ep: Episode, key: string): EpisodeSource | undefined {
  return ep.sources.find((s) => s.source_key === key);
}

// ── Jobs helpers ────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  normalize_transcript: "Normaliser transcript",
  normalize_srt:        "Normaliser SRT",
  segment_transcript:   "Segmenter transcript",
};

function renderJobsPanel(container: HTMLElement, jobs: JobRecord[]) {
  const panel = container.querySelector<HTMLElement>(".cons-jobs");
  if (!panel) return;

  const active = jobs.filter((j) => j.status === "pending" || j.status === "running");
  const countLabel = active.length > 0 ? `${active.length} actif(s)` : `${jobs.length} total`;

  const header = panel.querySelector<HTMLElement>(".cons-jobs-header");
  if (header) {
    const countEl = header.querySelector(".cons-jobs-count");
    if (countEl) countEl.textContent = countLabel;
  }

  const listEl = panel.querySelector<HTMLElement>(".cons-jobs-list");
  if (!listEl) return;

  if (jobs.length === 0) {
    listEl.innerHTML = `<div class="cons-jobs-empty">Aucun job en file.</div>`;
    return;
  }

  listEl.innerHTML = jobs
    .slice(0, 50)
    .map((j) => {
      const label = escapeHtml(JOB_LABELS[j.job_type] ?? j.job_type);
      const ep    = escapeHtml(j.episode_id);
      const sk    = j.source_key ? ` / ${escapeHtml(j.source_key)}` : "";
      const err   = j.error_msg ? `<span class="cons-job-err" title="${escapeHtml(j.error_msg)}">${escapeHtml(j.error_msg)}</span>` : "";
      const cancelBtn =
        j.status === "pending"
          ? `<button class="btn btn-ghost" style="font-size:10px;padding:1px 5px" data-cancel="${escapeHtml(j.job_id)}">✕</button>`
          : "";
      return `
        <div class="cons-job-row">
          <span class="cons-job-status ${escapeHtml(j.status)}"></span>
          <span class="cons-job-label">${label}</span>
          <span class="cons-job-ep">${ep}${sk}</span>
          ${err}
          ${cancelBtn}
        </div>`;
    })
    .join("");

  // Wire cancel buttons
  listEl.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await cancelJob(btn.dataset.cancel!);
        await refreshJobs(container);
      } catch { /* ignore */ }
    });
  });
}

async function refreshJobs(container: HTMLElement) {
  try {
    const { jobs } = await fetchJobs();
    renderJobsPanel(container, jobs);
    // Polling actif tant que jobs pending/running
    const hasActive = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (!hasActive) stopJobPoll();
  } catch { /* backend down — stop poll */ stopJobPoll(); }
}

function startJobPoll(container: HTMLElement) {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => refreshJobs(container), 2000);
}

function stopJobPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function queueBatchNormalize(
  episodes: Episode[],
  container: HTMLElement,
) {
  // Garde côté handler — rejetée même si bouton appelé programmatiquement (MX-008)
  await guardedAction(
    guardBatchNormalize(episodes),
    async () => {
      const toNormalize = episodes.filter((ep) => {
        const t = ep.sources.find((s) => s.source_key === "transcript");
        return t?.available && (t.state === "raw" || t.state === "unknown");
      });
      for (const ep of toNormalize) {
        await createJob("normalize_transcript", ep.episode_id);
      }
      await refreshJobs(container);
      startJobPoll(container);
    },
    (reason) => {
      const errEl = container.querySelector<HTMLElement>(".cons-error");
      if (errEl) { errEl.textContent = reason; errEl.style.display = "block"; }
    },
  );
}

// ── Import handlers ─────────────────────────────────────────────────────────

async function handleImportTranscript(
  episodeId: string,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  try {
    const selected = await open({
      title: `Import transcript — ${episodeId}`,
      multiple: false,
      filters: [
        { name: "Texte", extensions: ["txt"] },
        { name: "Tous fichiers", extensions: ["*"] },
      ],
    });
    if (!selected) return; // annulé
    const path = typeof selected === "string" ? selected : selected;
    const content = await readTextFile(path as string);
    await importTranscript(episodeId, content);
    onDone();
  } catch (e) {
    const msg =
      e instanceof ApiError
        ? `${e.errorCode} — ${e.message}`
        : String(e);
    onError(msg);
  }
}

async function handleImportSrt(
  episodeId: string,
  lang: string,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  try {
    const selected = await open({
      title: `Import SRT ${lang} — ${episodeId}`,
      multiple: false,
      filters: [
        { name: "Sous-titres", extensions: ["srt", "vtt"] },
        { name: "Tous fichiers", extensions: ["*"] },
      ],
    });
    if (!selected) return;
    const filePath = selected as string;
    const content = await readTextFile(filePath);
    const fmt: "srt" | "vtt" = filePath.endsWith(".vtt") ? "vtt" : "srt";
    await importSrt(episodeId, lang, content, fmt);
    onDone();
  } catch (e) {
    const msg =
      e instanceof ApiError
        ? `${e.errorCode} — ${e.message}`
        : String(e);
    onError(msg);
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderTable(
  container: HTMLElement,
  data: EpisodesResponse,
  srtLangs: string[],
  onRefresh: () => void,
) {
  const tableWrap = container.querySelector<HTMLElement>(".cons-table-wrap");
  if (!tableWrap) return;

  if (data.episodes.length === 0) {
    tableWrap.innerHTML = `<div class="cons-empty">Aucun épisode dans ce projet.<br>Vérifiez que <code>series_index.json</code> est présent.</div>`;
    return;
  }

  const total = data.episodes.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  _page = Math.min(_page, pageCount - 1);
  const pageEpisodes = data.episodes.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

  const srtHeaders = srtLangs
    .map((l) => `<th>SRT ${escapeHtml(l.toUpperCase())}</th>`)
    .join("");

  const rows = pageEpisodes
    .map((ep) => {
      const transcript = sourceForKey(ep, "transcript");
      const transcriptCell = transcript
        ? stateBadge(transcript)
        : `<span class="cons-badge absent">—</span>`;

      const srtCells = srtLangs
        .map((lang) => {
          const src = sourceForKey(ep, `srt_${lang}`);
          return `<td>${src ? stateBadge(src) : `<span class="cons-badge absent">—</span>`}</td>`;
        })
        .join("");

      // Actions : import transcript si absent, import SRT toujours possible
      const hasTranscript = transcript?.available ?? false;
      const importTrBtn = !hasTranscript
        ? `<button class="btn btn-primary btn-xs" data-action="import-transcript" data-ep="${escapeHtml(ep.episode_id)}" style="font-size:11px;padding:3px 8px">+ transcript</button>`
        : "";
      const importSrtBtn = `<button class="btn btn-secondary btn-xs" data-action="import-srt" data-ep="${escapeHtml(ep.episode_id)}" style="font-size:11px;padding:3px 8px">+ SRT</button>`;

      return `
        <tr>
          <td style="font-family:ui-monospace,monospace;font-size:0.78rem">${escapeHtml(ep.episode_id)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</td>
          <td>${transcriptCell}</td>
          ${srtCells}
          <td><div class="cons-actions">${importTrBtn}${importSrtBtn}</div></td>
        </tr>`;
    })
    .join("");

  const paginationHtml = pageCount > 1 ? `
    <div class="cons-pagination">
      <button class="btn btn-ghost" id="cons-page-prev" style="font-size:11px;padding:2px 8px" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, total)} / ${total} épisodes</span>
      <button class="btn btn-ghost" id="cons-page-next" style="font-size:11px;padding:2px 8px" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>
    </div>` : `<div class="cons-pagination"><span>${total} épisode${total > 1 ? "s" : ""}</span></div>`;

  tableWrap.innerHTML = `
    <table class="cons-table">
      <thead>
        <tr>
          <th>Épisode</th>
          <th>Titre</th>
          <th>Transcript</th>
          ${srtHeaders}
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${paginationHtml}`;

  tableWrap.querySelector<HTMLButtonElement>("#cons-page-prev")?.addEventListener("click", () => {
    _page = Math.max(0, _page - 1);
    renderTable(container, data, srtLangs, onRefresh);
  });
  tableWrap.querySelector<HTMLButtonElement>("#cons-page-next")?.addEventListener("click", () => {
    _page = Math.min(pageCount - 1, _page + 1);
    renderTable(container, data, srtLangs, onRefresh);
  });

  // Wire import buttons
  tableWrap.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!btn) return;
    btn.disabled = true;

    const action = btn.dataset.action!;
    const epId = btn.dataset.ep!;

    const showErr = (msg: string) => {
      const errEl = container.querySelector<HTMLElement>(".cons-error");
      if (errEl) {
        errEl.textContent = `Erreur import (${epId}) : ${msg}`;
        errEl.style.display = "block";
      }
      btn.disabled = false;
    };

    const hideErr = () => {
      const errEl = container.querySelector<HTMLElement>(".cons-error");
      if (errEl) errEl.style.display = "none";
    };

    if (action === "import-transcript") {
      hideErr();
      // Garde import transcript — avertissement si écrasement (MX-008)
      const ep = data.episodes.find((e) => e.episode_id === epId);
      const transcriptSrc = ep?.sources.find((s) => s.source_key === "transcript");
      const g = guardImportTranscript(transcriptSrc);
      if (g.reason && !confirm(`${g.reason}\nContinuer ?`)) { btn.disabled = false; return; }
      await handleImportTranscript(epId, onRefresh, showErr);
    } else if (action === "import-srt") {
      hideErr();
      const lang = window.prompt(`Langue SRT (ex: en, fr) — épisode ${epId}:`, "en");
      if (!lang?.trim()) { btn.disabled = false; return; }
      const ep = data.episodes.find((e) => e.episode_id === epId);
      // Garde import SRT — avertissement si écrasement (MX-008)
      const g = ep ? guardImportSrt(ep, lang.trim()) : { allowed: true };
      if (g.reason && !confirm(`${g.reason}\nContinuer ?`)) { btn.disabled = false; return; }
      await handleImportSrt(epId, lang.trim(), onRefresh, showErr);
    }

    btn.disabled = false;
  });
}

async function loadAndRender(container: HTMLElement) {
  const tableWrap = container.querySelector<HTMLElement>(".cons-table-wrap");
  if (!tableWrap) return;

  tableWrap.innerHTML = `<div class="cons-loading">Chargement des épisodes…</div>`;
  const errEl = container.querySelector<HTMLElement>(".cons-error");
  if (errEl) errEl.style.display = "none";
  _page = 0;

  try {
    const data = await measureAsync("constituer:load_episodes", fetchEpisodes);

    // Mettre à jour le titre série
    const seriesEl = container.querySelector<HTMLElement>(".cons-toolbar-series");
    if (seriesEl) seriesEl.textContent = data.series_title ?? "";

    const srtLangs = collectSrtLangs(data.episodes);
    renderTable(container, data, srtLangs, () => loadAndRender(container));
  } catch (e) {
    const msg =
      e instanceof ApiError
        ? `${e.errorCode} — ${e.message}`
        : String(e);
    tableWrap.innerHTML = "";
    const errEl2 = container.querySelector<HTMLElement>(".cons-error");
    if (errEl2) {
      errEl2.textContent = `Impossible de charger les épisodes : ${msg}`;
      errEl2.style.display = "block";
    }
  }
}

// ── Section Documents ───────────────────────────────────────────────────────

function renderDocumentsSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div class="cons-toolbar">
      <span class="cons-toolbar-title">Documents</span>
      <input class="cons-search" id="docs-search" type="search" placeholder="Filtrer…" style="font-size:0.8rem;padding:3px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);width:180px">
      <button class="btn btn-ghost" id="docs-refresh" style="font-size:12px;padding:4px 10px">↺ Actualiser</button>
    </div>
    <div class="cons-error" id="docs-error" style="display:none"></div>
    <div class="cons-table-wrap" id="docs-table-wrap">
      <div class="cons-empty">Chargement…</div>
    </div>`;

  pane.querySelector<HTMLButtonElement>("#docs-refresh")!
    .addEventListener("click", () => loadDocuments(pane));

  pane.querySelector<HTMLInputElement>("#docs-search")!
    .addEventListener("input", (e) => {
      const q = (e.target as HTMLInputElement).value.toLowerCase();
      renderDocumentsTable(pane, q);
    });

  loadDocuments(pane);
}

async function loadDocuments(pane: HTMLElement) {
  try {
    _cachedEpisodes = await fetchEpisodes();
    renderDocumentsTable(pane, "");
  } catch (e) {
    const errEl = pane.querySelector<HTMLElement>("#docs-error");
    if (errEl) {
      errEl.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
      errEl.style.display = "block";
    }
  }
}

function renderDocumentsTable(pane: HTMLElement, filter: string) {
  const wrap = pane.querySelector<HTMLElement>("#docs-table-wrap");
  if (!wrap || !_cachedEpisodes) return;

  const episodes = filter
    ? _cachedEpisodes.episodes.filter(
        (ep) =>
          ep.episode_id.toLowerCase().includes(filter) ||
          ep.title.toLowerCase().includes(filter),
      )
    : _cachedEpisodes.episodes;

  if (episodes.length === 0) {
    wrap.innerHTML = `<div class="cons-empty">${filter ? "Aucun résultat pour « " + escapeHtml(filter) + " »." : "Aucun épisode dans ce projet."}</div>`;
    return;
  }

  const srtLangs = collectSrtLangs(episodes);
  const srtHeaders = srtLangs.map((l) => `<th>SRT ${escapeHtml(l.toUpperCase())}</th>`).join("");

  const rows = episodes.map((ep) => {
    const transcript = sourceForKey(ep, "transcript");
    const transcriptCell = transcript
      ? stateBadge(transcript)
      : `<span class="cons-badge absent">—</span>`;

    const srtCells = srtLangs.map((lang) => {
      const src = sourceForKey(ep, `srt_${lang}`);
      return `<td>${src ? stateBadge(src) : `<span class="cons-badge absent">—</span>`}</td>`;
    }).join("");

    return `
      <tr>
        <td style="font-family:ui-monospace,monospace;font-size:0.78rem">${escapeHtml(ep.episode_id)}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</td>
        <td>${transcriptCell}</td>
        ${srtCells}
        <td>
          <button class="btn btn-secondary btn-xs" data-inspecter="${escapeHtml(ep.episode_id)}" style="font-size:11px;padding:3px 8px" title="Ouvrir dans l'Inspecter">→ Inspecter</button>
        </td>
      </tr>`;
  }).join("");

  wrap.innerHTML = `
    <div style="padding:4px 16px;font-size:0.75rem;color:var(--text-muted)">${episodes.length} épisode${episodes.length > 1 ? "s" : ""}</div>
    <table class="cons-table">
      <thead>
        <tr>
          <th>Épisode</th><th>Titre</th><th>Transcript</th>
          ${srtHeaders}
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll<HTMLButtonElement>("[data-inspecter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!_ctx) return;
      _ctx.setInspecterTarget({ episode_id: btn.dataset.inspecter! });
      _ctx.navigateTo("inspecter");
    });
  });
}

// ── Section Importer ────────────────────────────────────────────────────────

function renderImporterSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1rem;padding:1.25rem;overflow-y:auto;height:100%">
      <!-- Config projet -->
      <div class="cons-card">
        <div class="cons-card-title">Projet</div>
        <div id="imp-config-body" class="cons-card-body">Chargement…</div>
        <button class="btn btn-ghost" id="imp-config-refresh" style="font-size:11px;padding:2px 8px;margin-top:6px">↺ Rafraîchir</button>
      </div>
      <!-- Import fichiers -->
      <div class="cons-card">
        <div class="cons-card-title">Importer des fichiers locaux</div>
        <div class="cons-card-body" style="display:flex;flex-direction:column;gap:0.6rem">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
            <label style="font-size:0.8rem;color:var(--text-muted);min-width:90px">Épisode</label>
            <select id="imp-ep-select" class="insp-select" style="max-width:280px">
              <option value="">— chargement… —</option>
            </select>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-primary" id="imp-transcript-btn" style="font-size:0.8rem">📄 Importer transcript</button>
            <button class="btn btn-secondary" id="imp-srt-btn" style="font-size:0.8rem">🔤 Importer SRT</button>
          </div>
          <div id="imp-feedback" style="font-size:0.78rem;color:var(--text-muted);min-height:1.2em"></div>
        </div>
      </div>
      <!-- Sources web (MX-021b) -->
      <div class="cons-card">
        <div class="cons-card-title">Sources web</div>
        <div class="cons-card-body" id="web-src-body">
          <div class="web-src-tabs">
            <button class="web-src-tab active" data-wsrc="tvmaze">TVMaze</button>
            <button class="web-src-tab" data-wsrc="subslikescript">Subslikescript</button>
          </div>

          <!-- TVMaze tab -->
          <div class="web-src-pane active" data-wsrc="tvmaze">
            <div class="web-src-row">
              <input class="web-src-input" id="tvmaze-name" type="text" placeholder="Nom de la série (ex: Breaking Bad)" />
              <button class="btn btn-secondary" id="tvmaze-search-btn" style="font-size:0.8rem;white-space:nowrap">🔍 Chercher</button>
            </div>
            <div class="web-src-feedback" id="tvmaze-feedback"></div>
            <div class="web-src-results" id="tvmaze-results" style="display:none"></div>
          </div>

          <!-- Subslikescript tab -->
          <div class="web-src-pane" data-wsrc="subslikescript">
            <div class="web-src-row">
              <input class="web-src-input" id="subslike-url" type="text" placeholder="URL série (ex: https://subslikescript.com/series/...)" />
              <button class="btn btn-secondary" id="subslike-discover-btn" style="font-size:0.8rem;white-space:nowrap">🔍 Découvrir</button>
            </div>
            <div class="web-src-feedback" id="subslike-feedback"></div>
            <div class="web-src-results" id="subslike-results" style="display:none"></div>
          </div>
        </div>
      </div>
    </div>`;

  loadImporterConfig(pane);

  pane.querySelector<HTMLButtonElement>("#imp-config-refresh")!
    .addEventListener("click", () => loadImporterConfig(pane));

  wireImporterButtons(pane);
}

async function loadImporterConfig(pane: HTMLElement) {
  const body = pane.querySelector<HTMLElement>("#imp-config-body");
  if (!body) return;
  try {
    _cachedConfig = await fetchConfig();
    const cfg = _cachedConfig;
    body.innerHTML = `
      <table style="font-size:0.8rem;border-collapse:collapse;width:100%">
        <tr><td style="color:var(--text-muted);padding:2px 8px 2px 0;white-space:nowrap">Projet</td><td><strong>${escapeHtml(cfg.project_name)}</strong></td></tr>
        <tr><td style="color:var(--text-muted);padding:2px 8px 2px 0">Chemin</td><td style="font-family:ui-monospace,monospace;font-size:0.75rem;word-break:break-all">${escapeHtml(cfg.project_path)}</td></tr>
        <tr><td style="color:var(--text-muted);padding:2px 8px 2px 0">Profil</td><td><code>${escapeHtml(cfg.normalize_profile)}</code></td></tr>
        <tr><td style="color:var(--text-muted);padding:2px 8px 2px 0">Langues</td><td>${cfg.languages.map((l) => `<span class="cons-badge normalized" style="margin-right:3px">${escapeHtml(l)}</span>`).join("")}</td></tr>
      </table>`;

    // Peupler le sélecteur d'épisodes
    const epSel = pane.querySelector<HTMLSelectElement>("#imp-ep-select");
    if (epSel && _cachedEpisodes) {
      populateEpSelect(epSel, _cachedEpisodes.episodes);
    } else if (epSel) {
      fetchEpisodes().then((data) => {
        _cachedEpisodes = data;
        populateEpSelect(epSel, data.episodes);
      }).catch(() => {});
    }
  } catch (e) {
    body.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
  }
}

function populateEpSelect(sel: HTMLSelectElement, episodes: Episode[]) {
  sel.innerHTML = episodes.length === 0
    ? `<option value="">— aucun épisode —</option>`
    : episodes.map((ep) => `<option value="${escapeHtml(ep.episode_id)}">${escapeHtml(ep.episode_id)} — ${escapeHtml(ep.title)}</option>`).join("");
}

function renderWebEpisodesTable(episodes: WebEpisodeRef[], showFetchBtn: boolean): string {
  if (episodes.length === 0) return `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:0.82rem">Aucun épisode trouvé.</div>`;
  const rows = episodes.map((ep) => `
    <tr>
      <td style="white-space:nowrap">${escapeHtml(ep.episode_id)}</td>
      <td>${escapeHtml(ep.title)}</td>
      ${showFetchBtn ? `<td><button class="btn btn-ghost web-fetch-transcript-btn" data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-url="${escapeHtml(ep.url)}" style="font-size:0.72rem;padding:2px 7px">⬇ Importer</button></td>` : ""}
    </tr>`).join("");
  return `<table>
    <thead><tr>
      <th>ID</th><th>Titre</th>${showFetchBtn ? "<th></th>" : ""}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function wireSubslikeFetchButtons(
  container: HTMLElement,
  setFeedback: (msg: string, ok?: boolean) => void,
) {
  container.querySelectorAll<HTMLButtonElement>(".web-fetch-transcript-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const epId  = btn.dataset.epId!;
      const epUrl = btn.dataset.epUrl!;
      btn.disabled = true;
      btn.textContent = "…";
      setFeedback(`Téléchargement ${epId}…`);
      try {
        const res = await fetchSubslikescriptTranscript(epId, epUrl);
        btn.textContent = "✓";
        setFeedback(`${epId} importé — ${res.chars} chars.`);
        _cachedEpisodes = null;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "⬇ Importer";
        setFeedback(e instanceof ApiError ? e.message : String(e), false);
      }
    });
  });
}

function wireImporterButtons(pane: HTMLElement) {
  const feedback = pane.querySelector<HTMLElement>("#imp-feedback")!;

  const setFeedback = (msg: string, ok = true) => {
    feedback.textContent = msg;
    feedback.style.color = ok ? "var(--success, #16a34a)" : "var(--danger, #dc2626)";
  };

  pane.querySelector<HTMLButtonElement>("#imp-transcript-btn")!
    .addEventListener("click", async () => {
      const epId = pane.querySelector<HTMLSelectElement>("#imp-ep-select")!.value;
      if (!epId) { setFeedback("Sélectionnez un épisode.", false); return; }
      await handleImportTranscript(
        epId,
        () => { setFeedback(`Transcript importé pour ${epId}.`); _cachedEpisodes = null; },
        (msg) => setFeedback(msg, false),
      );
    });

  pane.querySelector<HTMLButtonElement>("#imp-srt-btn")!
    .addEventListener("click", async () => {
      const epId = pane.querySelector<HTMLSelectElement>("#imp-ep-select")!.value;
      if (!epId) { setFeedback("Sélectionnez un épisode.", false); return; }
      const lang = window.prompt("Langue de la piste SRT (ex: en, fr, it) :");
      if (!lang?.trim()) return;
      await handleImportSrt(
        epId, lang.trim(),
        () => { setFeedback(`SRT ${lang} importé pour ${epId}.`); _cachedEpisodes = null; },
        (msg) => setFeedback(msg, false),
      );
    });

  // ── Web source tabs ─────────────────────────────────────────────────────────
  pane.querySelectorAll<HTMLButtonElement>(".web-src-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const src = tab.dataset.wsrc!;
      pane.querySelectorAll(".web-src-tab").forEach((t) => t.classList.toggle("active", t === tab));
      pane.querySelectorAll(".web-src-pane").forEach((p) =>
        (p as HTMLElement).classList.toggle("active", (p as HTMLElement).dataset.wsrc === src),
      );
    });
  });

  // ── TVMaze search ───────────────────────────────────────────────────────────
  const tvFeedback = pane.querySelector<HTMLElement>("#tvmaze-feedback")!;
  const tvResults  = pane.querySelector<HTMLElement>("#tvmaze-results")!;
  const tvInput    = pane.querySelector<HTMLInputElement>("#tvmaze-name")!;

  const setTvFeedback = (msg: string, ok = true) => {
    tvFeedback.textContent = msg;
    tvFeedback.style.color = ok ? "var(--text-muted)" : "var(--danger, #dc2626)";
  };

  pane.querySelector<HTMLButtonElement>("#tvmaze-search-btn")!
    .addEventListener("click", async () => {
      const name = tvInput.value.trim();
      if (!name) { setTvFeedback("Saisissez un nom de série.", false); return; }
      setTvFeedback("Recherche en cours…");
      tvResults.style.display = "none";
      try {
        const data = await discoverTvmaze(name);
        setTvFeedback(`${data.series_title} — ${data.episode_count} épisodes.`);
        tvResults.style.display = "block";
        tvResults.innerHTML = renderWebEpisodesTable(data.episodes, false);
      } catch (e) {
        setTvFeedback(e instanceof ApiError ? e.message : String(e), false);
      }
    });

  tvInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pane.querySelector<HTMLButtonElement>("#tvmaze-search-btn")!.click();
  });

  // ── Subslikescript discover ─────────────────────────────────────────────────
  const slFeedback = pane.querySelector<HTMLElement>("#subslike-feedback")!;
  const slResults  = pane.querySelector<HTMLElement>("#subslike-results")!;
  const slInput    = pane.querySelector<HTMLInputElement>("#subslike-url")!;

  const setSlFeedback = (msg: string, ok = true) => {
    slFeedback.textContent = msg;
    slFeedback.style.color = ok ? "var(--text-muted)" : "var(--danger, #dc2626)";
  };

  pane.querySelector<HTMLButtonElement>("#subslike-discover-btn")!
    .addEventListener("click", async () => {
      const url = slInput.value.trim();
      if (!url) { setSlFeedback("Saisissez l'URL de la série.", false); return; }
      setSlFeedback("Découverte en cours…");
      slResults.style.display = "none";
      try {
        const data = await discoverSubslikescript(url);
        setSlFeedback(`${data.series_title} — ${data.episode_count} épisodes.`);
        slResults.style.display = "block";
        slResults.innerHTML = renderWebEpisodesTable(data.episodes, true);
        wireSubslikeFetchButtons(slResults, setSlFeedback);
      } catch (e) {
        setSlFeedback(e instanceof ApiError ? e.message : String(e), false);
      }
    });

  slInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pane.querySelector<HTMLButtonElement>("#subslike-discover-btn")!.click();
  });
}

// ── Section Exporter ─────────────────────────────────────────────────────────

function renderExporterSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div class="exp-section">
      <div class="exp-card-grid">

        <!-- Corpus -->
        <div class="cons-card">
          <div class="cons-card-title">Corpus (texte)</div>
          <div class="cons-card-body">
            <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5">
              Export de tous les épisodes normalisés.<br>
              Utilise <code>clean.txt</code> si disponible, sinon <code>raw.txt</code>.
            </div>
            <div class="exp-fmt-row">
              <button class="btn btn-secondary exp-export-btn" data-scope="corpus" data-fmt="txt" style="font-size:0.78rem">TXT</button>
              <button class="btn btn-secondary exp-export-btn" data-scope="corpus" data-fmt="csv" style="font-size:0.78rem">CSV</button>
              <button class="btn btn-secondary exp-export-btn" data-scope="corpus" data-fmt="json" style="font-size:0.78rem">JSON</button>
              <button class="btn btn-secondary exp-export-btn" data-scope="corpus" data-fmt="docx" style="font-size:0.78rem">DOCX</button>
            </div>
            <div class="exp-result" id="exp-corpus-result"></div>
          </div>
        </div>

        <!-- Segments -->
        <div class="cons-card">
          <div class="cons-card-title">Segments</div>
          <div class="cons-card-body">
            <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5">
              Export des segments issus de la segmentation.<br>
              Requiert que la segmentation ait été lancée.
            </div>
            <div class="exp-fmt-row">
              <button class="btn btn-secondary exp-export-btn" data-scope="segments" data-fmt="txt" style="font-size:0.78rem">TXT</button>
              <button class="btn btn-secondary exp-export-btn" data-scope="segments" data-fmt="csv" style="font-size:0.78rem">CSV</button>
              <button class="btn btn-secondary exp-export-btn" data-scope="segments" data-fmt="tsv" style="font-size:0.78rem">TSV</button>
            </div>
            <div class="exp-result" id="exp-segments-result"></div>
          </div>
        </div>

      </div>

      <!-- Destination note -->
      <div style="font-size:0.76rem;color:var(--text-muted);line-height:1.6">
        Les fichiers sont écrits dans le dossier <code>exports/</code> du projet.
      </div>
    </div>`;

  pane.querySelectorAll<HTMLButtonElement>(".exp-export-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scope = btn.dataset.scope as "corpus" | "segments";
      const fmt   = btn.dataset.fmt!;
      const resultEl = pane.querySelector<HTMLElement>(`#exp-${scope}-result`)!;

      btn.disabled = true;
      resultEl.textContent = "Export en cours…";
      resultEl.className = "exp-result visible";

      try {
        const res: ExportResult = await runExport(scope, fmt);
        const count = res.episodes != null ? `${res.episodes} épisodes` : `${res.segments} segments`;
        resultEl.textContent = `✓ ${count} → ${res.path}`;
        resultEl.className = "exp-result visible ok";
      } catch (e) {
        resultEl.textContent = e instanceof ApiError ? e.message : String(e);
        resultEl.className = "exp-result visible err";
      } finally {
        btn.disabled = false;
      }
    });
  });
}

// ── Section Personnages ──────────────────────────────────────────────────────

let _characters: Character[] = [];
let _assignments: CharacterAssignment[] = [];
let _selectedCharIdx: number | null = null;

function renderPersonnagesSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div class="pers-toolbar">
      <span class="pers-toolbar-title">Personnages</span>
      <button class="btn btn-primary" id="pers-add-btn" style="font-size:0.8rem">+ Nouveau</button>
      <button class="btn btn-ghost" id="pers-refresh" style="font-size:12px;padding:4px 10px">↺</button>
    </div>
    <div class="cons-error" id="pers-error" style="display:none;margin:0 16px 0"></div>
    <div class="pers-body">
      <div class="pers-list">
        <div class="pers-list-header">
          <span>Personnages</span>
          <span id="pers-count" style="margin-left:auto;font-weight:400"></span>
        </div>
        <div class="pers-list-scroll" id="pers-list-scroll">
          <div class="pers-empty-list">Chargement…</div>
        </div>
      </div>
      <div class="pers-detail" id="pers-detail">
        <div class="pers-detail-empty">
          <span style="font-size:1.5rem">🎭</span>
          Sélectionnez un personnage ou créez-en un.
        </div>
      </div>
    </div>`;

  pane.querySelector<HTMLButtonElement>("#pers-refresh")!
    .addEventListener("click", () => loadPersonnages(pane));

  pane.querySelector<HTMLButtonElement>("#pers-add-btn")!
    .addEventListener("click", () => {
      _selectedCharIdx = null;
      renderCharDetail(pane, null);
    });

  loadPersonnages(pane);
}

async function loadPersonnages(pane: HTMLElement) {
  try {
    const [charResp, assignResp] = await Promise.all([fetchCharacters(), fetchAssignments()]);
    _characters = charResp.characters;
    _assignments = assignResp.assignments;
    renderCharList(pane);
    // Re-render detail if something was selected
    if (_selectedCharIdx !== null && _selectedCharIdx < _characters.length) {
      renderCharDetail(pane, _characters[_selectedCharIdx]);
    } else {
      _selectedCharIdx = null;
    }
  } catch (e) {
    showPersError(pane, e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e));
  }
}

function renderCharList(pane: HTMLElement) {
  const scroll = pane.querySelector<HTMLElement>("#pers-list-scroll");
  const countEl = pane.querySelector<HTMLElement>("#pers-count");
  if (!scroll) return;

  if (countEl) countEl.textContent = String(_characters.length);

  if (_characters.length === 0) {
    scroll.innerHTML = `<div class="pers-empty-list">Aucun personnage défini.<br>Cliquez « + Nouveau » pour commencer.</div>`;
    return;
  }

  // Count assignments per character
  const assignCount: Record<string, number> = {};
  for (const a of _assignments) {
    if (a.character_id) assignCount[a.character_id] = (assignCount[a.character_id] ?? 0) + 1;
  }

  scroll.innerHTML = _characters
    .map((ch, idx) => {
      const count = assignCount[ch.id] ?? 0;
      const active = idx === _selectedCharIdx;
      return `
        <div class="pers-char-item${active ? " active" : ""}" data-idx="${idx}">
          <span class="pers-char-name" title="${escapeHtml(ch.canonical)}">${escapeHtml(ch.canonical)}</span>
          ${count > 0 ? `<span class="pers-char-count">${count} assignation${count > 1 ? "s" : ""}</span>` : ""}
        </div>`;
    })
    .join("");

  scroll.querySelectorAll<HTMLElement>(".pers-char-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.idx);
      _selectedCharIdx = idx;
      renderCharList(pane); // update active highlight
      renderCharDetail(pane, _characters[idx]);
    });
  });
}

function renderCharDetail(pane: HTMLElement, char: Character | null) {
  const detail = pane.querySelector<HTMLElement>("#pers-detail");
  if (!detail) return;

  // Collect known languages from project config
  const langs = (_cachedConfig?.languages ?? []).length > 0
    ? _cachedConfig!.languages
    : Object.keys(char?.names_by_lang ?? {}).length > 0
      ? Object.keys(char!.names_by_lang)
      : ["en", "fr"];

  const isNew = char === null;
  const c: Character = char ?? { id: "", canonical: "", names_by_lang: {}, aliases: [] };

  const langFields = langs
    .map((lang) => `
      <div class="pers-lang-item">
        <span class="pers-lang-code">${escapeHtml(lang)}</span>
        <input class="pers-input pers-name-lang" data-lang="${escapeHtml(lang)}"
          type="text" value="${escapeHtml(c.names_by_lang[lang] ?? "")}"
          placeholder="Nom ${escapeHtml(lang.toUpperCase())}…">
      </div>`)
    .join("");

  detail.innerHTML = `
    <div class="pers-detail-scroll">
      <div class="pers-field">
        <label class="pers-label">ID interne</label>
        <input class="pers-input" id="pers-id" type="text"
          value="${escapeHtml(c.id)}" placeholder="ex: rachel_green"
          ${isNew ? "" : "readonly style=\"opacity:0.65;background:var(--surface2)\""}>
        <span style="font-size:0.72rem;color:var(--text-muted)">Identifiant unique, non modifiable après création.</span>
      </div>
      <div class="pers-field">
        <label class="pers-label">Nom canonique</label>
        <input class="pers-input" id="pers-canonical" type="text"
          value="${escapeHtml(c.canonical)}" placeholder="ex: Rachel Green">
      </div>
      <div class="pers-field">
        <label class="pers-label">Noms par langue</label>
        <div class="pers-langs-grid">${langFields}</div>
      </div>
      <div class="pers-field">
        <label class="pers-label">Alias / variantes <span style="font-weight:400;font-style:italic">(une par ligne)</span></label>
        <textarea class="pers-input pers-textarea" id="pers-aliases"
          placeholder="RACHEL\nRachel G.\n...">${escapeHtml(c.aliases.join("\n"))}</textarea>
      </div>
      ${!isNew ? _renderAssignmentsBlock(c.id) : ""}
    </div>
    <div class="pers-detail-actions">
      <button class="btn btn-primary" id="pers-save-btn">
        ${isNew ? "Créer personnage" : "Enregistrer"}
      </button>
      ${!isNew ? `<button class="btn btn-ghost" id="pers-delete-btn" style="color:var(--danger,#dc2626)">Supprimer</button>` : ""}
      <span class="pers-msg" id="pers-detail-msg"></span>
    </div>`;

  const setMsg = (msg: string, ok: boolean) => {
    const el = detail.querySelector<HTMLElement>("#pers-detail-msg")!;
    el.textContent = msg;
    el.className = `pers-msg ${ok ? "ok" : "err"}`;
  };

  detail.querySelector<HTMLButtonElement>("#pers-save-btn")!
    .addEventListener("click", async () => {
      const id       = (detail.querySelector<HTMLInputElement>("#pers-id")!.value).trim();
      const canonical = (detail.querySelector<HTMLInputElement>("#pers-canonical")!.value).trim();
      if (!id || !canonical) { setMsg("ID et nom canonique requis.", false); return; }

      const names_by_lang: Record<string, string> = {};
      detail.querySelectorAll<HTMLInputElement>(".pers-name-lang").forEach((inp) => {
        const v = inp.value.trim();
        if (v) names_by_lang[inp.dataset.lang!] = v;
      });

      const aliasRaw = (detail.querySelector<HTMLTextAreaElement>("#pers-aliases")!.value);
      const aliases = aliasRaw.split("\n").map((s) => s.trim()).filter(Boolean);

      const updated: Character = { id, canonical, names_by_lang, aliases };

      let newList: Character[];
      if (isNew) {
        if (_characters.some((ch) => ch.id.toLowerCase() === id.toLowerCase())) {
          setMsg(`ID « ${id} » déjà utilisé.`, false); return;
        }
        newList = [..._characters, updated];
      } else {
        newList = _characters.map((ch) => ch.id === c.id ? updated : ch);
      }

      try {
        await saveCharacters(newList);
        _characters = newList;
        if (isNew) _selectedCharIdx = _characters.length - 1;
        else _selectedCharIdx = _characters.findIndex((ch) => ch.id === updated.id);
        renderCharList(pane);
        renderCharDetail(pane, updated);
        setMsg("Sauvegardé.", true);
      } catch (e) {
        setMsg(e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e), false);
      }
    });

  if (!isNew) {
    detail.querySelector<HTMLButtonElement>("#pers-delete-btn")?.addEventListener("click", async () => {
      if (!confirm(`Supprimer « ${c.canonical} » et toutes ses assignations ?`)) return;
      const newList = _characters.filter((ch) => ch.id !== c.id);
      const newAssignments = _assignments.filter((a) => a.character_id !== c.id);
      try {
        await saveCharacters(newList);
        await saveAssignments(newAssignments);
        _characters = newList;
        _assignments = newAssignments;
        _selectedCharIdx = null;
        renderCharList(pane);
        detail.innerHTML = `<div class="pers-detail-empty"><span style="font-size:1.5rem">🎭</span>Personnage supprimé.</div>`;
      } catch (e) {
        setMsg(e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e), false);
      }
    });
  }
}

function _renderAssignmentsBlock(charId: string): string {
  const asgns = _assignments.filter((a) => a.character_id === charId);
  if (asgns.length === 0) {
    return `
      <div class="pers-field">
        <label class="pers-label">Assignations <span style="font-weight:400">(0)</span></label>
        <div style="font-size:0.8rem;color:var(--text-muted);font-style:italic">
          Aucune assignation. Les assignations sont créées depuis l'Inspecter ou via le concordancier.
        </div>
      </div>`;
  }
  const rows = asgns.slice(0, 20).map((a) => {
    const label = a.speaker_label ?? a.segment_id ?? a.cue_id ?? "—";
    const ep = a.episode_id ? `<span style="font-family:ui-monospace,monospace;font-size:0.72rem;color:var(--text-muted)">${escapeHtml(a.episode_id)}</span>` : "";
    return `<tr><td style="padding:3px 8px">${escapeHtml(label)}</td><td style="padding:3px 8px">${ep}</td></tr>`;
  }).join("");
  const more = asgns.length > 20 ? `<div style="font-size:0.75rem;color:var(--text-muted);padding:4px 8px">+${asgns.length - 20} autres…</div>` : "";
  return `
    <div class="pers-field">
      <label class="pers-label">Assignations <span style="font-weight:400">(${asgns.length})</span></label>
      <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;font-size:0.8rem">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--surface2)">
            <th style="padding:3px 8px;text-align:left;font-weight:600;color:var(--text-muted)">Locuteur</th>
            <th style="padding:3px 8px;text-align:left;font-weight:600;color:var(--text-muted)">Épisode</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${more}
      </div>
    </div>`;
}

function showPersError(pane: HTMLElement, msg: string) {
  const el = pane.querySelector<HTMLElement>("#pers-error");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

// ── Mount / Dispose ─────────────────────────────────────────────────────────

export function mountConstituer(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  _container = container;
  _ctx = ctx;

  // Restore persisted nav state
  _navCollapsed = localStorage.getItem("cons-nav-collapsed") === "1";
  const _savedSubView = localStorage.getItem("cons-active-subview") as typeof _activeActionsSubView | null;
  if (_savedSubView) _activeActionsSubView = _savedSubView;
  const _savedSection = localStorage.getItem("cons-active-section");
  if (_savedSection) _activeSection = _savedSection;

  container.innerHTML = `
    <div class="cons-root cons-shell${_navCollapsed ? " nav-hidden" : ""}" id="cons-shell">

      <!-- Sidebar -->
      <nav class="cons-nav" id="cons-nav">
        <div class="cons-nav-head">
          <h2>Sections</h2>
          <button class="cons-nav-collapse-btn" id="cons-nav-collapse" title="Réduire">◀</button>
        </div>

        <button class="cons-nav-tab${_activeSection === "importer"    ? " active" : ""}" data-section="importer">Importer</button>
        <button class="cons-nav-tab${_activeSection === "documents"   ? " active" : ""}" data-section="documents">Documents</button>
        <button class="cons-nav-tab${_activeSection === "actions"     ? " active" : ""}" data-section="actions">Actions</button>

        <details class="cons-nav-tree" ${_activeSection === "actions" ? "open" : ""}>
          <summary class="cons-nav-tree-summary">
            Actions disponibles
            <span class="cons-nav-tree-caret">▾</span>
          </summary>
          <div class="cons-nav-tree-body">
            <button class="cons-nav-tree-link${_activeActionsSubView === "curation"     ? " active" : ""}" data-subview="curation">Curation</button>
            <button class="cons-nav-tree-link${_activeActionsSubView === "segmentation" ? " active" : ""}" data-subview="segmentation">Segmentation</button>
            <button class="cons-nav-tree-link${_activeActionsSubView === "alignement"   ? " active" : ""}" data-subview="alignement">Alignement</button>
          </div>
        </details>

        <button class="cons-nav-tab${_activeSection === "personnages" ? " active" : ""}" data-section="personnages">Personnages</button>
        <button class="cons-nav-tab${_activeSection === "exporter"    ? " active" : ""}" data-section="exporter">Exporter</button>
      </nav>

      <!-- Rail (collapsed state) -->
      <div class="cons-rail">
        <button class="cons-rail-expand-btn" id="cons-rail-expand" title="Développer">▶</button>
      </div>

      <!-- Main content -->
      <div class="cons-main">

        <!-- Section : Importer -->
        <div class="cons-section-pane${_activeSection === "importer" ? " active" : ""}" data-section="importer">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">📥</div>
            <div class="cons-placeholder-title">Importer</div>
            <div class="cons-placeholder-desc">
              Configuration projet (série, source, profil, langues) +<br>
              import depuis subslikescript · TVMaze · OpenSubtitles · fichiers locaux.<br>
              <em style="opacity:0.6">En développement — MX-021.</em>
            </div>
          </div>
        </div>

        <!-- Section : Documents -->
        <div class="cons-section-pane${_activeSection === "documents" ? " active" : ""}" data-section="documents">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">📄</div>
            <div class="cons-placeholder-title">Documents</div>
            <div class="cons-placeholder-desc">
              Table des épisodes avec sources et états — gestion gros corpus,<br>
              virtualisation, filtres, accès à l'Inspecter par épisode.<br>
              <em style="opacity:0.6">En développement — MX-021.</em>
            </div>
          </div>
        </div>

        <!-- Section : Actions -->
        <div class="cons-section-pane${_activeSection === "actions" ? " active" : ""}" data-section="actions">

          <!-- Hub sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "hub" ? " active" : ""}" data-subview="hub">
            <div class="acts-hub">
              <div class="acts-hub-title">Actions pipeline</div>
              <div class="acts-hub-desc">Choisissez une étape à appliquer sur vos épisodes.</div>
              <div class="acts-hub-cards">
                <button class="acts-hub-card" data-subview="curation">
                  <div class="acts-hub-card-icon">✂️</div>
                  <div class="acts-hub-card-title">Curation</div>
                  <div class="acts-hub-card-desc">Normaliser les transcripts et SRT bruts.</div>
                </button>
                <button class="acts-hub-card" data-subview="segmentation">
                  <div class="acts-hub-card-icon">🔤</div>
                  <div class="acts-hub-card-title">Segmentation</div>
                  <div class="acts-hub-card-desc">Découper en segments prêts pour l'alignement.</div>
                </button>
                <button class="acts-hub-card" data-subview="alignement">
                  <div class="acts-hub-card-icon">⚡</div>
                  <div class="acts-hub-card-title">Alignement</div>
                  <div class="acts-hub-card-desc">Lancer ou consulter les runs d'alignement.</div>
                </button>
              </div>
            </div>
          </div>

          <!-- Curation sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "curation" ? " active" : ""}" data-subview="curation">
            <div class="cons-toolbar">
              <button class="acts-back-btn" id="cons-back-curation">← Actions</button>
              <span class="cons-toolbar-title">Curation</span>
              <span class="cons-toolbar-series"></span>
              <button class="btn btn-secondary" id="cons-batch-normalize" style="font-size:11px;padding:3px 9px">⚡ Normaliser tout</button>
              <button class="btn btn-ghost" id="cons-refresh" style="font-size:12px;padding:4px 10px">↺ Actualiser</button>
              <span class="cons-api-dot ${ctx.getBackendStatus().online ? "online" : "offline"}" id="cons-api-dot"></span>
            </div>
            <div class="cons-error" style="display:none"></div>
            <div class="cons-table-wrap"></div>
            <div class="cons-jobs">
              <div class="cons-jobs-header" id="cons-jobs-toggle">
                ▾ File de jobs
                <span class="cons-jobs-count">0 total</span>
              </div>
              <div id="cons-jobs-body" style="display:block">
                <div class="cons-jobs-actions">
                  <button class="btn btn-ghost" id="cons-refresh-jobs" style="font-size:11px;padding:2px 8px">↺ Rafraîchir</button>
                </div>
                <div class="cons-jobs-list"></div>
              </div>
            </div>
          </div>

          <!-- Segmentation sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "segmentation" ? " active" : ""}" data-subview="segmentation">
            <div class="cons-toolbar">
              <button class="acts-back-btn" id="cons-back-segmentation">← Actions</button>
              <span class="cons-toolbar-title">Segmentation</span>
            </div>
            <div class="cons-placeholder">
              <div class="cons-placeholder-icon">🔤</div>
              <div class="cons-placeholder-title">Segmentation</div>
              <div class="cons-placeholder-desc">
                Découper les transcripts normalisés en segments.<br>
                <em style="opacity:0.6">En développement.</em>
              </div>
            </div>
          </div>

          <!-- Alignement sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "alignement" ? " active" : ""}" data-subview="alignement">
            <div class="cons-toolbar">
              <button class="acts-back-btn" id="cons-back-alignement">← Actions</button>
              <span class="cons-toolbar-title">Alignement</span>
            </div>
            <div class="cons-placeholder">
              <div class="cons-placeholder-icon">⚡</div>
              <div class="cons-placeholder-title">Alignement</div>
              <div class="cons-placeholder-desc">
                Lancer et consulter les runs d'alignement par épisode.<br>
                <em style="opacity:0.6">En développement.</em>
              </div>
            </div>
          </div>

        </div><!-- /section actions -->

        <!-- Section : Personnages -->
        <div class="cons-section-pane${_activeSection === "personnages" ? " active" : ""}" data-section="personnages">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">🎭</div>
            <div class="cons-placeholder-title">Personnages</div>
            <div class="cons-placeholder-desc">
              Définition des personnages (canonical + noms par langue + alias),<br>
              assignation segment/cue → personnage, propagation via alignement,<br>
              réécriture SRT avec noms de locuteurs.<br>
              <em style="opacity:0.6">En développement — MX-021c.</em>
            </div>
          </div>
        </div>

        <!-- Section : Exporter -->
        <div class="cons-section-pane${_activeSection === "exporter" ? " active" : ""}" data-section="exporter">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">📤</div>
            <div class="cons-placeholder-title">Exporter</div>
            <div class="cons-placeholder-desc">
              Export corpus, alignements et SRT final avec noms de personnages.<br>
              Formats : TXT, CSV, TSV, DOCX, JSON.<br>
              <em style="opacity:0.6">En développement.</em>
            </div>
          </div>
        </div>

      </div><!-- /cons-main -->
    </div>`;

  // ── Helper: switch section ────────────────────────────────────────────────
  function activateSection(sec: string) {
    _activeSection = sec;
    localStorage.setItem("cons-active-section", sec);
    container.querySelectorAll<HTMLButtonElement>(".cons-nav-tab")
      .forEach((b) => b.classList.toggle("active", b.dataset.section === sec));
    container.querySelectorAll<HTMLElement>(".cons-section-pane")
      .forEach((p) => p.classList.toggle("active", p.dataset.section === sec));
    // Lazy-mount dynamic sections
    const pane = container.querySelector<HTMLElement>(`.cons-section-pane[data-section="${sec}"]`)!;
    if (sec === "documents"   && pane.querySelector(".cons-placeholder")) renderDocumentsSection(pane);
    if (sec === "importer"    && pane.querySelector(".cons-placeholder")) renderImporterSection(pane);
    if (sec === "personnages" && pane.querySelector(".cons-placeholder")) renderPersonnagesSection(pane);
    if (sec === "exporter"    && pane.querySelector(".cons-placeholder")) renderExporterSection(pane);
  }

  // ── Helper: switch Actions sub-view ──────────────────────────────────────
  function activateSubView(subview: "hub" | "curation" | "segmentation" | "alignement") {
    _activeActionsSubView = subview;
    localStorage.setItem("cons-active-subview", subview);
    container.querySelectorAll<HTMLElement>(".cons-actions-pane")
      .forEach((p) => p.classList.toggle("active", p.dataset.subview === subview));
    container.querySelectorAll<HTMLButtonElement>(".cons-nav-tree-link")
      .forEach((b) => b.classList.toggle("active", b.dataset.subview === subview));
  }

  // ── Sidebar nav tab clicks ────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".cons-nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => activateSection(btn.dataset.section!));
  });

  // ── Actions tree link clicks ──────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".cons-nav-tree-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateSection("actions");
      activateSubView(btn.dataset.subview as "curation" | "segmentation" | "alignement");
    });
  });

  // ── Hub CTA card clicks ───────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".acts-hub-card").forEach((card) => {
    card.addEventListener("click", () => {
      activateSubView(card.dataset.subview as "curation" | "segmentation" | "alignement");
    });
  });

  // ── Back buttons ──────────────────────────────────────────────────────────
  ["curation", "segmentation", "alignement"].forEach((sv) => {
    const btn = container.querySelector<HTMLButtonElement>(`#cons-back-${sv}`);
    if (btn) btn.addEventListener("click", () => activateSubView("hub"));
  });

  // ── Collapse / expand ─────────────────────────────────────────────────────
  function setNavCollapsed(collapsed: boolean) {
    _navCollapsed = collapsed;
    localStorage.setItem("cons-nav-collapsed", collapsed ? "1" : "0");
    const shell = container.querySelector<HTMLElement>("#cons-shell")!;
    shell.classList.toggle("nav-hidden", collapsed);
  }

  container.querySelector<HTMLButtonElement>("#cons-nav-collapse")!
    .addEventListener("click", () => setNavCollapsed(true));
  container.querySelector<HTMLButtonElement>("#cons-rail-expand")!
    .addEventListener("click", () => setNavCollapsed(false));

  // ── Lazy-mount on initial load ────────────────────────────────────────────
  {
    const pane = container.querySelector<HTMLElement>(`.cons-section-pane[data-section="${_activeSection}"]`);
    if (pane?.querySelector(".cons-placeholder")) {
      if (_activeSection === "documents")   renderDocumentsSection(pane);
      if (_activeSection === "importer")    renderImporterSection(pane);
      if (_activeSection === "personnages") renderPersonnagesSection(pane);
    }
  }

  // ── Refresh episodes button ───────────────────────────────────────────────
  container
    .querySelector<HTMLButtonElement>("#cons-refresh")!
    .addEventListener("click", () => loadAndRender(container));

  // ── Batch normalize button ────────────────────────────────────────────────
  container
    .querySelector<HTMLButtonElement>("#cons-batch-normalize")!
    .addEventListener("click", async () => {
      try {
        const { episodes } = await fetchEpisodes();
        await queueBatchNormalize(episodes, container);
      } catch (e) {
        const errEl = container.querySelector<HTMLElement>(".cons-error");
        if (errEl) { errEl.textContent = String(e); errEl.style.display = "block"; }
      }
    });

  // ── Jobs toggle ───────────────────────────────────────────────────────────
  container
    .querySelector<HTMLElement>("#cons-jobs-toggle")!
    .addEventListener("click", () => {
      _jobsExpanded = !_jobsExpanded;
      const body = container.querySelector<HTMLElement>("#cons-jobs-body");
      const hdr  = container.querySelector<HTMLElement>("#cons-jobs-toggle");
      if (body) body.style.display = _jobsExpanded ? "block" : "none";
      if (hdr) hdr.textContent = (_jobsExpanded ? "▾" : "▸") + " File de jobs";
      if (hdr) {
        const span = document.createElement("span");
        span.className = "cons-jobs-count";
        span.textContent = "…";
        hdr.appendChild(span);
      }
    });

  // ── Refresh jobs button ───────────────────────────────────────────────────
  container
    .querySelector<HTMLButtonElement>("#cons-refresh-jobs")!
    .addEventListener("click", () => refreshJobs(container));

  // ── Backend status dot ────────────────────────────────────────────────────
  const dotEl = container.querySelector<HTMLElement>("#cons-api-dot")!;
  _unsubscribe = ctx.onStatusChange((s) => {
    dotEl.className = "cons-api-dot " + (s.online ? "online" : "offline");
  });

  // ── Initial load ──────────────────────────────────────────────────────────
  if (ctx.getBackendStatus().online) {
    loadAndRender(container);
    refreshJobs(container).then(() => startJobPoll(container));
  } else {
    const tableWrap = container.querySelector<HTMLElement>(".cons-table-wrap")!;
    tableWrap.innerHTML = `<div class="cons-empty">Backend HIMYC hors ligne.<br>Lancez : <code>uvicorn howimetyourcorpus.api.server:app --port 8765</code></div>`;
    const unsub2 = ctx.onStatusChange((s) => {
      if (s.online) {
        loadAndRender(container);
        refreshJobs(container).then(() => startJobPoll(container));
        unsub2();
      }
    });
  }
}

export function disposeConstituer() {
  stopJobPoll();
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _container = null;
  _ctx = null;
}
