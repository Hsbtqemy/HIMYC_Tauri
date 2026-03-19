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
  fetchEpisodeSource,
  importTranscript,
  importSrt,
  fetchJobs,
  createJob,
  cancelJob,
  fetchCharacters,
  saveCharacters,
  fetchAssignments,
  saveAssignments,
  autoAssignCharacters,
  discoverTvmaze,
  discoverSubslikescript,
  fetchSubslikescriptTranscript,
  fetchAlignmentRuns,
  fetchAlignRunStats,
  fetchAuditLinks,
  fetchAlignCollisions,
  setAlignLinkStatus,
  fetchConcordance,
  fetchEpisodeSegments,
  fetchQaReport,
  runExport,
  saveConfig,
  type ExportResult,
  type QaReport,
  type AlignRunStats,
  type AuditLink,
  type AlignCollision,
  type ConcordanceRow,
  type SegmentRow,
  type AutoAssignResult,
  type ConfigUpdate,
  type Episode,
  type EpisodeSource,
  type EpisodesResponse,
  type ConfigResponse,
  type TranscriptSourceContent,
  type JobRecord,
  type JobType,
  type Character,
  type CharacterAssignment,
  type WebEpisodeRef,
  type AlignmentRun,
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
  grid-template-rows: 1fr;
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
  flex: 1;
  min-width: 0;
  min-height: 0;
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

/* ── Documents stats bar ────────────────────────────────────── */
.docs-stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.docs-stats-bar:empty { display: none; }
.docs-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.docs-stat-sep { opacity: 0.3; }

/* Per-episode normalize button in curation list */
.cur-ep-item { position: relative; }
.cur-ep-normalize {
  margin-left: auto;
  padding: 1px 5px;
  font-size: 0.65rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  font-family: inherit;
  transition: background .1s, color .1s;
}
.cur-ep-normalize:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); border-color: var(--accent); }

/* ── Cards (Importer) ───────────────────────────────────────── */
.cons-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem;
  margin-bottom: 0.75rem;
}
.cons-card:hover { box-shadow: 0 2px 6px rgba(0,0,0,.12); }
.cons-card-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 0.6rem;
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

/* ── Split layout (liste + viewer texte) ────────────────────── */
.acts-split {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.acts-ep-list {
  width: 360px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.acts-text-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface2);
}
.acts-text-header {
  padding: 7px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.acts-text-ep-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acts-text-tabs { display: flex; gap: 3px; }
.acts-text-tab {
  padding: 2px 10px;
  font-size: 0.74rem;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background .1s;
}
.acts-text-tab.active {
  background: var(--accent, #0f766e);
  color: #fff;
  border-color: var(--accent, #0f766e);
}
.acts-text-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.75;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.acts-text-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 0.82rem;
  font-style: italic;
  gap: 6px;
}
.acts-text-loading {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.82rem;
}
/* highlight active row in split list */
.acts-ep-list tr.active-row td { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.acts-ep-list tr[data-ep-id] { cursor: pointer; }
.acts-ep-list tr[data-ep-id]:hover td { background: var(--surface2); }

/* ── Curation 3-col layout ──────────────────────────────────── */
.cur-3col {
  display: grid;
  grid-template-columns: 250px 1fr 220px;
  grid-template-rows: 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.cur-params-col {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}
.cur-preview-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.cur-diag-col {
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
}
.cur-col-head {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted);
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cur-param-section {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.cur-param-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .05em;
}
.cur-ep-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 200px;
  overflow-y: auto;
}
.cur-ep-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.78rem;
  transition: background .1s;
  border: 1px solid transparent;
}
.cur-ep-item:hover { background: var(--surface2); }
.cur-ep-item.active {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}
.cur-ep-id {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  color: var(--text-muted);
  flex-shrink: 0;
}
.cur-ep-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 0.78rem; }
.cur-rule-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.cur-rule-chip {
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 0.68rem;
  font-weight: 600;
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #bae6fd;
}
/* Preview */
.cur-preview-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.cur-preview-tab {
  padding: 2px 10px;
  font-size: 0.74rem;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background .1s;
}
.cur-preview-tab.active {
  background: var(--accent, #0f766e);
  color: #fff;
  border-color: var(--accent, #0f766e);
}
.cur-preview-badge {
  margin-left: auto;
  font-size: 0.7rem;
  font-family: ui-monospace, monospace;
  color: var(--text-muted);
}
.cur-preview-panes {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
.cur-pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  font-family: ui-monospace, monospace;
  font-size: 0.74rem;
  line-height: 1.8;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  display: flex;
  flex-direction: column;
}
.cur-pane + .cur-pane { border-left: 1px solid var(--border); background: var(--surface2); }
.cur-pane-head {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cur-pane-text { flex: 1; }
/* Diagnostics */
.cur-diag-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.cur-diag-section { padding: 10px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.cur-diag-title { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin-bottom: 6px; }
.cur-stat-row { display: flex; justify-content: space-between; font-size: 0.77rem; padding: 2px 0; color: var(--text); }
.cur-stat-val { font-weight: 700; font-family: ui-monospace, monospace; }
.cur-diag-jobs { flex: 1; overflow-y: auto; min-height: 0; }

/* ── Curation diff view ─────────────────────────────────────── */
.cur-diff-view {
  font-family: ui-monospace, monospace;
  font-size: 0.77rem;
  overflow-y: auto;
  height: 100%;
  padding: 0 0 1rem;
}
.cur-diff-summary {
  padding: 6px 12px;
  font-size: 0.73rem;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  font-family: inherit;
}
.cur-diff-summary strong { color: var(--accent); }
.cur-diff-same {
  padding: 1px 10px;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.cur-diff-changed { border-left: 3px solid var(--accent); margin: 3px 0; }
.cur-diff-del {
  padding: 2px 10px;
  background: #fef2f2;
  color: #dc2626;
  text-decoration: line-through;
  white-space: pre-wrap;
  word-break: break-word;
}
.cur-diff-ins {
  padding: 2px 10px;
  background: #f0fdf4;
  color: #16a34a;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Alignment run history + audit view ──────────────────────── */
.align-runs-panel {
  padding: 10px 14px;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.align-runs-title {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted);
  flex-shrink: 0;
}
.align-run-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.78rem;
}
.align-run-id {
  font-family: ui-monospace, monospace;
  font-size: 0.69rem;
  color: var(--text-muted);
}
.align-run-langs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.align-run-lang-badge {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.68rem;
  font-weight: 700;
  background: var(--surface2);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  text-transform: uppercase;
}
.align-run-date {
  font-size: 0.7rem;
  color: var(--text-muted);
}
.align-run-card { cursor: pointer; transition: border-color .12s, background .12s; }
.align-run-card:hover { border-color: var(--accent); background: var(--surface2); }
.align-run-card.active { border-color: var(--accent); background: #e8f5f3; }
.align-run-kind {
  font-size: 0.69rem;
  color: var(--text-muted);
}

/* ── Audit view ──────────────────────────────────────────────── */
.audit-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.audit-stats-strip {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.audit-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 48px;
}
.audit-stat-val {
  font-size: 1rem;
  font-weight: 700;
  font-family: ui-monospace, monospace;
  color: var(--text);
  line-height: 1.1;
}
.audit-stat-label { font-size: 0.64rem; color: var(--text-muted); text-transform: uppercase; }
.audit-stat-sep { width: 1px; height: 28px; background: var(--border); }
.audit-stat-val.ok       { color: #16a34a; }
.audit-stat-val.warn     { color: #ca8a04; }
.audit-stat-val.blocking { color: #dc2626; }
.audit-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.audit-filter-bar select, .audit-filter-bar input {
  padding: 3px 8px;
  font-size: 0.78rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
}
.audit-filter-bar input { flex: 1; min-width: 120px; max-width: 240px; }
.audit-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 12px 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.audit-tab {
  padding: 4px 12px;
  font-size: 0.77rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 5px 5px 0 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  position: relative; bottom: -1px;
}
.audit-tab:hover { background: var(--surface2); }
.audit-tab.active { background: var(--surface2); border-color: var(--border); border-bottom-color: var(--surface2); color: var(--text); font-weight: 600; }
.audit-tab .audit-tab-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px;
  font-size: 0.65rem; font-weight: 700;
  border-radius: 8px; background: #fca5a5; color: #7f1d1d;
  margin-left: 4px;
}
.audit-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.audit-pane { display: none; flex-direction: column; overflow: hidden; height: 100%; }
.audit-pane.active { display: flex; }
/* Links table */
.audit-table-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.audit-table { width: 100%; border-collapse: collapse; font-size: 0.76rem; }
.audit-table thead { position: sticky; top: 0; background: var(--surface); z-index: 2; }
.audit-table th {
  padding: 5px 8px; border-bottom: 2px solid var(--border);
  text-align: left; font-size: 0.7rem; color: var(--text-muted);
  text-transform: uppercase; white-space: nowrap;
}
.audit-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.audit-table tr:hover td { background: var(--surface2); }
.audit-table tr.accepted td { background: #f0fdf4; }
.audit-table tr.rejected td { background: #fef2f2; opacity: .7; }
.audit-status-badge {
  display: inline-flex; align-items: center;
  padding: 1px 6px; border-radius: 3px;
  font-size: 0.68rem; font-weight: 700;
  white-space: nowrap;
}
.audit-status-badge.auto     { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border); }
.audit-status-badge.accepted { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
.audit-status-badge.rejected { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
.audit-action-btn {
  padding: 1px 6px; font-size: 0.7rem;
  border: 1px solid var(--border); border-radius: 3px;
  background: var(--surface); cursor: pointer; font-family: inherit;
  color: var(--text-muted); transition: background .1s;
}
.audit-action-btn:hover { background: var(--surface2); }
.audit-action-btn.accept { color: #15803d; border-color: #86efac; }
.audit-action-btn.reject { color: #b91c1c; border-color: #fca5a5; }
.audit-action-btn.undo   { color: var(--text-muted); }
.audit-conf-bar {
  display: inline-block; height: 5px; border-radius: 2px;
  background: linear-gradient(90deg, #0f766e, #5eead4);
  vertical-align: middle; margin-right: 4px;
}
/* Pagination */
.audit-pager {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 8px; padding: 5px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
  font-size: 0.76rem; color: var(--text-muted);
}
/* Quality bar */
.audit-quality-bar-row {
  display: none; align-items: center; gap: 10px; padding: 4px 14px 6px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.audit-quality-bar-wrap {
  flex: 1; height: 8px; border-radius: 4px; overflow: hidden;
  background: var(--border); display: flex; gap: 1px;
}
.audit-quality-seg { height: 100%; transition: flex .3s; min-width: 0; }
.audit-quality-seg.accepted { background: #16a34a; }
.audit-quality-seg.auto     { background: #ca8a04; }
.audit-quality-seg.rejected { background: #dc2626; }
.audit-quality-label {
  font-size: 0.68rem; color: var(--text-muted); white-space: nowrap; flex-shrink: 0;
}
/* Collisions */
.audit-collision-list { overflow-y: auto; flex: 1; padding: 0; display: flex; flex-direction: column; }
.audit-collision-actions {
  display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-bottom: 1px solid #fca5a5; background: #fff8f8; flex-shrink: 0; flex-wrap: wrap;
}
.audit-collision-scroll { overflow-y: auto; flex: 1; padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
.audit-collision-card {
  border: 1px solid #fca5a5; border-radius: var(--radius);
  background: #fef2f2; padding: 8px 12px;
}
.audit-collision-pivot { font-size: 0.77rem; font-weight: 600; color: #7f1d1d; margin-bottom: 6px; }
.audit-collision-target-row {
  display: flex; align-items: center; gap: 6px; padding: 3px 0;
  border-top: 1px solid #fecaca;
}
.audit-collision-target-text {
  flex: 1; font-size: 0.76rem; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.audit-collision-target-conf { font-size: 0.68rem; color: var(--text-muted); flex-shrink: 0; }
.audit-collision-target-btns { display: flex; gap: 3px; flex-shrink: 0; }
.audit-back-btn {
  padding: 3px 10px; font-size: 0.76rem;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); cursor: pointer; font-family: inherit;
  color: var(--text-muted); flex-shrink: 0;
}
.audit-back-btn:hover { background: var(--surface2); }

/* ── Concordancier parallèle ─────────────────────────────────── */
.conc-panel {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
}
.conc-toolbar {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  flex-shrink: 0; flex-wrap: wrap;
}
.conc-toolbar-title { font-size: 0.82rem; font-weight: 700; color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conc-search { padding: 3px 8px; font-size: 0.78rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface2); color: var(--text); font-family: inherit; min-width: 140px; }
.conc-filter-select { padding: 3px 8px; font-size: 0.78rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font-family: inherit; }
.conc-count { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; }
.conc-table-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.conc-table { width: 100%; border-collapse: collapse; font-size: 0.76rem; }
.conc-table thead { position: sticky; top: 0; background: var(--surface); z-index: 2; }
.conc-table th {
  padding: 5px 8px; border-bottom: 2px solid var(--border);
  text-align: left; font-size: 0.69rem; color: var(--text-muted);
  text-transform: uppercase; white-space: nowrap;
}
.conc-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.conc-table tr:hover td { background: var(--surface2); }
.conc-table tr:nth-child(even) td { background: color-mix(in srgb, var(--surface2) 40%, transparent); }
.conc-speaker { font-size: 0.68rem; font-weight: 700; color: var(--accent); display: block; margin-bottom: 2px; }
.conc-conf { font-size: 0.65rem; color: var(--text-muted); }
.conc-empty { padding: 1.5rem; font-size: 0.78rem; color: var(--text-muted); text-align: center; }
.conc-highlight { background: #fef08a; border-radius: 2px; }

/* ── Segmentation longtext mode ──────────────────────────────── */
.seg-mode-toggle {
  display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
}
.seg-mode-btn {
  padding: 3px 10px; font-size: 0.76rem; border: none; border-right: 1px solid var(--border);
  background: var(--surface); color: var(--text-muted); cursor: pointer; font-family: inherit;
  transition: background .1s;
}
.seg-mode-btn:last-child { border-right: none; }
.seg-mode-btn.active { background: var(--accent, #0f766e); color: #fff; }
.seg-mode-btn:hover:not(.active) { background: var(--surface2); }
.seg-lt-wrap { flex: 1; overflow-y: auto; min-height: 0; padding: 1rem 1.5rem; display: flex; flex-direction: column; gap: 0; }
.seg-lt-para {
  padding: 5px 8px; border-radius: 3px; font-size: 0.82rem; line-height: 1.6;
  color: var(--text); position: relative;
  border-left: 3px solid transparent; margin-bottom: 2px;
}
.seg-lt-para:hover { background: var(--surface2); border-left-color: var(--accent); }
.seg-lt-para.matched { background: #fef9c3; border-left-color: #ca8a04; }
.seg-lt-speaker { font-size: 0.68rem; font-weight: 700; color: var(--accent); display: block; margin-bottom: 1px; }
.seg-lt-n { font-size: 0.62rem; color: var(--text-muted); font-family: ui-monospace, monospace; position: absolute; right: 6px; top: 6px; }
.seg-lt-search-bar {
  display: flex; align-items: center; gap: 8px; padding: 5px 12px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.seg-lt-search-bar input { flex: 1; padding: 3px 8px; font-size: 0.78rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface2); color: var(--text); font-family: inherit; }
.seg-lt-search-count { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; }
.seg-lt-search-nav { display: flex; gap: 3px; }
.seg-lt-search-nav button { padding: 1px 7px; font-size: 0.72rem; border: 1px solid var(--border); border-radius: 3px; background: var(--surface); cursor: pointer; font-family: inherit; color: var(--text-muted); }
.seg-lt-search-nav button:hover { background: var(--surface2); }

/* ── Presets nav button + modal ─────────────────────────────── */
.cons-nav-presets-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  margin-top: auto;
}
.cons-nav-presets-btn:hover { background: var(--surface2); border-color: var(--border); }
dialog.cons-presets-modal {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
  padding: 0;
  max-width: 480px;
  width: 90vw;
  background: var(--surface);
  color: var(--text);
}
dialog.cons-presets-modal::backdrop { background: rgba(0,0,0,.35); }
.presets-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.presets-modal-head h3 { margin: 0; font-size: 0.92rem; }
.presets-modal-body { padding: 12px 16px; max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.presets-modal-foot { padding: 10px 16px; border-top: 1px solid var(--border); display: flex; gap: 8px; }
.preset-card {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
  font-size: 0.8rem;
}
.preset-card-info { flex: 1; min-width: 0; }
.preset-card-name { font-weight: 600; color: var(--text); }
.preset-card-meta { font-size: 0.72rem; color: var(--text-muted); margin-top: 1px; }
.preset-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
.preset-new-form { display: flex; flex-direction: column; gap: 8px; padding: 10px; background: var(--surface2); border-radius: var(--radius); border: 1px solid var(--border); }
.preset-new-form-row { display: flex; gap: 8px; align-items: center; }
.preset-new-form-row label { font-size: 0.76rem; color: var(--text-muted); min-width: 90px; }
.preset-new-form-row input, .preset-new-form-row select {
  flex: 1; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); color: var(--text); font-size: 0.8rem; font-family: inherit;
}

/* ── Actions params panel ───────────────────────────────────── */
.acts-params {
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  flex-shrink: 0;
  font-size: 0.8rem;
}
.acts-params-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.acts-params-label {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.acts-params-select {
  padding: 3px 22px 3px 7px;
  font-size: 0.8rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
}
.acts-params-select:focus { outline: none; border-color: var(--accent); }
.acts-params-radios { display: flex; gap: 10px; }
.acts-params-radio { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.acts-params-radio input { cursor: pointer; }
.acts-params-feedback {
  font-size: 0.73rem;
  color: var(--text-muted);
  min-width: 80px;
  font-style: italic;
}
.acts-params-sep { width: 1px; height: 20px; background: var(--border); flex-shrink: 0; }

/* Config form */
.cfg-form { display: flex; flex-direction: column; gap: 8px; }
.cfg-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cfg-label { font-size: 0.78rem; color: var(--text-muted); min-width: 110px; flex-shrink: 0; }
.cfg-input {
  flex: 1;
  min-width: 160px;
  padding: 4px 8px;
  font-size: 0.82rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}
.cfg-input:focus { outline: none; border-color: var(--accent, #0f766e); }
.cfg-select { appearance: none; cursor: pointer; }
.cfg-feedback { font-size: 0.76rem; min-height: 1.2em; color: var(--text-muted); }
.cfg-path { font-size: 0.72rem; font-family: ui-monospace, monospace; color: var(--text-muted); word-break: break-all; }

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
          ? `<button class="btn btn-ghost btn-sm" data-cancel="${escapeHtml(j.job_id)}">✕</button>`
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
  const scopeAll = (container.querySelector<HTMLInputElement>("input[name='cur-scope'][value='all']")?.checked) ?? false;
  // Garde côté handler — rejetée même si bouton appelé programmatiquement (MX-008)
  await guardedAction(
    guardBatchNormalize(episodes),
    async () => {
      const toNormalize = episodes.filter((ep) => {
        const t = ep.sources.find((s) => s.source_key === "transcript");
        if (!t?.available) return false;
        return scopeAll ? true : (t.state === "raw" || t.state === "unknown");
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
  const tableWrap = container.querySelector<HTMLElement>("#cur-table-wrap")
                 ?? container.querySelector<HTMLElement>(".cons-table-wrap");
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
        ? `<button class="btn btn-primary btn-sm" data-action="import-transcript" data-ep="${escapeHtml(ep.episode_id)}">+ transcript</button>`
        : "";
      const importSrtBtn = `<button class="btn btn-secondary btn-sm" data-action="import-srt" data-ep="${escapeHtml(ep.episode_id)}">+ SRT</button>`;

      return `
        <tr data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}">
          <td style="font-family:ui-monospace,monospace;font-size:0.78rem">${escapeHtml(ep.episode_id)}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</td>
          <td>${transcriptCell}</td>
          ${srtCells}
          <td><div class="cons-actions">${importTrBtn}${importSrtBtn}</div></td>
        </tr>`;
    })
    .join("");

  const paginationHtml = pageCount > 1 ? `
    <div class="cons-pagination">
      <button class="btn btn-ghost btn-sm" id="cons-page-prev" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, total)} / ${total} épisodes</span>
      <button class="btn btn-ghost btn-sm" id="cons-page-next" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>
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

// ── Text viewer ──────────────────────────────────────────────────────────────

async function loadTextPanel(
  panel: HTMLElement,
  epId: string,
  epTitle: string,
  tabs: { key: string; label: string }[],
) {
  panel.innerHTML = `
    <div class="acts-text-header">
      <span class="acts-text-ep-title">${escapeHtml(epTitle)}</span>
      <div class="acts-text-tabs">
        ${tabs.map((t, i) => `<button class="acts-text-tab${i === 0 ? " active" : ""}" data-tab="${escapeHtml(t.key)}">${escapeHtml(t.label)}</button>`).join("")}
      </div>
    </div>
    <div class="acts-text-body acts-text-loading">Chargement…</div>`;

  try {
    const src = await fetchEpisodeSource(epId, "transcript") as TranscriptSourceContent;
    const contentMap: Record<string, string> = {
      raw:   src.raw  ?? "",
      clean: src.clean ?? src.raw ?? "",
    };
    const bodyEl = panel.querySelector<HTMLElement>(".acts-text-body")!;

    function showTab(key: string) {
      panel.querySelectorAll<HTMLElement>(".acts-text-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === key),
      );
      bodyEl.className = "acts-text-body";
      bodyEl.textContent = contentMap[key] ?? contentMap["raw"] ?? "";
    }

    showTab(tabs[0].key);
    panel.querySelectorAll<HTMLButtonElement>(".acts-text-tab").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.dataset.tab!));
    });
  } catch (e) {
    const body = panel.querySelector<HTMLElement>(".acts-text-body");
    if (body) {
      body.className = "acts-text-body acts-text-loading";
      body.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
    }
  }
}

function wireTextPanelRows(tableScope: HTMLElement, panel: HTMLElement, tabs: { key: string; label: string }[]) {
  tableScope.querySelectorAll<HTMLTableRowElement>("tr[data-ep-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      tableScope.querySelectorAll("tr.active-row").forEach((r) => r.classList.remove("active-row"));
      row.classList.add("active-row");
      loadTextPanel(panel, row.dataset.epId!, row.dataset.epTitle!, tabs);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_RULES: Record<string, string[]> = {
  default_en_v1:   ["Espaces", "Guillemets", "Ponctuation", "Invisibles"],
  default_fr_v1:   ["Espaces", "Guillemets typo.", "Ponctuation fine", "Invisibles", "Numérotation"],
  conservative_v1: ["Espaces", "Invisibles"],
  aggressive_v1:   ["Espaces", "Guillemets", "Ponctuation", "Invisibles", "Numérotation", "Casse forte"],
};

function renderCurationRuleChips(container: HTMLElement, profileId: string) {
  const el = container.querySelector<HTMLElement>("#cur-rule-chips");
  if (!el) return;
  const rules = PROFILE_RULES[profileId] ?? [];
  el.innerHTML = rules.length > 0
    ? rules.map((r) => `<span class="cur-rule-chip">${escapeHtml(r)}</span>`).join("")
    : `<span style="font-size:0.75rem;color:var(--text-muted);font-style:italic">—</span>`;
}

function renderCurationEpList(container: HTMLElement, episodes: Episode[]) {
  const listEl = container.querySelector<HTMLElement>("#cur-ep-list");
  if (!listEl) return;
  if (episodes.length === 0) {
    listEl.innerHTML = `<div style="padding:6px 0;font-size:0.78rem;color:var(--text-muted)">Aucun épisode.</div>`;
    return;
  }
  listEl.innerHTML = episodes.map((ep) => {
    const t = ep.sources.find((s) => s.source_key === "transcript");
    const state = t?.state ?? "unknown";
    const badge =
      state === "segmented"  ? `<span class="cons-badge segmented" style="font-size:0.65rem">seg.</span>` :
      state === "normalized" ? `<span class="cons-badge normalized" style="font-size:0.65rem">norm.</span>` :
      state === "raw"        ? `<span class="cons-badge raw" style="font-size:0.65rem">brut</span>` :
                               `<span class="cons-badge absent" style="font-size:0.65rem">—</span>`;
    const canNormalize = state === "raw" || state === "unknown";
    return `<div class="cur-ep-item" data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}" data-ep-state="${escapeHtml(state)}">
      <span class="cur-ep-id">${escapeHtml(ep.episode_id)}</span>
      <span class="cur-ep-name" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</span>
      ${badge}
      ${canNormalize ? `<button class="cur-ep-normalize" data-ep="${escapeHtml(ep.episode_id)}" title="Normaliser cet épisode">⚡</button>` : ""}
    </div>`;
  }).join("");

  // Wire clicks
  const previewPanes = container.querySelector<HTMLElement>("#cur-preview-panes")!;
  const previewBadge = container.querySelector<HTMLElement>("#cur-preview-badge");
  const diagEp       = container.querySelector<HTMLElement>("#cur-diag-ep");
  const activeMode   = () =>
    (container.querySelector<HTMLElement>(".cur-preview-tab.active") as HTMLElement | null)?.dataset.mode ?? "side";

  listEl.querySelectorAll<HTMLElement>(".cur-ep-item").forEach((item) => {
    item.addEventListener("click", async () => {
      listEl.querySelectorAll(".cur-ep-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      const epId    = item.dataset.epId!;
      const epTitle = item.dataset.epTitle!;
      const epState = item.dataset.epState!;

      if (previewBadge) previewBadge.textContent = epId;

      // Diagnostics
      if (diagEp) {
        const stateLabel = epState === "normalized" ? "normalisé" : epState === "segmented" ? "segmenté" : epState === "raw" ? "brut" : "—";
        diagEp.innerHTML = `
          <div class="cur-diag-title">Épisode</div>
          <div class="cur-stat-row"><span>${escapeHtml(epTitle)}</span></div>
          <div class="cur-stat-row"><span style="color:var(--text-muted)">ID</span><span class="cur-stat-val">${escapeHtml(epId)}</span></div>
          <div class="cur-stat-row"><span style="color:var(--text-muted)">État</span><span class="cur-stat-val">${escapeHtml(stateLabel)}</span></div>`;
      }

      await loadCurationPreview(previewPanes, epId, epTitle, activeMode());
    });
  });

  // Per-episode normalize buttons
  listEl.querySelectorAll<HTMLButtonElement>(".cur-ep-normalize").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const epId = btn.dataset.ep!;
      const profile = container.querySelector<HTMLSelectElement>("#cur-profile")?.value ?? "default_en_v1";
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await createJob("normalize_transcript", epId, "transcript", { normalize_profile: profile });
        startJobPoll(container);
        btn.textContent = "✓";
        // Update badge in the item
        const item = listEl.querySelector<HTMLElement>(`[data-ep-id="${epId}"]`);
        if (item) {
          item.dataset.epState = "normalized";
          const badgeEl = item.querySelector(".cons-badge");
          if (badgeEl) { badgeEl.textContent = "norm."; badgeEl.className = "cons-badge normalized"; (badgeEl as HTMLElement).style.fontSize = "0.65rem"; }
          setTimeout(() => btn.remove(), 800);
        }
      } catch {
        btn.disabled = false;
        btn.textContent = "⚡";
      }
    });
  });
}

let _curPreviewEpId: string | null = null;
let _curPreviewData: { raw: string; clean: string } | null = null;

async function loadCurationPreview(
  panes: HTMLElement,
  epId: string,
  epTitle: string,
  mode: string,
) {
  _curPreviewEpId = epId;

  if (!_curPreviewData || _curPreviewEpId !== epId) {
    panes.innerHTML = `<div class="acts-text-empty" style="width:100%">Chargement…</div>`;
    try {
      const src = await fetchEpisodeSource(epId, "transcript") as TranscriptSourceContent;
      _curPreviewData = { raw: src.raw ?? "", clean: src.clean ?? src.raw ?? "" };
    } catch (e) {
      panes.innerHTML = `<div class="acts-text-empty" style="width:100%">${escapeHtml(e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e))}</div>`;
      return;
    }
  }

  renderCurationPreviewMode(panes, _curPreviewData, mode, epTitle);
}

// ── Line-level diff (raw vs clean) ──────────────────────────────────────────

function buildDiffHtml(raw: string, clean: string): { html: string; nChanges: number } {
  const rawLines   = raw.split("\n");
  const cleanLines = clean.split("\n");
  const maxLen = Math.max(rawLines.length, cleanLines.length);
  let nChanges = 0;
  const parts: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const r = rawLines[i];
    const c = cleanLines[i];
    if (r === undefined) {
      // inserted line
      nChanges++;
      parts.push(`<div class="cur-diff-changed"><div class="cur-diff-ins">+ ${escapeHtml(c)}</div></div>`);
    } else if (c === undefined) {
      // deleted line
      nChanges++;
      parts.push(`<div class="cur-diff-changed"><div class="cur-diff-del">- ${escapeHtml(r)}</div></div>`);
    } else if (r === c) {
      parts.push(`<div class="cur-diff-same">${escapeHtml(r)}</div>`);
    } else {
      nChanges++;
      parts.push(`<div class="cur-diff-changed"><div class="cur-diff-del">- ${escapeHtml(r)}</div><div class="cur-diff-ins">+ ${escapeHtml(c)}</div></div>`);
    }
  }
  return { html: parts.join(""), nChanges };
}

function renderCurationPreviewMode(
  panes: HTMLElement,
  data: { raw: string; clean: string },
  mode: string,
  epTitle: string,
) {
  if (mode === "side") {
    panes.innerHTML = `
      <div class="cur-pane">
        <div class="cur-pane-head">Texte brut (source)</div>
        <div class="cur-pane-text">${escapeHtml(data.raw)}</div>
      </div>
      <div class="cur-pane">
        <div class="cur-pane-head">Texte normalisé</div>
        <div class="cur-pane-text">${escapeHtml(data.clean || "(non normalisé)")}</div>
      </div>`;
  } else if (mode === "raw") {
    panes.innerHTML = `
      <div class="cur-pane">
        <div class="cur-pane-head">Texte brut (source) — ${escapeHtml(epTitle)}</div>
        <div class="cur-pane-text">${escapeHtml(data.raw)}</div>
      </div>`;
  } else if (mode === "diff") {
    const cleanText = data.clean || data.raw;
    const { html, nChanges } = buildDiffHtml(data.raw, cleanText);
    const totalLines = data.raw.split("\n").length;
    panes.innerHTML = `
      <div class="cur-pane" style="overflow:hidden;display:flex;flex-direction:column">
        <div class="cur-pane-head">Diff brut → normalisé — ${escapeHtml(epTitle)}</div>
        <div class="cur-diff-summary">
          <strong>${nChanges}</strong> ligne(s) modifiée(s) sur ${totalLines}
          ${!data.clean ? ' <span style="color:var(--text-muted)">(pas encore normalisé — diff identique)</span>' : ""}
        </div>
        <div class="cur-diff-view">${html}</div>
      </div>`;
  } else {
    panes.innerHTML = `
      <div class="cur-pane">
        <div class="cur-pane-head">Texte normalisé — ${escapeHtml(epTitle)}</div>
        <div class="cur-pane-text">${escapeHtml(data.clean || data.raw)}</div>
      </div>`;
  }
}

async function loadAndRender(container: HTMLElement) {
  const epListEl = container.querySelector<HTMLElement>("#cur-ep-list");
  if (epListEl) {
    epListEl.innerHTML = `<div style="padding:6px 0;font-size:0.78rem;color:var(--text-muted)">Chargement…</div>`;
  }
  const errEl = container.querySelector<HTMLElement>(".cons-error");
  if (errEl) errEl.style.display = "none";
  _page = 0;

  try {
    const data = await measureAsync("constituer:load_episodes", fetchEpisodes);
    _cachedEpisodes = data;

    const seriesEl = container.querySelector<HTMLElement>(".cons-toolbar-series");
    if (seriesEl) seriesEl.textContent = data.series_title ?? "";

    renderCurationEpList(container, data.episodes);

    const profileSel = container.querySelector<HTMLSelectElement>("#cur-profile");
    if (profileSel) renderCurationRuleChips(container, profileSel.value);
  } catch (e) {
    const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
    if (epListEl) epListEl.innerHTML = `<div style="color:var(--danger);font-size:0.78rem">${escapeHtml(msg)}</div>`;
    const errEl2 = container.querySelector<HTMLElement>(".cons-error");
    if (errEl2) { errEl2.textContent = `Impossible de charger les épisodes : ${msg}`; errEl2.style.display = "block"; }
  }
}

// ── Section Documents ───────────────────────────────────────────────────────

function renderDocumentsSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div class="cons-toolbar">
      <span class="cons-toolbar-title">Documents</span>
      <input class="cons-search" id="docs-search" type="search" placeholder="Filtrer…" style="font-size:0.8rem;padding:3px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);width:180px">
      <button class="btn btn-ghost btn-sm" id="docs-refresh">↺ Actualiser</button>
    </div>
    <div class="docs-stats-bar" id="docs-stats-bar"></div>
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

  // Pipeline stats (on the unfiltered set)
  const statsBar = pane.querySelector<HTMLElement>("#docs-stats-bar");
  if (statsBar) {
    let nRaw = 0, nNorm = 0, nSeg = 0, nMissing = 0;
    for (const ep of _cachedEpisodes.episodes) {
      const t = ep.sources.find((s) => s.source_key === "transcript");
      if (!t?.available) { nMissing++; continue; }
      if (t.state === "segmented")  nSeg++;
      else if (t.state === "normalized") nNorm++;
      else nRaw++;
    }
    const total = _cachedEpisodes.episodes.length;
    statsBar.innerHTML = [
      `<span class="docs-stat">${total} épisode${total !== 1 ? "s" : ""}</span>`,
      nRaw     ? `<span class="docs-stat-sep">·</span><span class="docs-stat"><span class="cons-badge raw" style="font-size:0.68rem">brut</span> ${nRaw}</span>`         : "",
      nNorm    ? `<span class="docs-stat-sep">·</span><span class="docs-stat"><span class="cons-badge normalized" style="font-size:0.68rem">normalisé</span> ${nNorm}</span>` : "",
      nSeg     ? `<span class="docs-stat-sep">·</span><span class="docs-stat"><span class="cons-badge segmented" style="font-size:0.68rem">segmenté</span> ${nSeg}</span>`   : "",
      nMissing ? `<span class="docs-stat-sep">·</span><span class="docs-stat" style="color:var(--text-muted)">${nMissing} sans transcript</span>` : "",
    ].join("");
  }

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
          <button class="btn btn-secondary btn-sm" data-inspecter="${escapeHtml(ep.episode_id)}" title="Ouvrir dans l'Inspecter">→ Inspecter</button>
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
            <button class="btn btn-primary btn-sm" id="imp-transcript-btn">📄 Importer transcript</button>
            <button class="btn btn-secondary btn-sm" id="imp-srt-btn">🔤 Importer SRT</button>
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
              <button class="btn btn-secondary btn-sm" id="tvmaze-search-btn" style="white-space:nowrap">🔍 Chercher</button>
            </div>
            <div class="web-src-feedback" id="tvmaze-feedback"></div>
            <div class="web-src-results" id="tvmaze-results" style="display:none"></div>
          </div>

          <!-- Subslikescript tab -->
          <div class="web-src-pane" data-wsrc="subslikescript">
            <div class="web-src-row">
              <input class="web-src-input" id="subslike-url" type="text" placeholder="URL série (ex: https://subslikescript.com/series/...)" />
              <button class="btn btn-secondary btn-sm" id="subslike-discover-btn" style="white-space:nowrap">🔍 Découvrir</button>
            </div>
            <div class="web-src-feedback" id="subslike-feedback"></div>
            <div class="web-src-results" id="subslike-results" style="display:none"></div>
          </div>
        </div>
      </div>
    </div>`;

  loadImporterConfig(pane);
  wireImporterButtons(pane);
}

const NORMALIZE_PROFILES = [
  { id: "default_en_v1",   label: "default_en_v1 — Anglais standard" },
  { id: "default_fr_v1",   label: "default_fr_v1 — Français standard" },
  { id: "conservative_v1", label: "conservative_v1 — Conservateur" },
  { id: "aggressive_v1",   label: "aggressive_v1 — Agressif" },
];

const SOURCE_IDS = [
  { id: "subslikescript", label: "Subslikescript" },
  { id: "tvmaze",         label: "TVMaze" },
  { id: "",               label: "— autre —" },
];

async function loadImporterConfig(pane: HTMLElement) {
  const body = pane.querySelector<HTMLElement>("#imp-config-body");
  if (!body) return;
  body.innerHTML = `<div class="cons-loading" style="padding:8px 0">Chargement…</div>`;
  try {
    _cachedConfig = await fetchConfig();
    renderConfigForm(body, _cachedConfig, pane);
  } catch (e) {
    body.innerHTML = `<div style="color:var(--danger);font-size:0.82rem">${e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e)}</div>`;
  }
}

function renderConfigForm(body: HTMLElement, cfg: ConfigResponse, pane: HTMLElement) {
  const sourceOpts = SOURCE_IDS.map((s) =>
    `<option value="${s.id}" ${cfg.source_id === s.id ? "selected" : ""}>${escapeHtml(s.label)}</option>`
  ).join("");

  body.innerHTML = `
    <div class="cfg-form">
      <div class="cfg-row">
        <span class="cfg-label">Nom</span>
        <input class="cfg-input" id="cfg-project-name" type="text" value="${escapeHtml(cfg.project_name)}" />
      </div>
      <div class="cfg-row">
        <span class="cfg-label">Source</span>
        <select class="cfg-input cfg-select" id="cfg-source-id">${sourceOpts}</select>
      </div>
      <div class="cfg-row">
        <span class="cfg-label">URL série</span>
        <input class="cfg-input" id="cfg-series-url" type="text" value="${escapeHtml(cfg.series_url)}" placeholder="https://subslikescript.com/series/…" />
      </div>
      <div class="cfg-row">
        <span class="cfg-label">Langues</span>
        <input class="cfg-input" id="cfg-languages" type="text" value="${escapeHtml(cfg.languages.join(", "))}" placeholder="en, fr, it…" />
      </div>
      <div class="cfg-row" style="justify-content:flex-end;gap:6px">
        <span class="cfg-feedback" id="cfg-feedback"></span>
        <button class="btn btn-primary btn-sm" id="cfg-save-btn">Enregistrer</button>
      </div>
      <div class="cfg-path">📁 ${escapeHtml(cfg.project_path)}</div>
    </div>`;

  const feedback = body.querySelector<HTMLElement>("#cfg-feedback")!;
  body.querySelector<HTMLButtonElement>("#cfg-save-btn")!
    .addEventListener("click", async () => {
      feedback.textContent = "Enregistrement…";
      feedback.style.color = "var(--text-muted)";
      const update: ConfigUpdate = {
        project_name: (body.querySelector<HTMLInputElement>("#cfg-project-name")!.value),
        source_id:    (body.querySelector<HTMLSelectElement>("#cfg-source-id")!.value),
        series_url:   (body.querySelector<HTMLInputElement>("#cfg-series-url")!.value),
        languages:    (body.querySelector<HTMLInputElement>("#cfg-languages")!.value)
                        .split(",").map((l) => l.trim()).filter(Boolean),
      };
      try {
        _cachedConfig = await saveConfig(update);
        feedback.textContent = "✓ Enregistré";
        feedback.style.color = "var(--success, #16a34a)";
        // refresh episode select in case languages changed
        const epSel = pane.querySelector<HTMLSelectElement>("#imp-ep-select");
        if (epSel && _cachedEpisodes) populateEpSelect(epSel, _cachedEpisodes.episodes);
        setTimeout(() => { feedback.textContent = ""; }, 2500);
      } catch (e) {
        feedback.textContent = e instanceof ApiError ? e.message : String(e);
        feedback.style.color = "var(--danger, #dc2626)";
      }
    });

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
      ${showFetchBtn ? `<td><button class="btn btn-ghost btn-sm web-fetch-transcript-btn" data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-url="${escapeHtml(ep.url)}">⬇ Importer</button></td>` : ""}
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

// ── Sous-vue Segmentation ────────────────────────────────────────────────────

function renderSegmentationPane(container: HTMLElement, episodes: Episode[]) {
  const wrap = container.querySelector<HTMLElement>(".seg-table-wrap");
  if (!wrap) return;
  if (episodes.length === 0) {
    wrap.innerHTML = `<div class="cons-loading">Aucun épisode dans le projet.</div>`;
    return;
  }
  const rows = episodes.map((ep) => {
    const t = ep.sources.find((s) => s.source_key === "transcript");
    const state = t?.state ?? "unknown";
    const stateLabel =
      state === "segmented"   ? `<span class="cons-badge segmented">segmenté</span>` :
      state === "normalized"  ? `<span class="cons-badge normalized">normalisé</span>` :
      state === "raw"         ? `<span class="cons-badge raw">brut</span>` :
                                `<span class="cons-badge">—</span>`;
    const canSegment = state === "normalized";
    const action = canSegment
      ? `<button class="btn btn-primary btn-sm seg-ep-btn" data-ep="${escapeHtml(ep.episode_id)}">Segmenter</button>`
      : state === "segmented"
        ? `<span style="color:var(--success,#16a34a);font-size:0.78rem">✓</span>`
        : `<span style="color:var(--text-muted);font-size:0.78rem">—</span>`;
    return `<tr data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}">
      <td style="white-space:nowrap;font-family:ui-monospace,monospace;font-size:0.78rem">${escapeHtml(ep.episode_id)}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ep.title)}</td>
      <td>${stateLabel}</td>
      <td>${action}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `
    <table class="cons-table">
      <thead><tr><th>ID</th><th>Titre</th><th>État</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.querySelectorAll<HTMLButtonElement>(".seg-ep-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const epId   = btn.dataset.ep!;
      const segKind = container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "utterance";
      btn.disabled = true; btn.textContent = "…";
      try {
        await createJob("segment_transcript", epId, "transcript", { segment_kind: segKind });
        startJobPoll(container);
        btn.textContent = "✓ en queue";
      } catch (e) {
        btn.disabled = false; btn.textContent = "Segmenter";
        const errEl = container.querySelector<HTMLElement>(".seg-error");
        if (errEl) { errEl.textContent = e instanceof ApiError ? e.message : String(e); errEl.style.display = "block"; }
      }
    });
  });

  // Wire text viewer
  const segTextPanel = container.querySelector<HTMLElement>("#seg-text-panel");
  if (segTextPanel) {
    wireTextPanelRows(wrap, segTextPanel, [
      { key: "raw",   label: "Brut" },
      { key: "clean", label: "Normalisé" },
    ]);
  }
}

async function loadAndRenderSegmentation(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".seg-table-wrap");
  if (wrap) wrap.innerHTML = `<div class="cons-loading">Chargement…</div>`;
  try {
    const data = await fetchEpisodes();
    _cachedEpisodes = data;
    renderSegmentationPane(container, data.episodes);
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="cons-loading">${e instanceof ApiError ? e.message : String(e)}</div>`;
  }
}

// ── Segmentation Longtext view ───────────────────────────────────────────────

async function loadLongtextView(
  container: HTMLElement,
  epId: string | null,
  epTitle: string,
  kind: "utterance" | "sentence",
) {
  if (!epId) {
    container.innerHTML = `<div class="acts-text-empty">← Sélectionnez un épisode dans la vue Table</div>`;
    return;
  }
  container.innerHTML = `<div class="cons-loading">Chargement des segments…</div>`;
  try {
    const data = await fetchEpisodeSegments(epId, kind);
    if (data.segments.length === 0) {
      container.innerHTML = `<div class="acts-text-empty">Aucun segment de type «&nbsp;${escapeHtml(kind)}&nbsp;» pour cet épisode.</div>`;
      return;
    }
    renderLongtextSegments(container, epTitle, data.segments);
  } catch (e) {
    container.innerHTML = `<div class="cons-loading">${e instanceof ApiError ? e.message : String(e)}</div>`;
  }
}

function renderLongtextSegments(
  container: HTMLElement,
  _epTitle: string,
  segments: SegmentRow[],
) {
  const parasHtml = segments.map((s) => {
    const speakerAttr = s.speaker_explicit ? ` data-speaker="${escapeHtml(s.speaker_explicit)}"` : "";
    const speakerHtml = s.speaker_explicit
      ? `<span class="seg-lt-speaker">${escapeHtml(s.speaker_explicit)}</span>`
      : "";
    return `<div class="seg-lt-para" data-seg-id="${escapeHtml(s.segment_id)}" data-n="${s.n}" data-raw-text="${escapeHtml(s.text)}"${speakerAttr}>` +
      speakerHtml + escapeHtml(s.text) +
      `<span class="seg-lt-n">#${s.n}</span></div>`;
  }).join("");

  container.innerHTML = `
    <div class="seg-lt-search-bar">
      <input type="text" class="seg-lt-search-bar input" placeholder="Rechercher dans le texte…" id="lt-search-input" autocomplete="off">
      <div class="seg-lt-search-nav">
        <button id="lt-search-prev" title="Précédent (Shift+Entrée)">▲</button>
        <button id="lt-search-next" title="Suivant (Entrée)">▼</button>
      </div>
      <span class="seg-lt-search-count" id="lt-search-count"></span>
    </div>
    <div class="seg-lt-wrap" id="lt-content">${parasHtml}</div>`;

  const input   = container.querySelector<HTMLInputElement>("#lt-search-input")!;
  const prevBtn = container.querySelector<HTMLButtonElement>("#lt-search-prev")!;
  const nextBtn = container.querySelector<HTMLButtonElement>("#lt-search-next")!;
  const countEl = container.querySelector<HTMLElement>("#lt-search-count")!;
  const paras   = Array.from(container.querySelectorAll<HTMLElement>(".seg-lt-para"));

  let matches: HTMLElement[] = [];
  let matchIdx = -1;

  function rebuildPara(p: HTMLElement, highlight?: string) {
    const rawText = p.dataset.rawText ?? "";
    const speaker = p.dataset.speaker ?? "";
    const speakerHtml = speaker
      ? `<span class="seg-lt-speaker">${escapeHtml(speaker)}</span>`
      : "";
    const nHtml = `<span class="seg-lt-n">#${p.dataset.n ?? ""}</span>`;
    if (!highlight) {
      p.innerHTML = speakerHtml + escapeHtml(rawText) + nHtml;
      p.classList.remove("matched");
      return false;
    }
    const lower = rawText.toLowerCase();
    const lq = highlight.toLowerCase();
    let result = "";
    let pos = 0;
    let found = false;
    let idx: number;
    while ((idx = lower.indexOf(lq, pos)) !== -1) {
      result += escapeHtml(rawText.slice(pos, idx));
      result += `<mark class="conc-highlight">${escapeHtml(rawText.slice(idx, idx + highlight.length))}</mark>`;
      pos = idx + highlight.length;
      if (!found) found = true;
    }
    result += escapeHtml(rawText.slice(pos));
    p.innerHTML = speakerHtml + result + nHtml;
    p.classList.toggle("matched", found);
    return found;
  }

  function applySearch(q: string) {
    matches = [];
    matchIdx = -1;
    if (!q) {
      paras.forEach((p) => rebuildPara(p));
      countEl.textContent = "";
      return;
    }
    paras.forEach((p) => {
      const found = rebuildPara(p, q);
      if (found) matches.push(p);
    });
    countEl.textContent = matches.length > 0 ? `1/${matches.length}` : "0 résultat";
    if (matches.length > 0) {
      matchIdx = 0;
      matches[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function navigate(dir: 1 | -1) {
    if (matches.length === 0) return;
    matchIdx = (matchIdx + dir + matches.length) % matches.length;
    countEl.textContent = `${matchIdx + 1}/${matches.length}`;
    matches[matchIdx].scrollIntoView({ behavior: "smooth", block: "center" });
  }

  let debounceTimer: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => applySearch(input.value.trim()), 280);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
  });
  prevBtn.addEventListener("click", () => navigate(-1));
  nextBtn.addEventListener("click", () => navigate(1));
}

// ── Sous-vue Alignement ──────────────────────────────────────────────────────

function renderAlignementPane(container: HTMLElement, episodes: Episode[]) {
  const wrap = container.querySelector<HTMLElement>(".align-ep-wrap");
  if (!wrap) return;
  if (episodes.length === 0) {
    wrap.innerHTML = `<div class="cons-loading">Aucun épisode dans le projet.</div>`;
    return;
  }
  const rows = episodes.map((ep) => {
    const t = ep.sources.find((s) => s.source_key === "transcript");
    const srts = ep.sources.filter((s) => s.source_key.startsWith("srt_"));
    const isSegmented = t?.state === "segmented";
    const srtList = srts.length > 0
      ? srts.map((s) => `<span class="cons-badge">${escapeHtml(s.source_key.replace("srt_", ""))}</span>`).join(" ")
      : `<span style="color:var(--text-muted);font-size:0.78rem">—</span>`;
    const canAlign = isSegmented && srts.length > 0;
    const action = canAlign
      ? `<button class="btn btn-primary btn-sm align-ep-btn" data-ep="${escapeHtml(ep.episode_id)}" data-title="${escapeHtml(ep.title)}" data-srts="${escapeHtml(srts.map((s) => s.source_key).join(","))}">→ Aligner</button>`
      : `<span style="color:var(--text-muted);font-size:0.78rem" title="${!isSegmented ? "Segmenter d'abord" : "Importer un SRT"}">${!isSegmented ? "seg. manquante" : "SRT manquant"}</span>`;
    return `<tr data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}">
      <td style="white-space:nowrap;font-family:ui-monospace,monospace;font-size:0.78rem">${escapeHtml(ep.episode_id)}</td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ep.title)}</td>
      <td>${isSegmented ? `<span class="cons-badge segmented">✓</span>` : `<span class="cons-badge raw">—</span>`}</td>
      <td>${srtList}</td>
      <td>${action}</td>
    </tr>`;
  }).join("");
  wrap.innerHTML = `
    <table class="cons-table">
      <thead><tr><th>ID</th><th>Titre</th><th>Segments</th><th>SRTs</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.querySelectorAll<HTMLButtonElement>(".align-ep-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const epId       = btn.dataset.ep!;
      const epTitle    = btn.dataset.title!;
      const srtKeys    = (btn.dataset.srts || "").split(",").filter(Boolean);
      // Read segment_kind from the params panel selector
      const segKind    = (wrap.closest(".cons-actions-pane")?.querySelector<HTMLSelectElement>("#align-segment-kind-pre")?.value ?? "utterance") as "utterance" | "sentence";
      const handoff = {
        episode_id:    epId,
        episode_title: epTitle,
        pivot_key:     "transcript",
        target_keys:   srtKeys,
        mode:          "transcript_first" as const,
        segment_kind:  segKind,
      };
      _ctx?.setHandoff(handoff);
      _ctx?.navigateTo("aligner");
    });
  });

  // Wire text viewer + run history on row click
  const alignTextPanel = container.querySelector<HTMLElement>("#align-text-panel");
  if (alignTextPanel) {
    wrap.querySelectorAll<HTMLTableRowElement>("tr[data-ep-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        wrap.querySelectorAll("tr.active-row").forEach((r) => r.classList.remove("active-row"));
        row.classList.add("active-row");
        const epId    = row.dataset.epId!;
        const epTitle = row.dataset.epTitle ?? epId;
        loadAlignmentRunHistory(alignTextPanel, epId, epTitle);
      });
    });
  }
}

async function loadAlignmentRunHistory(panel: HTMLElement, epId: string, epTitle: string) {
  panel.innerHTML = `<div class="align-runs-panel"><div style="font-size:0.78rem;color:var(--text-muted)">Chargement historique…</div></div>`;
  try {
    const data = await fetchAlignmentRuns(epId);
    const runs = data.runs ?? [];
    if (runs.length === 0) {
      panel.innerHTML = `
        <div class="align-runs-panel">
          <div class="align-runs-title">${escapeHtml(epTitle)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">Aucun run d'alignement enregistré.</div>
        </div>`;
      return;
    }
    const cards = runs.map((r) => {
      const targetBadges = (r.target_langs ?? [])
        .map((l: string) => `<span class="align-run-lang-badge">${escapeHtml(l)}</span>`)
        .join(" ");
      const d = new Date(r.created_at);
      const dateStr = isNaN(d.getTime()) ? r.created_at : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
      return `
        <div class="align-run-card" data-run-id="${escapeHtml(r.run_id)}" data-pivot="${escapeHtml(r.pivot_lang)}" data-date="${escapeHtml(dateStr)}" tabindex="0" role="button" aria-label="Ouvrir audit run ${escapeHtml(r.run_id)}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span class="align-run-id" title="${escapeHtml(r.run_id)}">${escapeHtml(r.run_id.slice(0, 12))}…</span>
            <span class="align-run-date">${escapeHtml(dateStr)}</span>
          </div>
          <div class="align-run-langs">
            <span class="align-run-lang-badge" style="background:#dbeafe;color:#1d4ed8">${escapeHtml(r.pivot_lang)}</span>
            <span style="color:var(--text-muted);font-size:0.72rem">→</span>
            ${targetBadges}
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:2px">
            <span class="align-run-kind">${escapeHtml(r.segment_kind ?? "utterance")}</span>
            <span style="margin-left:auto;font-size:0.68rem;color:var(--accent)">Auditer →</span>
          </div>
        </div>`;
    }).join("");
    panel.innerHTML = `
      <div class="align-runs-panel">
        <div class="align-runs-title">${escapeHtml(epTitle)} — ${runs.length} run(s) · cliquez pour auditer</div>
        ${cards}
      </div>`;

    // Wire run card clicks → open audit view
    panel.querySelectorAll<HTMLElement>(".align-run-card").forEach((card) => {
      card.addEventListener("click", () => {
        panel.querySelectorAll(".align-run-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        openAuditView(panel, epId, epTitle, card.dataset.runId!);
      });
    });
  } catch (e) {
    const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
    panel.innerHTML = `<div class="align-runs-panel"><div style="color:var(--danger);font-size:0.78rem">${escapeHtml(msg)}</div></div>`;
  }
}

// ── Audit View ───────────────────────────────────────────────────────────────

interface AuditState {
  epId: string;
  runId: string;
  statusFilter: string;
  q: string;
  offset: number;
  limit: number;
  total: number;
  activeTab: "links" | "collisions" | "concordance";
}

const _auditState: AuditState = {
  epId: "", runId: "", statusFilter: "", q: "", offset: 0, limit: 50, total: 0, activeTab: "links",
};

let _concordanceLoaded = false;

async function openAuditView(panel: HTMLElement, epId: string, epTitle: string, runId: string) {
  _auditState.epId = epId;
  _auditState.runId = runId;
  _auditState.statusFilter = "";
  _auditState.q = "";
  _auditState.offset = 0;
  _auditState.activeTab = "links";
  _concordanceLoaded = false;

  panel.innerHTML = `
    <div class="audit-panel">
      <div class="audit-stats-strip" id="audit-stats-strip">
        <button class="audit-back-btn" id="audit-back">← Runs</button>
        <span style="font-size:0.8rem;font-weight:600;color:var(--text);flex:1">${escapeHtml(epTitle)}</span>
        <span style="font-size:0.72rem;color:var(--text-muted);font-family:ui-monospace,monospace">${escapeHtml(runId.slice(0, 14))}…</span>
      </div>
      <div id="audit-kpi-strip" class="audit-stats-strip" style="padding-top:4px;padding-bottom:4px">
        <span style="font-size:0.76rem;color:var(--text-muted)">Chargement stats…</span>
      </div>
      <div id="audit-quality-bar-row" class="audit-quality-bar-row">
        <div class="audit-quality-bar-wrap" id="audit-quality-bar"></div>
        <span id="audit-quality-label" class="audit-quality-label"></span>
      </div>
      <div class="audit-tabs">
        <button class="audit-tab active" data-tab="links">Liens</button>
        <button class="audit-tab" data-tab="collisions">Collisions <span class="audit-tab-badge" id="audit-collision-badge" style="display:none">0</span></button>
        <button class="audit-tab" data-tab="concordance">Concordancier</button>
      </div>
      <div class="audit-filter-bar" id="audit-filter-bar">
        <select id="audit-status-filter">
          <option value="">Tous statuts</option>
          <option value="auto">Auto</option>
          <option value="accepted">Acceptés</option>
          <option value="rejected">Rejetés</option>
        </select>
        <input id="audit-search" type="search" placeholder="Rechercher texte…" />
        <span id="audit-count" style="font-size:0.72rem;color:var(--text-muted);margin-left:auto"></span>
      </div>
      <div class="audit-body">
        <div class="audit-pane active" data-tab="links">
          <div class="audit-table-wrap" id="audit-table-wrap">
            <div style="padding:12px;font-size:0.78rem;color:var(--text-muted)">Chargement liens…</div>
          </div>
          <div class="audit-pager" id="audit-pager"></div>
        </div>
        <div class="audit-pane" data-tab="collisions">
          <div class="audit-collision-list" id="audit-collision-list">
            <div style="font-size:0.78rem;color:var(--text-muted)">Chargement collisions…</div>
          </div>
        </div>
        <div class="audit-pane" data-tab="concordance">
          <div id="audit-concordance-content" style="display:flex;flex-direction:column;height:100%;overflow:hidden">
            <div style="padding:12px;font-size:0.78rem;color:var(--text-muted)">Cliquez sur l'onglet pour charger le concordancier…</div>
          </div>
        </div>
      </div>
    </div>`;

  // Back button → restore run list
  panel.querySelector<HTMLButtonElement>("#audit-back")!.addEventListener("click", () => {
    loadAlignmentRunHistory(panel, epId, epTitle);
  });

  // Tab switching (lazy-load concordance on first activation)
  panel.querySelectorAll<HTMLButtonElement>(".audit-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".audit-tab").forEach((t) => t.classList.remove("active"));
      panel.querySelectorAll(".audit-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const pane = panel.querySelector<HTMLElement>(`.audit-pane[data-tab="${tab.dataset.tab}"]`);
      if (pane) pane.classList.add("active");
      _auditState.activeTab = tab.dataset.tab as "links" | "collisions" | "concordance";
      if (_auditState.activeTab === "concordance" && !_concordanceLoaded) {
        _concordanceLoaded = true;
        const concContent = panel.querySelector<HTMLElement>("#audit-concordance-content")!;
        loadConcordanceView(concContent, epId, epTitle, runId);
      }
    });
  });

  // Filter controls
  const statusSel = panel.querySelector<HTMLSelectElement>("#audit-status-filter")!;
  const searchInput = panel.querySelector<HTMLInputElement>("#audit-search")!;
  statusSel.addEventListener("change", () => {
    _auditState.statusFilter = statusSel.value;
    _auditState.offset = 0;
    loadAuditLinks(panel, epId, runId);
  });
  let _searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener("input", () => {
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      _auditState.q = searchInput.value.trim();
      _auditState.offset = 0;
      loadAuditLinks(panel, epId, runId);
    }, 280);
  });

  // Load stats + links + collisions in parallel
  loadAuditStats(panel, epId, runId);
  loadAuditLinks(panel, epId, runId);
  loadAuditCollisions(panel, epId, runId);
}

async function loadAuditStats(panel: HTMLElement, epId: string, runId: string) {
  const kpiStrip = panel.querySelector<HTMLElement>("#audit-kpi-strip");
  if (!kpiStrip) return;
  try {
    const s: AlignRunStats = await fetchAlignRunStats(epId, runId);
    const byStatus = s.by_status ?? {};
    const nAuto     = byStatus.auto     ?? 0;
    const nAccepted = byStatus.accepted ?? 0;
    const nRejected = byStatus.rejected ?? 0;
    const coverageStr = s.coverage_pct != null ? `${s.coverage_pct}%` : "—";
    const confStr = s.avg_confidence != null ? `${Math.round(s.avg_confidence * 100)}%` : "—";
    const collisionClass = s.n_collisions > 0 ? "blocking" : "ok";

    kpiStrip.innerHTML = `
      <div class="audit-stat"><span class="audit-stat-val">${s.nb_pivot}</span><span class="audit-stat-label">Pivot</span></div>
      <div class="audit-stat-sep"></div>
      <div class="audit-stat"><span class="audit-stat-val">${s.nb_target}</span><span class="audit-stat-label">Target</span></div>
      <div class="audit-stat-sep"></div>
      <div class="audit-stat"><span class="audit-stat-val ok">${nAccepted}</span><span class="audit-stat-label">Acceptés</span></div>
      <div class="audit-stat"><span class="audit-stat-val warn">${nAuto}</span><span class="audit-stat-label">Auto</span></div>
      <div class="audit-stat"><span class="audit-stat-val blocking">${nRejected}</span><span class="audit-stat-label">Rejetés</span></div>
      <div class="audit-stat-sep"></div>
      <div class="audit-stat"><span class="audit-stat-val">${coverageStr}</span><span class="audit-stat-label">Couverture</span></div>
      <div class="audit-stat"><span class="audit-stat-val">${confStr}</span><span class="audit-stat-label">Conf. moy.</span></div>
      <div class="audit-stat-sep"></div>
      <div class="audit-stat"><span class="audit-stat-val ${collisionClass}">${s.n_collisions}</span><span class="audit-stat-label">Collisions</span></div>`;

    // Update collision badge
    const badge = panel.querySelector<HTMLElement>("#audit-collision-badge");
    if (badge) {
      badge.textContent = String(s.n_collisions);
      badge.style.display = s.n_collisions > 0 ? "inline-flex" : "none";
    }

    // Quality bar
    const total = nAccepted + nAuto + nRejected;
    const qualRow = panel.querySelector<HTMLElement>("#audit-quality-bar-row");
    const qualBar = panel.querySelector<HTMLElement>("#audit-quality-bar");
    const qualLabel = panel.querySelector<HTMLElement>("#audit-quality-label");
    if (qualRow && qualBar && qualLabel && total > 0) {
      qualBar.innerHTML = `
        <div class="audit-quality-seg accepted" style="flex:${nAccepted}"></div>
        <div class="audit-quality-seg auto"     style="flex:${nAuto}"></div>
        <div class="audit-quality-seg rejected" style="flex:${nRejected}"></div>`;
      qualLabel.textContent = `${nAccepted} acceptés · ${nAuto} auto · ${nRejected} rejetés`;
      qualRow.style.display = "flex";
    }
  } catch (e) {
    kpiStrip.innerHTML = `<span style="font-size:0.76rem;color:var(--danger)">${e instanceof ApiError ? e.message : String(e)}</span>`;
  }
}

async function loadAuditLinks(panel: HTMLElement, epId: string, runId: string) {
  const wrap  = panel.querySelector<HTMLElement>("#audit-table-wrap");
  const pager = panel.querySelector<HTMLElement>("#audit-pager");
  const countEl = panel.querySelector<HTMLElement>("#audit-count");
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:12px;font-size:0.78rem;color:var(--text-muted)">Chargement…</div>`;
  try {
    const res = await fetchAuditLinks(epId, runId, {
      status: _auditState.statusFilter || undefined,
      q:      _auditState.q || undefined,
      offset: _auditState.offset,
      limit:  _auditState.limit,
    });
    _auditState.total = res.total;
    if (countEl) countEl.textContent = `${res.total} lien(s)`;

    if (res.links.length === 0) {
      wrap.innerHTML = `<div style="padding:16px;font-size:0.78rem;color:var(--text-muted)">Aucun lien trouvé.</div>`;
      if (pager) pager.innerHTML = "";
      return;
    }

    // Build table
    const rows = res.links.map((lnk) => renderAuditLinkRow(lnk)).join("");
    wrap.innerHTML = `
      <table class="audit-table">
        <thead>
          <tr>
            <th>#</th><th>Transcript</th><th>Pivot</th><th>Cible</th>
            <th>Lang</th><th style="text-align:center">Conf.</th>
            <th>Statut</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Wire accept/reject buttons
    wrap.querySelectorAll<HTMLButtonElement>(".audit-action-btn[data-link-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const linkId = btn.dataset.linkId!;
        const action = btn.dataset.action as "accepted" | "rejected" | "auto";
        btn.disabled = true;
        try {
          await setAlignLinkStatus(linkId, action);
          // Update row in-place
          const row = btn.closest<HTMLTableRowElement>("tr");
          if (row) {
            row.className = action;
            const statusCell = row.querySelector(".audit-status-badge");
            if (statusCell) {
              statusCell.className = `audit-status-badge ${action}`;
              statusCell.textContent = action === "accepted" ? "✓ accepté" : action === "rejected" ? "✗ rejeté" : "auto";
            }
            // Swap buttons: if accepted → show reject+undo, if rejected → show accept+undo
            const actionsCell = row.querySelector(".audit-row-actions");
            if (actionsCell) actionsCell.innerHTML = renderAuditActions(linkId, action);
            rewireAuditButtons(wrap);
          }
          // Refresh stats
          loadAuditStats(panel, epId, runId);
        } catch (e) {
          btn.disabled = false;
        }
      });
    });

    // Pagination
    if (pager) renderAuditPager(pager, panel, epId, runId);
  } catch (e) {
    wrap.innerHTML = `<div style="padding:12px;font-size:0.78rem;color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
  }
}

function renderAuditLinkRow(lnk: AuditLink): string {
  const segText    = escapeHtml((lnk.text_segment || "").slice(0, 120));
  const pivotText  = escapeHtml((lnk.text_pivot   || "").slice(0, 100));
  const targetText = escapeHtml((lnk.text_target  || "").slice(0, 100));
  const speaker    = lnk.speaker_explicit ? `<span style="font-size:0.65rem;color:var(--text-muted)">${escapeHtml(lnk.speaker_explicit)}: </span>` : "";
  const confPct    = lnk.confidence != null ? Math.round(lnk.confidence * 100) : null;
  const confBar    = confPct != null
    ? `<span class="audit-conf-bar" style="width:${confPct * 0.4}px" title="${confPct}%"></span>${confPct}%`
    : "—";
  const n = lnk.segment_n != null ? lnk.segment_n : "—";
  return `
    <tr class="${lnk.status}" data-link-id="${escapeHtml(lnk.link_id)}">
      <td style="font-family:ui-monospace,monospace;font-size:0.68rem;color:var(--text-muted)">${n}</td>
      <td style="max-width:180px">${speaker}${segText || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="max-width:140px">${pivotText  || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="max-width:140px">${targetText || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><span class="align-run-lang-badge">${escapeHtml(lnk.lang || "—")}</span></td>
      <td style="text-align:center;white-space:nowrap">${confBar}</td>
      <td><span class="audit-status-badge ${lnk.status}">${lnk.status === "accepted" ? "✓ accepté" : lnk.status === "rejected" ? "✗ rejeté" : "auto"}</span></td>
      <td class="audit-row-actions">${renderAuditActions(lnk.link_id, lnk.status)}</td>
    </tr>`;
}

function renderAuditActions(linkId: string, currentStatus: string): string {
  if (currentStatus === "accepted") {
    return `<button class="audit-action-btn reject" data-link-id="${escapeHtml(linkId)}" data-action="rejected" title="Rejeter">✗</button>
            <button class="audit-action-btn undo"   data-link-id="${escapeHtml(linkId)}" data-action="auto"     title="Réinitialiser">↺</button>`;
  }
  if (currentStatus === "rejected") {
    return `<button class="audit-action-btn accept" data-link-id="${escapeHtml(linkId)}" data-action="accepted" title="Accepter">✓</button>
            <button class="audit-action-btn undo"   data-link-id="${escapeHtml(linkId)}" data-action="auto"     title="Réinitialiser">↺</button>`;
  }
  return `<button class="audit-action-btn accept" data-link-id="${escapeHtml(linkId)}" data-action="accepted" title="Accepter">✓</button>
          <button class="audit-action-btn reject" data-link-id="${escapeHtml(linkId)}" data-action="rejected" title="Rejeter">✗</button>`;
}

function rewireAuditButtons(wrap: HTMLElement) {
  // Re-wire freshly rendered buttons after in-place update
  wrap.querySelectorAll<HTMLButtonElement>(".audit-action-btn[data-link-id]").forEach((btn) => {
    // Remove old listeners by cloning (cheap, works with small DOM)
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
  });
  // Re-attach — handled by parent re-render; caller must re-call loadAuditLinks if needed
}

function renderAuditPager(pager: HTMLElement, panel: HTMLElement, epId: string, runId: string) {
  const { offset, limit, total } = _auditState;
  const page    = Math.floor(offset / limit) + 1;
  const nPages  = Math.ceil(total / limit);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  pager.innerHTML = `
    <button class="audit-action-btn" id="audit-prev" ${hasPrev ? "" : "disabled"}>← Préc.</button>
    <span>Page ${page} / ${nPages || 1}</span>
    <button class="audit-action-btn" id="audit-next" ${hasNext ? "" : "disabled"}>Suiv. →</button>`;
  pager.querySelector<HTMLButtonElement>("#audit-prev")?.addEventListener("click", () => {
    _auditState.offset = Math.max(0, offset - limit);
    loadAuditLinks(panel, epId, runId);
  });
  pager.querySelector<HTMLButtonElement>("#audit-next")?.addEventListener("click", () => {
    _auditState.offset = offset + limit;
    loadAuditLinks(panel, epId, runId);
  });
}

async function loadAuditCollisions(panel: HTMLElement, epId: string, runId: string) {
  const listEl = panel.querySelector<HTMLElement>("#audit-collision-list");
  if (!listEl) return;
  try {
    const res = await fetchAlignCollisions(epId, runId);
    const cols: AlignCollision[] = res.collisions ?? [];
    if (cols.length === 0) {
      listEl.innerHTML = `<div style="padding:14px;font-size:0.78rem;color:var(--success,#16a34a)">✅ Aucune collision détectée.</div>`;
      return;
    }

    const batchHtml = `
      <div class="audit-collision-actions">
        <span style="font-weight:600;color:#7f1d1d;font-size:0.76rem">${cols.length} pivot${cols.length > 1 ? "s" : ""} en collision</span>
        <button class="audit-action-btn accept" id="col-keep-best" title="Accepter la cible la plus confiante par pivot, rejeter les autres">✓ Conserver les meilleurs</button>
        <button class="audit-action-btn reject" id="col-reject-all" title="Rejeter toutes les cibles en collision">✗ Tout rejeter</button>
      </div>`;

    const cardsHtml = cols.map((c) => `
      <div class="audit-collision-card">
        <div class="audit-collision-pivot">
          <span class="align-run-lang-badge" style="background:#dbeafe;color:#1d4ed8">${escapeHtml(c.lang)}</span>
          pivot : ${escapeHtml(c.pivot_text || c.pivot_cue_id)}
          <span style="font-size:0.7rem;color:#b91c1c;margin-left:8px">${c.n_targets} cibles en conflit</span>
        </div>
        ${c.targets.map((t) => `
          <div class="audit-collision-target-row" data-link-id="${escapeHtml(t.link_id)}">
            <span class="audit-status-badge ${t.status}">${t.status}</span>
            <span class="audit-collision-target-text" title="${escapeHtml(t.target_text || t.cue_id_target)}">${escapeHtml(t.target_text || t.cue_id_target)}</span>
            ${t.confidence != null ? `<span class="audit-collision-target-conf">${Math.round(t.confidence * 100)}%</span>` : ""}
            <div class="audit-collision-target-btns">
              <button class="audit-action-btn accept col-accept" data-link-id="${escapeHtml(t.link_id)}" title="Accepter">✓</button>
              <button class="audit-action-btn reject col-reject" data-link-id="${escapeHtml(t.link_id)}" title="Rejeter">✗</button>
            </div>
          </div>`).join("")}
      </div>`).join("");

    listEl.innerHTML = batchHtml + `<div class="audit-collision-scroll">${cardsHtml}</div>`;

    // Per-target actions
    listEl.querySelectorAll<HTMLButtonElement>(".col-accept, .col-reject").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const lid = btn.dataset.linkId!;
        const newStatus: "accepted" | "rejected" = btn.classList.contains("col-accept") ? "accepted" : "rejected";
        btn.disabled = true;
        try {
          await setAlignLinkStatus(lid, newStatus);
          loadAuditCollisions(panel, epId, runId);
          loadAuditStats(panel, epId, runId);
        } catch { btn.disabled = false; }
      });
    });

    // Batch: reject all
    listEl.querySelector<HTMLButtonElement>("#col-reject-all")?.addEventListener("click", async () => {
      const allLinks = cols.flatMap((c) => c.targets.map((t) => t.link_id));
      try {
        await Promise.all(allLinks.map((lid) => setAlignLinkStatus(lid, "rejected")));
        loadAuditCollisions(panel, epId, runId);
        loadAuditStats(panel, epId, runId);
      } catch (e) {
        listEl.insertAdjacentHTML("afterbegin",
          `<div style="padding:6px 14px;font-size:0.76rem;color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`);
      }
    });

    // Batch: keep best (highest confidence per pivot, reject rest)
    listEl.querySelector<HTMLButtonElement>("#col-keep-best")?.addEventListener("click", async () => {
      const ops: Promise<unknown>[] = [];
      for (const col of cols) {
        const sorted = [...col.targets].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        sorted.forEach((t, i) => {
          ops.push(setAlignLinkStatus(t.link_id, i === 0 ? "accepted" : "rejected"));
        });
      }
      try {
        await Promise.all(ops);
        loadAuditCollisions(panel, epId, runId);
        loadAuditStats(panel, epId, runId);
      } catch (e) {
        listEl.insertAdjacentHTML("afterbegin",
          `<div style="padding:6px 14px;font-size:0.76rem;color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`);
      }
    });

  } catch (e) {
    listEl.innerHTML = `<div style="padding:14px;font-size:0.78rem;color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
  }
}

// ── Concordancier parallèle ───────────────────────────────────────────────────

async function loadConcordanceView(
  container: HTMLElement,
  epId: string,
  epTitle: string,
  runId: string,
) {
  container.innerHTML = `
    <div class="conc-panel">
      <div class="conc-toolbar">
        <span class="conc-toolbar-title">${escapeHtml(epTitle)}</span>
        <input class="conc-search" id="conc-search" type="search" placeholder="Rechercher…" />
        <select class="conc-filter-select" id="conc-status-filter">
          <option value="">Tous</option>
          <option value="accepted">Acceptés</option>
          <option value="auto">Auto</option>
          <option value="rejected">Rejetés</option>
        </select>
        <span class="conc-count" id="conc-count">Chargement…</span>
      </div>
      <div class="conc-table-wrap" id="conc-table-wrap">
        <div class="conc-empty">Chargement concordancier…</div>
      </div>
    </div>`;

  let _concTimer: ReturnType<typeof setTimeout> | null = null;

  const doLoad = async () => {
    const q      = (container.querySelector<HTMLInputElement>("#conc-search")?.value ?? "").trim();
    const status = container.querySelector<HTMLSelectElement>("#conc-status-filter")?.value ?? "";
    await renderConcordance(container, epId, runId, { q: q || undefined, status: status || undefined });
  };

  container.querySelector<HTMLInputElement>("#conc-search")?.addEventListener("input", () => {
    if (_concTimer) clearTimeout(_concTimer);
    _concTimer = setTimeout(doLoad, 300);
  });
  container.querySelector<HTMLSelectElement>("#conc-status-filter")?.addEventListener("change", doLoad);

  await doLoad();
}

async function renderConcordance(
  container: HTMLElement,
  epId: string,
  runId: string,
  filters: { q?: string; status?: string } = {},
) {
  const wrap    = container.querySelector<HTMLElement>("#conc-table-wrap")!;
  const countEl = container.querySelector<HTMLElement>("#conc-count");
  wrap.innerHTML = `<div class="conc-empty">Chargement…</div>`;
  try {
    const res = await fetchConcordance(epId, runId, { q: filters.q, status: filters.status });
    if (countEl) countEl.textContent = `${res.total} ligne(s)`;
    if (res.rows.length === 0) {
      wrap.innerHTML = `<div class="conc-empty">Aucun résultat${filters.q ? ` pour « ${escapeHtml(filters.q)} »` : ""}.</div>`;
      return;
    }
    // Determine which target lang columns exist in the data
    const hasEn = res.rows.some((r) => r.text_en);
    const hasFr = res.rows.some((r) => r.text_fr);
    const hasIt = res.rows.some((r) => r.text_it);
    const hl = filters.q ? filters.q.toLowerCase() : null;

    const highlight = (text: string): string => {
      if (!hl || !text) return escapeHtml(text);
      const escaped = escapeHtml(text);
      const escapedHl = escapeHtml(hl);
      return escaped.replace(
        new RegExp(escapedHl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        (m) => `<mark class="conc-highlight">${escapeHtml(m)}</mark>`,
      );
    };

    const confBadge = (conf: number | null) =>
      conf != null ? `<span class="conc-conf">${Math.round(conf * 100)}%</span>` : "";

    const colHeaders = [
      `<th>#</th>`,
      `<th>Personnage</th>`,
      `<th>Transcript</th>`,
      hasEn ? `<th>EN (pivot)</th>` : "",
      hasFr ? `<th>FR</th>` : "",
      hasIt ? `<th>IT</th>` : "",
    ].filter(Boolean).join("");

    const rowsHtml = res.rows.map((row: ConcordanceRow, i: number) => {
      const speakerHtml = row.personnage
        ? `<span class="conc-speaker">${escapeHtml(row.personnage)}</span>` : "";
      return `<tr>
        <td style="font-family:ui-monospace,monospace;font-size:0.68rem;color:var(--text-muted);text-align:right">${i + 1}</td>
        <td style="font-size:0.72rem;color:var(--accent);white-space:nowrap">${speakerHtml}</td>
        <td style="max-width:200px">${highlight(row.text_segment)}</td>
        ${hasEn ? `<td style="max-width:180px">${highlight(row.text_en)}${confBadge(row.confidence_pivot)}</td>` : ""}
        ${hasFr ? `<td style="max-width:180px">${highlight(row.text_fr)}${confBadge(row.confidence_fr)}</td>` : ""}
        ${hasIt ? `<td style="max-width:180px">${highlight(row.text_it)}</td>` : ""}
      </tr>`;
    }).join("");

    wrap.innerHTML = `
      <table class="conc-table">
        <thead><tr>${colHeaders}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  } catch (e) {
    wrap.innerHTML = `<div class="conc-empty" style="color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
  }
}

async function loadAndRenderAlignement(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".align-ep-wrap");
  if (wrap) wrap.innerHTML = `<div class="cons-loading">Chargement…</div>`;
  try {
    const data = await fetchEpisodes();
    _cachedEpisodes = data;
    renderAlignementPane(container, data.episodes);
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="cons-loading">${e instanceof ApiError ? e.message : String(e)}</div>`;
  }
}

// ── Section Exporter ─────────────────────────────────────────────────────────

function renderExporterSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div class="exp-section">
      <!-- Gate banner QA -->
      <div id="cons-exp-gate" style="display:none;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius);font-size:0.8rem;font-weight:600;border:1px solid;flex-shrink:0;margin-bottom:4px"></div>

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
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="corpus" data-fmt="txt">TXT</button>
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="corpus" data-fmt="csv">CSV</button>
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="corpus" data-fmt="json">JSON</button>
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="corpus" data-fmt="docx">DOCX</button>
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
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="segments" data-fmt="txt">TXT</button>
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="segments" data-fmt="csv">CSV</button>
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="segments" data-fmt="tsv">TSV</button>
            </div>
            <div class="exp-result" id="exp-segments-result"></div>
          </div>
        </div>

        <!-- Jobs -->
        <div class="cons-card">
          <div class="cons-card-title">Historique jobs</div>
          <div class="cons-card-body">
            <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5">
              Export de tous les jobs du projet (normalisation, segmentation, alignement…).
            </div>
            <div class="exp-fmt-row">
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="jobs" data-fmt="jsonl">JSONL</button>
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="jobs" data-fmt="json">JSON</button>
            </div>
            <div class="exp-result" id="exp-jobs-result"></div>
          </div>
        </div>

      </div>

      <div style="font-size:0.76rem;color:var(--text-muted);line-height:1.6">
        Les fichiers sont écrits dans le dossier <code>exports/</code> du projet.
      </div>
    </div>`;

  pane.querySelectorAll<HTMLButtonElement>(".exp-export-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scope = btn.dataset.scope as "corpus" | "segments" | "jobs";
      const fmt   = btn.dataset.fmt!;
      const resultEl = pane.querySelector<HTMLElement>(`#exp-${scope}-result`)!;

      btn.disabled = true;
      resultEl.textContent = "Export en cours…";
      resultEl.className = "exp-result visible";

      try {
        const res: ExportResult = await runExport(scope, fmt);
        const count = res.episodes != null
          ? `${res.episodes} épisodes`
          : res.segments != null
            ? `${res.segments} segments`
            : `${res.jobs ?? 0} jobs`;
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

  // Load QA gate async
  loadConsExportQa(pane);
}

async function loadConsExportQa(pane: HTMLElement) {
  const banner = pane.querySelector<HTMLElement>("#cons-exp-gate");
  if (!banner) return;
  try {
    const qa: QaReport = await fetchQaReport("lenient");
    const colors: Record<string, string> = {
      ok:       "background:#f0fdf4;border-color:#86efac;color:#166534",
      warnings: "background:#fefce8;border-color:#fde047;color:#854d0e",
      blocking: "background:#fef2f2;border-color:#fca5a5;color:#7f1d1d",
    };
    const icons: Record<string, string> = { ok: "✅", warnings: "⚠️", blocking: "🔴" };
    const msgs: Record<string, string> = {
      ok:       `Corpus OK — ${qa.total_episodes} épisodes, ${qa.n_segmented} segmentés`,
      warnings: `${qa.issues.filter(i => i.level === "warning").length} avertissement(s) — ${qa.n_segmented}/${qa.total_episodes} segmentés`,
      blocking: `${qa.issues.filter(i => i.level === "blocking").length} problème(s) bloquant(s) — vérifier la curation`,
    };
    banner.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--radius);font-size:0.8rem;font-weight:600;border:1px solid;flex-shrink:0;margin-bottom:4px;${colors[qa.gate]}`;
    banner.innerHTML = `<span>${icons[qa.gate]}</span> ${escapeHtml(msgs[qa.gate])}`;
  } catch {
    // Silent fail — QA banner is optional
  }
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
      <button class="btn btn-secondary btn-sm" id="pers-auto-btn" title="Assigner automatiquement les locuteurs aux personnages par correspondance d'alias">⚡ Auto-assigner</button>
      <button class="btn btn-ghost btn-sm" id="pers-refresh">↺</button>
    </div>
    <div class="cons-error" id="pers-error" style="display:none;margin:0 16px 0"></div>
    <div id="pers-auto-result" style="display:none;margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)"></div>
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

  pane.querySelector<HTMLButtonElement>("#pers-auto-btn")!
    .addEventListener("click", async () => {
      const btn = pane.querySelector<HTMLButtonElement>("#pers-auto-btn")!;
      const resultEl = pane.querySelector<HTMLElement>("#pers-auto-result")!;
      btn.disabled = true;
      btn.textContent = "…";
      resultEl.style.display = "none";

      // Dry-run first to show a preview
      try {
        const preview: AutoAssignResult = await autoAssignCharacters(true);
        if (preview.created === 0 && preview.unmatched_labels.length === 0) {
          resultEl.textContent = "✓ Toutes les assignations sont déjà à jour.";
          resultEl.style.cssText = "display:block;background:#f0fdf4;color:#166534;margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
          btn.disabled = false; btn.textContent = "⚡ Auto-assigner";
          return;
        }
        let msg = preview.created > 0
          ? `${preview.created} nouvelle${preview.created > 1 ? "s" : ""} assignation${preview.created > 1 ? "s" : ""} détectée${preview.created > 1 ? "s" : ""}.`
          : "Aucune nouvelle assignation à créer.";
        if (preview.unmatched_labels.length > 0) {
          const sample = preview.unmatched_labels.slice(0, 5).join(", ");
          const more = preview.unmatched_labels.length > 5 ? ` +${preview.unmatched_labels.length - 5} autres` : "";
          msg += ` Locuteurs non reconnus : ${sample}${more}.`;
        }
        if (preview.created === 0) {
          resultEl.textContent = msg;
          resultEl.style.cssText = "display:block;background:var(--surface2);color:var(--text-muted);margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
          btn.disabled = false; btn.textContent = "⚡ Auto-assigner";
          return;
        }
        if (!confirm(`${msg}\n\nConfirmer la création de ${preview.created} assignation${preview.created > 1 ? "s" : ""} ?`)) {
          btn.disabled = false; btn.textContent = "⚡ Auto-assigner";
          return;
        }
        // Apply
        const result: AutoAssignResult = await autoAssignCharacters(false);
        resultEl.textContent = `✓ ${result.created} assignation${result.created > 1 ? "s" : ""} créée${result.created > 1 ? "s" : ""} (total : ${result.total_after}).`;
        resultEl.style.cssText = "display:block;background:#f0fdf4;color:#166534;margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
        await loadPersonnages(pane);
      } catch (e) {
        resultEl.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
        resultEl.style.cssText = "display:block;background:#fef2f2;color:#7f1d1d;margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
      } finally {
        btn.disabled = false; btn.textContent = "⚡ Auto-assigner";
      }
    });

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

// ── Presets (shell utility) ──────────────────────────────────────────────────

const PRESETS_KEY = "himyc.presets";

interface ProjectPreset {
  id: string;
  name: string;
  pivot_lang: string;
  target_langs: string;   // comma-separated
  seg_lang: string;
  created_at: string;
}

const SEED_PRESETS: ProjectPreset[] = [
  { id: "seed_fr_en", name: "FR → EN",  pivot_lang: "fr", target_langs: "en",    seg_lang: "fr", created_at: "seed" },
  { id: "seed_en_fr", name: "EN → FR",  pivot_lang: "en", target_langs: "fr",    seg_lang: "en", created_at: "seed" },
  { id: "seed_de_fr", name: "DE → FR",  pivot_lang: "de", target_langs: "fr",    seg_lang: "de", created_at: "seed" },
];

function loadPresets(): ProjectPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) return JSON.parse(raw) as ProjectPreset[];
  } catch { /* */ }
  return [...SEED_PRESETS];
}

function savePresets(list: ProjectPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
}

function renderPresets(body: HTMLElement) {
  const list = loadPresets();
  if (list.length === 0) {
    body.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted)">Aucun preset. Créez-en un ou restaurez les presets par défaut.</div>`;
    return;
  }
  body.innerHTML = list.map((p) => `
    <div class="preset-card" data-id="${escapeHtml(p.id)}">
      <div class="preset-card-info">
        <div class="preset-card-name">${escapeHtml(p.name)}</div>
        <div class="preset-card-meta">pivot: <b>${escapeHtml(p.pivot_lang)}</b> → ${escapeHtml(p.target_langs)} · seg: ${escapeHtml(p.seg_lang)}</div>
      </div>
      <div class="preset-card-actions">
        <button class="btn btn-primary btn-sm preset-apply-btn" data-id="${escapeHtml(p.id)}" title="Appliquer">✓</button>
        <button class="btn btn-ghost btn-sm preset-del-btn" data-id="${escapeHtml(p.id)}" title="Supprimer">✕</button>
      </div>
    </div>`).join("");

  body.querySelectorAll<HTMLButtonElement>(".preset-del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      const updated = loadPresets().filter((p) => p.id !== id);
      savePresets(updated);
      renderPresets(body);
    });
  });

  body.querySelectorAll<HTMLButtonElement>(".preset-apply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id!;
      const p = loadPresets().find((x) => x.id === id);
      if (!p) return;
      localStorage.setItem("himyc.active-preset", JSON.stringify(p));
      btn.textContent = "✅";
      setTimeout(() => { btn.textContent = "✓"; }, 1500);
    });
  });
}

function renderPresetsNewForm(body: HTMLElement) {
  // Only add form if not already showing
  if (body.querySelector(".preset-new-form")) return;
  const form = document.createElement("div");
  form.className = "preset-new-form";
  form.innerHTML = `
    <div style="font-size:0.8rem;font-weight:600;color:var(--text);margin-bottom:4px">Nouveau preset</div>
    <div class="preset-new-form-row">
      <label>Nom</label>
      <input id="pnf-name" type="text" placeholder="Ex: FR → EN bilingue" />
    </div>
    <div class="preset-new-form-row">
      <label>Pivot</label>
      <input id="pnf-pivot" type="text" placeholder="fr" style="max-width:80px" />
    </div>
    <div class="preset-new-form-row">
      <label>Cibles</label>
      <input id="pnf-targets" type="text" placeholder="en,de" />
    </div>
    <div class="preset-new-form-row">
      <label>Seg. langue</label>
      <input id="pnf-seglang" type="text" placeholder="fr" style="max-width:80px" />
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn btn-primary btn-sm" id="pnf-save">Enregistrer</button>
      <button class="btn btn-ghost btn-sm" id="pnf-cancel">Annuler</button>
    </div>`;

  body.appendChild(form);

  form.querySelector<HTMLButtonElement>("#pnf-cancel")?.addEventListener("click", () => {
    form.remove();
  });

  form.querySelector<HTMLButtonElement>("#pnf-save")?.addEventListener("click", () => {
    const name    = (form.querySelector<HTMLInputElement>("#pnf-name")?.value ?? "").trim();
    const pivot   = (form.querySelector<HTMLInputElement>("#pnf-pivot")?.value ?? "").trim();
    const targets = (form.querySelector<HTMLInputElement>("#pnf-targets")?.value ?? "").trim();
    const seglang = (form.querySelector<HTMLInputElement>("#pnf-seglang")?.value ?? "").trim();
    if (!name || !pivot) return;
    const newPreset: ProjectPreset = {
      id: `custom_${Date.now()}`,
      name,
      pivot_lang:   pivot,
      target_langs: targets,
      seg_lang:     seglang || pivot,
      created_at:   new Date().toISOString(),
    };
    const updated = [...loadPresets(), newPreset];
    savePresets(updated);
    renderPresets(body);
    form.remove();
  });
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
    <div class="cons-root">
    <div class="cons-shell${_navCollapsed ? " nav-hidden" : ""}" id="cons-shell">

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

        <button class="cons-nav-presets-btn" id="cons-presets-btn" title="Gérer les presets de projet">⚙ Presets</button>
      </nav>

      <!-- Presets modal -->
      <dialog class="cons-presets-modal" id="cons-presets-modal">
        <div class="presets-modal-head">
          <h3>⚙ Presets de projet</h3>
          <button class="btn btn-ghost btn-sm" id="cons-presets-close">✕</button>
        </div>
        <div class="presets-modal-body" id="cons-presets-body">
          <!-- rendered by renderPresets() -->
        </div>
        <div class="presets-modal-foot">
          <button class="btn btn-primary btn-sm" id="cons-presets-new">+ Nouveau preset</button>
        </div>
      </dialog>

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
            <div class="cons-placeholder-desc">Chargement…</div>
          </div>
        </div>

        <!-- Section : Documents -->
        <div class="cons-section-pane${_activeSection === "documents" ? " active" : ""}" data-section="documents">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">📄</div>
            <div class="cons-placeholder-title">Documents</div>
            <div class="cons-placeholder-desc">Chargement…</div>
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
              <span class="cons-api-dot ${ctx.getBackendStatus().online ? "online" : "offline"}" id="cons-api-dot"></span>
            </div>
            <div class="cons-error" style="display:none"></div>
            <div class="cur-3col">

              <!-- Params (gauche) -->
              <div class="cur-params-col">
                <div class="cur-col-head">Paramètres curation</div>

                <div class="cur-param-section">
                  <div class="cur-param-label">Épisodes</div>
                  <div class="cur-ep-list" id="cur-ep-list">
                    <div style="padding:6px 0;font-size:0.78rem;color:var(--text-muted)">Chargement…</div>
                  </div>
                </div>

                <div class="cur-param-section">
                  <div class="cur-param-label">Profil normalisation</div>
                  <select class="acts-params-select" id="cur-profile" style="width:100%">
                    ${NORMALIZE_PROFILES.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("")}
                  </select>
                  <span class="acts-params-feedback" id="cur-profile-fb"></span>
                </div>

                <div class="cur-param-section">
                  <div class="cur-param-label">Portée</div>
                  <label class="acts-params-radio"><input type="radio" name="cur-scope" value="pending" checked> Non normalisés</label>
                  <label class="acts-params-radio"><input type="radio" name="cur-scope" value="all"> Tous</label>
                </div>

                <div class="cur-param-section">
                  <div class="cur-param-label">Règles actives</div>
                  <div class="cur-rule-chips" id="cur-rule-chips"></div>
                </div>

                <div class="cur-param-section">
                  <button class="btn btn-primary btn-sm" id="cons-batch-normalize" style="width:100%">⚡ Normaliser tout</button>
                  <button class="btn btn-ghost btn-sm" id="cons-refresh" style="width:100%;margin-top:4px">↺ Actualiser</button>
                </div>
              </div>

              <!-- Preview (centre) -->
              <div class="cur-preview-col">
                <div class="cur-preview-bar">
                  <button class="cur-preview-tab active" data-mode="side">Côte à côte</button>
                  <button class="cur-preview-tab" data-mode="raw">Brut seul</button>
                  <button class="cur-preview-tab" data-mode="clean">Normalisé seul</button>
                  <button class="cur-preview-tab" data-mode="diff">Diff</button>
                  <span class="cur-preview-badge" id="cur-preview-badge"></span>
                </div>
                <div class="cur-preview-panes" id="cur-preview-panes">
                  <div class="acts-text-empty" style="width:100%">← Sélectionnez un épisode</div>
                </div>
              </div>

              <!-- Diagnostics (droite) -->
              <div class="cur-diag-col">
                <div class="cur-col-head">Diagnostics</div>
                <div class="cur-diag-scroll">
                  <div class="cur-diag-section" id="cur-diag-ep">
                    <div class="cur-diag-title">Épisode</div>
                    <div style="font-size:0.77rem;color:var(--text-muted);font-style:italic">Aucun sélectionné</div>
                  </div>
                  <div class="cur-diag-section">
                    <div class="cur-diag-title">File de jobs</div>
                    <div style="padding:2px 0">
                      <button class="btn btn-ghost btn-sm" id="cons-refresh-jobs" style="width:100%">↺ Rafraîchir</button>
                    </div>
                  </div>
                  <div class="cur-diag-jobs">
                    <div class="cons-jobs" id="cur-jobs-inline">
                      <div class="cons-jobs-list"></div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Segmentation sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "segmentation" ? " active" : ""}" data-subview="segmentation">
            <div class="cons-toolbar">
              <button class="acts-back-btn" id="cons-back-segmentation">← Actions</button>
              <span class="cons-toolbar-title">Segmentation</span>
              <button class="btn btn-secondary btn-sm" id="cons-batch-segment">🔤 Segmenter tout</button>
              <button class="btn btn-ghost btn-sm" id="cons-refresh-seg">↺ Actualiser</button>
            </div>
            <!-- Params panel -->
            <div class="acts-params">
              <div class="acts-params-group">
                <span class="acts-params-label">Portée</span>
                <label class="acts-params-radio"><input type="radio" name="seg-scope" value="normalized" checked> Normalisés seulement</label>
                <label class="acts-params-radio"><input type="radio" name="seg-scope" value="all"> Tous</label>
              </div>
              <div class="acts-params-sep"></div>
              <div class="acts-params-group">
                <span class="acts-params-label">Type</span>
                <select class="acts-params-select" id="seg-kind">
                  <option value="utterance">Utterance (locuteur)</option>
                  <option value="sentence">Phrase</option>
                </select>
              </div>
            </div>
            <!-- Vue toggle Table / Texte -->
            <div style="display:flex;align-items:center;gap:8px;padding:4px 12px;background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0">
              <span style="font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">Vue</span>
              <div class="seg-mode-toggle">
                <button class="seg-mode-btn active" data-seg-mode="table" id="seg-mode-table">Table</button>
                <button class="seg-mode-btn" data-seg-mode="longtext" id="seg-mode-lt">Texte</button>
              </div>
            </div>
            <div class="cons-error seg-error" style="display:none"></div>
            <!-- Vue Table -->
            <div id="seg-view-table" class="acts-split" style="flex:1;min-height:0;overflow:hidden">
              <div class="acts-ep-list">
                <div class="seg-table-wrap cons-loading">Chargement…</div>
              </div>
              <div class="acts-text-panel" id="seg-text-panel">
                <div class="acts-text-empty">← Sélectionnez un épisode</div>
              </div>
            </div>
            <!-- Vue Longtext (lazy) -->
            <div id="seg-view-lt" style="display:none;flex:1;min-height:0;flex-direction:column;overflow:hidden"></div>
          </div>

          <!-- Alignement sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "alignement" ? " active" : ""}" data-subview="alignement">
            <div class="cons-toolbar">
              <button class="acts-back-btn" id="cons-back-alignement">← Actions</button>
              <span class="cons-toolbar-title">Alignement</span>
              <button class="btn btn-secondary btn-sm" id="cons-batch-align">⚡ Aligner tout</button>
              <button class="btn btn-ghost btn-sm" id="cons-refresh-align">↺ Actualiser</button>
            </div>
            <!-- Params panel -->
            <div class="acts-params">
              <div class="acts-params-group">
                <span class="acts-params-label">Segments</span>
                <select class="acts-params-select" id="align-segment-kind-pre">
                  <option value="utterance">Utterance (locuteur)</option>
                  <option value="sentence">Phrase</option>
                </select>
              </div>
              <div class="acts-params-sep"></div>
              <div class="acts-params-group" style="font-size:0.76rem;color:var(--text-muted)">
                Sélectionnez un épisode segmenté + SRT pour lancer l'alignement.
              </div>
            </div>
            <div class="acts-split">
              <div class="acts-ep-list">
                <div class="align-ep-wrap cons-loading">Chargement…</div>
              </div>
              <div class="acts-text-panel" id="align-text-panel">
                <div class="acts-text-empty">← Sélectionnez un épisode</div>
              </div>
            </div>
          </div>

        </div><!-- /section actions -->

        <!-- Section : Personnages -->
        <div class="cons-section-pane${_activeSection === "personnages" ? " active" : ""}" data-section="personnages">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">🎭</div>
            <div class="cons-placeholder-title">Personnages</div>
            <div class="cons-placeholder-desc">Chargement…</div>
          </div>
        </div>

        <!-- Section : Exporter -->
        <div class="cons-section-pane${_activeSection === "exporter" ? " active" : ""}" data-section="exporter">
          <div class="cons-placeholder">
            <div class="cons-placeholder-icon">📤</div>
            <div class="cons-placeholder-title">Exporter</div>
            <div class="cons-placeholder-desc">Chargement…</div>
          </div>
        </div>

      </div><!-- /cons-main -->
    </div><!-- /cons-shell -->
    </div><!-- /cons-root -->`;

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
    // Lazy-load episode data for dynamic sub-views
    if (subview === "segmentation") {
      const wrap = container.querySelector(".seg-table-wrap");
      if (wrap?.classList.contains("cons-loading")) loadAndRenderSegmentation(container);
    }
    if (subview === "alignement") {
      const wrap = container.querySelector(".align-ep-wrap");
      if (wrap?.classList.contains("cons-loading")) loadAndRenderAlignement(container);
    }
    // Init Curation params panel on first show
    if (subview === "curation") initCurationParams(container);
  }

  // ── Curation params : profil de normalisation ─────────────────────────────
  async function initCurationParams(cnt: HTMLElement) {
    const sel = cnt.querySelector<HTMLSelectElement>("#cur-profile");
    if (!sel || sel.dataset.wired) return;
    sel.dataset.wired = "1";
    // Populate from cached config (or fetch if missing)
    if (!_cachedConfig) {
      try { _cachedConfig = await fetchConfig(); } catch { return; }
    }
    sel.value = _cachedConfig.normalize_profile;
    renderCurationRuleChips(cnt, sel.value);
    sel.addEventListener("change", async () => {
      const fb = cnt.querySelector<HTMLElement>("#cur-profile-fb")!;
      fb.textContent = "Enregistrement…";
      fb.style.color = "var(--text-muted)";
      try {
        _cachedConfig = await saveConfig({ normalize_profile: sel.value });
        renderCurationRuleChips(cnt, sel.value);
        fb.textContent = "✓";
        fb.style.color = "var(--success, #16a34a)";
        setTimeout(() => { fb.textContent = ""; }, 1500);
      } catch (e) {
        fb.textContent = e instanceof ApiError ? e.message : "Erreur";
        fb.style.color = "var(--danger, #dc2626)";
      }
    });

    // Wire preview mode tabs
    cnt.querySelectorAll<HTMLButtonElement>(".cur-preview-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        cnt.querySelectorAll(".cur-preview-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        if (_curPreviewData && _curPreviewEpId) {
          const activeItem = cnt.querySelector<HTMLElement>(".cur-ep-item.active");
          const epTitle = activeItem?.dataset.epTitle ?? _curPreviewEpId;
          renderCurationPreviewMode(
            cnt.querySelector<HTMLElement>("#cur-preview-panes")!,
            _curPreviewData,
            tab.dataset.mode!,
            epTitle,
          );
        }
      });
    });
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

  // ── Presets modal ────────────────────────────────────────────────────────
  const presetsModal = container.querySelector<HTMLDialogElement>("#cons-presets-modal")!;
  const presetsBody  = container.querySelector<HTMLElement>("#cons-presets-body")!;
  container.querySelector<HTMLButtonElement>("#cons-presets-btn")?.addEventListener("click", () => {
    renderPresets(presetsBody);
    presetsModal.showModal();
  });
  container.querySelector<HTMLButtonElement>("#cons-presets-close")?.addEventListener("click", () => {
    presetsModal.close();
  });
  container.querySelector<HTMLButtonElement>("#cons-presets-new")?.addEventListener("click", () => {
    renderPresetsNewForm(presetsBody);
  });
  presetsModal.addEventListener("click", (e) => {
    if (e.target === presetsModal) presetsModal.close();
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

  // ── Segmentation pane wiring ───────────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#cons-batch-segment")
    ?.addEventListener("click", async () => {
      const episodes = _cachedEpisodes?.episodes ?? [];
      const scopeAll = (container.querySelector<HTMLInputElement>("input[name='seg-scope'][value='all']")?.checked) ?? false;
      const segKind  = (container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "utterance");
      const toSegment = episodes.filter((ep) => {
        const t = ep.sources.find((s) => s.source_key === "transcript");
        if (!t?.available) return false;
        return scopeAll ? (t.state !== "segmented") : (t.state === "normalized");
      });
      if (toSegment.length === 0) return;
      for (const ep of toSegment) {
        try { await createJob("segment_transcript", ep.episode_id, "transcript", { segment_kind: segKind }); } catch { /* skip */ }
      }
      startJobPoll(container);
      await loadAndRenderSegmentation(container);
    });

  container.querySelector<HTMLButtonElement>("#cons-refresh-seg")
    ?.addEventListener("click", () => loadAndRenderSegmentation(container));

  // ── Seg mode toggle (Table / Texte) ─────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#seg-mode-table")
    ?.addEventListener("click", () => {
      container.querySelector("#seg-mode-table")?.classList.add("active");
      container.querySelector("#seg-mode-lt")?.classList.remove("active");
      const tv = container.querySelector<HTMLElement>("#seg-view-table");
      const lv = container.querySelector<HTMLElement>("#seg-view-lt");
      if (tv) tv.style.display = "";
      if (lv) lv.style.display = "none";
    });

  container.querySelector<HTMLButtonElement>("#seg-mode-lt")
    ?.addEventListener("click", () => {
      container.querySelector("#seg-mode-lt")?.classList.add("active");
      container.querySelector("#seg-mode-table")?.classList.remove("active");
      const tv = container.querySelector<HTMLElement>("#seg-view-table");
      const lv = container.querySelector<HTMLElement>("#seg-view-lt");
      if (tv) tv.style.display = "none";
      if (lv) {
        lv.style.display = "flex";
        const activeRow = tv?.querySelector<HTMLTableRowElement>("tr.active-row");
        const epId    = activeRow?.dataset.epId ?? null;
        const epTitle = activeRow?.dataset.epTitle ?? epId ?? "";
        const kind    = (container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "utterance") as "utterance" | "sentence";
        loadLongtextView(lv, epId, epTitle, kind);
      }
    });

  // ── Alignement pane wiring ─────────────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#cons-refresh-align")
    ?.addEventListener("click", () => loadAndRenderAlignement(container));

  container.querySelector<HTMLButtonElement>("#cons-batch-align")
    ?.addEventListener("click", async () => {
      const episodes = _cachedEpisodes?.episodes ?? [];
      const segKind = (container.querySelector<HTMLSelectElement>("#align-segment-kind-pre")?.value ?? "utterance") as "utterance" | "sentence";
      const toAlign = episodes.filter((ep) => {
        const t = ep.sources.find((s) => s.source_key === "transcript");
        const srts = ep.sources.filter((s) => s.source_key.startsWith("srt_") && s.available);
        return t?.state === "segmented" && srts.length > 0;
      });
      if (toAlign.length === 0) return;
      const btn = container.querySelector<HTMLButtonElement>("#cons-batch-align")!;
      btn.disabled = true; btn.textContent = "…";
      for (const ep of toAlign) {
        const srts = ep.sources.filter((s) => s.source_key.startsWith("srt_") && s.available).map((s) => s.source_key);
        try {
          await createJob("align", ep.episode_id, "", {
            pivot_key: "transcript",
            target_keys: srts,
            mode: "transcript_first",
            segment_kind: segKind,
          });
        } catch { /* skip */ }
      }
      btn.disabled = false; btn.textContent = "⚡ Aligner tout";
      startJobPoll(container);
      await loadAndRenderAlignement(container);
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
      if (_activeSection === "exporter")    renderExporterSection(pane);
    }
    // Lazy-load active Actions sub-view
    if (_activeSection === "actions") {
      if (_activeActionsSubView === "segmentation") loadAndRenderSegmentation(container);
      if (_activeActionsSubView === "alignement")   loadAndRenderAlignement(container);
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
    const epListEl = container.querySelector<HTMLElement>("#cur-ep-list");
    if (epListEl) epListEl.innerHTML = `<div style="color:var(--danger);font-size:0.78rem">Backend HIMYC hors ligne.<br>Lancez : <code>uvicorn howimetyourcorpus.api.server:app --port 8765</code></div>`;
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
