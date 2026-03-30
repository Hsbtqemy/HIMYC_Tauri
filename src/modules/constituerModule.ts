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
  importTranscriptFile,
  importSrt,
  deleteTranscript,
  deleteSrt,
  patchTranscript,
  fetchNormalizePreview,
  setAlignLinkNote,
  fetchJobs,
  createJob,
  fetchJob,
  cancelJob,
  fetchCharacters,
  saveCharacters,
  importCharactersFromSegments,
  fetchAssignments,
  saveAssignments,
  autoAssignCharacters,
  discoverTvmaze,
  discoverSubslikescript,
  fetchSubslikescriptTranscript,
  fetchAlignmentRuns,
  fetchAllAlignmentRuns,
  fetchAlignRunStats,
  fetchAuditLinks,
  fetchAlignCollisions,
  setAlignLinkStatus,
  bulkSetAlignLinkStatus,
  fetchSubtitleCues,
  fetchAllSubtitleCues,
  patchSubtitleCue,
  retargetAlignLink,
  fetchConcordance,
  fetchEpisodeSegments,
  fetchSegmentPreview,
  fetchEpisodeSegmentationOptions,
  putEpisodeSegmentationOptions,
  patchSegment,
  propagateCharacters,
  type PropagateResult,
  fetchQaReport,
  runExport,
  saveConfig,
  type ExportResult,
  type QaReport,
  type AlignRunStats,
  type AuditLink,
  type AlignCollision,
  type SubtitleCue,
  type ConcordanceRow,
  type SegmentRow,
  type SegmentPreviewResponse,
  type UtteranceSegmentationOptions,
  type AutoAssignResult,
  type ConfigUpdate,
  type Episode,
  type EpisodeSource,
  type EpisodesResponse,
  type ConfigResponse,
  type TranscriptSourceContent,
  type SrtSourceContent,
  type JobRecord,
  type JobType,
  type Character,
  type CharacterAssignment,
  saveSeriesIndex,
  fetchSeriesIndex,
  type WebEpisodeRef,
  type AlignmentRun,
  type LinkPosition,
  fetchLinkPositions,
  ApiError,
  formatApiError,
  withNoDbRecovery,
} from "../api";
import {
  guardImportTranscript,
  guardImportSrt,
  guardBatchNormalize,
  guardSegmentTranscript,
  guardResegmentTranscript,
  guardedAction,
} from "../guards";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
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
  min-height: 0;
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

/* ── Documents : liste groupée par saison ─────────────────────────── */
.docs-season-group { margin-bottom: 2px; }
.docs-season-header {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 14px; cursor: pointer; user-select: none;
  background: var(--surface2); border-bottom: 1px solid var(--border);
  font-size: 0.78rem; font-weight: 600; color: var(--text-muted);
  position: sticky; top: 0; z-index: 2;
}
.docs-season-header:hover { background: var(--surface); color: var(--text); }
.docs-season-caret { font-size: 10px; transition: transform .15s ease; margin-right: 2px; }
.docs-season-group.collapsed .docs-season-caret { transform: rotate(-90deg); }
.docs-season-group.collapsed .docs-season-body { display: none; }
.docs-season-count {
  margin-left: auto; font-weight: 400; opacity: .65; font-size: 0.73rem;
}
.docs-ep-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px; border-bottom: 1px solid var(--border);
  cursor: pointer; transition: background .12s ease;
  font-size: 0.82rem;
}
.docs-ep-row:hover { background: var(--surface2); }
.docs-ep-row.active { background: #e8f0fe; }
.docs-ep-id {
  font-family: ui-monospace, monospace; font-size: 0.74rem;
  color: var(--text-muted); min-width: 52px; flex-shrink: 0;
}
.docs-ep-title {
  flex: 1; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.docs-ep-badges { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }
.docs-ep-arrow { color: var(--text-muted); font-size: 0.8rem; flex-shrink: 0; }

/* ── Documents : panneau latéral (style AGRAFES metaPanel) ─────────── */
.docs-panel-backdrop {
  position: absolute; inset: 0; background: rgba(0,0,0,.18); z-index: 50;
}
.docs-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 340px;
  background: var(--surface); border-left: 1px solid var(--border);
  box-shadow: -4px 0 16px rgba(0,0,0,.10);
  display: flex; flex-direction: column; z-index: 51;
  animation: docs-panel-in .18s ease;
}
@keyframes docs-panel-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
.docs-panel-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.docs-panel-ep-id {
  font-family: ui-monospace, monospace; font-size: 0.74rem;
  color: var(--text-muted);
}
.docs-panel-title { flex: 1; font-weight: 600; font-size: 0.88rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.docs-panel-close {
  background: none; border: none; cursor: pointer; color: var(--text-muted);
  font-size: 1rem; padding: 2px 6px; border-radius: 4px; line-height: 1;
}
.docs-panel-close:hover { background: var(--surface2); color: var(--text); }
.docs-panel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
.docs-panel-section-head {
  font-size: 0.7rem; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;
}
.docs-panel-field { display: flex; gap: 8px; align-items: baseline; font-size: 0.82rem; margin-bottom: 4px; }
.docs-panel-lbl { min-width: 68px; color: var(--text-muted); font-size: 0.75rem; flex-shrink: 0; }
.docs-panel-val { font-family: ui-monospace, monospace; font-size: 0.78rem; color: var(--text); }
.docs-edit-row { display: flex; gap: 6px; align-items: center; margin-top: 2px; }
.docs-edit-input {
  flex: 1; padding: 4px 8px; font-size: 0.82rem;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); color: var(--text);
}
.docs-edit-input:focus { outline: none; border-color: var(--brand); }
.docs-source-row {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 0; border-bottom: 1px solid var(--border);
}
.docs-source-row:last-child { border-bottom: none; }
.docs-source-key { font-family: ui-monospace, monospace; font-size: 0.76rem; font-weight: 600; color: var(--text); }
.docs-source-actions { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }

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

/* ── Actions hub (lot) ──────────────────────────────────────── */
.acts-hub { display:flex; flex-direction:column; gap:12px; padding:16px; overflow-y:auto; flex:1; min-height:0; }
.acts-hub-step { border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.acts-hub-step-title { font-size:0.82rem; font-weight:600; color:var(--text); padding:8px 12px 6px; border-bottom:1px solid var(--border); letter-spacing:.02em; text-transform:uppercase; }
.acts-hub-step-body { display:flex; flex-direction:column; gap:0; }
.acts-hub-status { font-size:0.75rem; color:var(--text-muted); padding:4px 12px 8px; min-height:1.4em; font-style:italic; }
.hub-step-stat { margin-left:auto; font-size:0.72rem; font-weight:400; color:var(--text-muted); letter-spacing:0; text-transform:none; float:right; }

/* Options avancées curation */
.cur-opt-row { display:flex; align-items:center; gap:5px; padding:2px 0; font-size:0.78rem; color:var(--text); user-select:none; cursor:default; }
.cur-opt-row input[type="checkbox"] { accent-color:var(--accent); flex-shrink:0; cursor:pointer; }

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
.cons-job-progress-wrap {
  flex: 1;
  max-width: 120px;
  height: 5px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
  flex-shrink: 0;
}
.cons-job-progress-bar {
  height: 100%;
  background: var(--brand, #0f766e);
  border-radius: 3px;
  transition: width 0.4s ease;
}
.cons-job-progress-label {
  font-family: ui-monospace, monospace;
  font-size: 0.68rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
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
.pers-list-scroll { flex: 1; min-height: 0; overflow-y: auto; }
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
.pers-detail-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
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
  min-height: 0;
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
/* Colonne liste épisodes : scroll interne, pas de marge fantôme (évite flex + overflow:hidden qui clippe) */
.acts-split > .acts-ep-list {
  min-height: 0;
  align-self: stretch;
}
.acts-ep-list {
  width: min(400px, 40vw);
  min-width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  padding: 0;
}
.acts-ep-list-title {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 4px 6px 3px;
  margin: 0;
  border-bottom: 1px solid var(--border);
  user-select: none;
}
/* Bouton de collapse du volet épisodes */
.acts-ep-collapse-btn {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 3px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.acts-ep-collapse-btn:hover { background: var(--surface2); color: var(--text); }
/* ── État réduit du volet ─────────────────────────────────────────────────── */
.acts-ep-list {
  transition: width 0.18s ease, min-width 0.18s ease;
}
.acts-ep-list--collapsed {
  width: 32px !important;
  min-width: 32px !important;
  overflow: hidden;
}
.acts-ep-list--collapsed .acts-ep-list-title {
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  padding: 6px 4px;
  border-bottom: none;
  gap: 10px;
  height: 100%;
}
/* Masquer le label "Épisodes" quand collapsed — le bouton suffit */
.acts-ep-list--collapsed .acts-ep-list-label { display: none; }
/* Masquer filtres et table quand collapsed */
.acts-ep-list--collapsed .acts-ep-filters,
.acts-ep-list--collapsed .seg-table-wrap,
.acts-ep-list--collapsed .align-ep-wrap { display: none; }
.seg-table-wrap,
.align-ep-wrap {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0;
  -webkit-overflow-scrolling: touch;
}
/* Chargement / erreur : pas le padding 3rem global de .cons-loading */
.acts-ep-list .seg-table-wrap.cons-loading,
.acts-ep-list .align-ep-wrap.cons-loading,
.acts-ep-list .seg-table-wrap > .cons-loading,
.acts-ep-list .align-ep-wrap > .cons-loading {
  padding: 10px 6px;
  box-sizing: border-box;
}
.seg-table-wrap > .cons-table,
.align-ep-wrap > .cons-table {
  margin-top: 0;
}
/* Table épisodes : tient dans la largeur colonne */
.acts-ep-list .cons-table {
  width: 100%;
  table-layout: fixed;
  margin: 0;
  font-size: 0.76rem;
}
.acts-ep-list .cons-table th,
.acts-ep-list .cons-table td {
  padding: 3px 4px;
  vertical-align: middle;
}
.acts-ep-list .cons-table th:first-child,
.acts-ep-list .cons-table td:first-child {
  padding-left: 6px;
}
.acts-ep-list .cons-table th:last-child,
.acts-ep-list .cons-table td:last-child {
  padding-right: 6px;
}
.acts-ep-list .cons-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}
.acts-ep-list .cons-table th {
  background: var(--surface2);
  box-shadow: 0 1px 0 var(--border);
  font-size: 0.68rem;
}
.acts-ep-cell-id {
  width: 22%;
  min-width: 0;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
}
.acts-ep-cell-title {
  width: 30%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
}
.acts-ep-cell-status {
  width: 30%;
  min-width: 0;
  font-size: 0.72rem;
  line-height: 1.25;
}
.acts-ep-lang-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}
.acts-ep-cell-action {
  width: 18%;
  min-width: 0;
  text-align: right;
  white-space: nowrap;
}
.acts-ep-cell-action .btn {
  padding: 2px 6px;
  font-size: 0.72rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.acts-text-panel {
  flex: 1;
  min-width: 0;
  /* Permet au panneau droit (aperçu segmentation, etc.) de rétrécir et défiler dans la chaîne flex */
  min-height: 0;
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
.acts-text-edit-btn {
  padding: 2px 8px;
  font-size: 0.72rem;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.acts-text-edit-btn:hover { background: var(--surface2); color: var(--text); }
.acts-text-edit-bar {
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.acts-text-editor {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.75;
  color: var(--text);
  background: var(--surface2, #f8f8f8);
  padding: 1rem 1.25rem;
  box-sizing: border-box;
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
  overflow-x: hidden;
  min-width: 0;
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
.cur-fr-input { width:100%;box-sizing:border-box;font-size:0.78rem;padding:4px 7px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);margin-bottom:4px; }
.cur-fr-input:focus { outline:none;border-color:var(--accent); }
.cur-fr-options { display:flex;align-items:center;gap:10px;font-size:0.76rem;color:var(--text-muted);margin-bottom:6px; }
.cur-fr-options label { display:flex;align-items:center;gap:3px;cursor:pointer; }
.cur-fr-count { font-size:0.72rem;min-height:1.2em;color:var(--text-muted);margin-bottom:4px; }
.cur-fr-actions { display:flex;flex-direction:column;gap:4px;margin-top:4px;min-width:0;width:100%; }
.cur-fr-actions .btn { width:100%;box-sizing:border-box;white-space:normal;text-align:center;line-height:1.25;padding:6px 8px; }
.cur-srt-cue-row { border-bottom:1px solid var(--border);padding:4px 0; }
.cur-srt-cue-row:last-child { border-bottom:none; }
.cur-srt-cue-meta { display:flex;align-items:center;gap:6px;padding:2px 10px;font-size:0.72rem; }
.cur-srt-cue-n { font-weight:600;color:var(--accent);min-width:2.5em; }
.cur-srt-cue-tc { color:var(--text-muted);font-variant-numeric:tabular-nums; }
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
  min-height: 0;
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
.cur-diag-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
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
.cur-diff-lineonly {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* Inline word-level diff tokens */
.cur-w-del { background:#fef2f2; color:#dc2626; text-decoration:line-through; border-radius:2px; padding:0 1px; }
.cur-w-ins { background:#f0fdf4; color:#16a34a; border-radius:2px; padding:0 1px; }

/* Surlignage recherche find/replace */
.cur-search-hl { background:#fef08a; color:#713f12; border-radius:2px; padding:0 1px; }

/* Marqueur de ligne vide dans le raw pane */
.cur-blank-line { color:var(--text-muted,#94a3b8); opacity:0.45; font-size:0.75em; user-select:none; }

/* ── Chips règles actives (C-4) ──────────────────────────────── */
.cur-rule-chip {
  padding: 2px 8px; border-radius: 20px; font-size: 0.68rem; font-weight: 600;
  cursor: pointer; border: 1px solid transparent; font-family: inherit;
  transition: background .12s, color .12s, opacity .12s;
}
.cur-rule-chip.on  { background:#dbeafe; color:#1d4ed8; border-color:#93c5fd; }
.cur-rule-chip.off { background:var(--surface2); color:var(--text-muted); border-color:var(--border); opacity:.65; }

/* ── Source selector bar (C-1) ───────────────────────────────── */
.cur-src-bar {
  display:flex; align-items:center; gap:4px; padding:4px 12px;
  border-bottom:1px solid var(--border); background:var(--surface2);
  flex-shrink:0; flex-wrap:wrap;
}
.cur-src-tab {
  padding:2px 9px; font-size:0.72rem; border:1px solid var(--border);
  border-radius:4px; background:transparent; color:var(--text-muted);
  cursor:pointer; font-family:inherit; transition:background .1s;
}
.cur-src-tab.active { background:var(--accent,#0f766e); color:#fff; border-color:var(--accent,#0f766e); }
.cur-src-tab:hover:not(.active) { background:var(--surface); color:var(--text); }

/* ── Edit mode bar (C-3) ────────────────────────────────────── */
.cur-edit-bar {
  display:flex; align-items:center; gap:6px; padding:4px 12px;
  border-bottom:1px solid var(--border); background:color-mix(in srgb,var(--accent) 6%,var(--surface));
  flex-shrink:0;
}
.cur-edit-status { flex:1; font-size:0.74rem; color:var(--text-muted); font-style:italic; }
.cur-pane-textarea {
  flex:1; resize:none; border:none; outline:none; padding:1rem 1.25rem;
  font-family:ui-monospace,monospace; font-size:0.74rem; line-height:1.8;
  background:var(--surface); color:var(--text); white-space:pre-wrap;
}
.cur-speaker-strip {
  display:flex; flex-wrap:wrap; gap:4px; padding:4px 10px;
  background:color-mix(in srgb,var(--surface2,#f3f4f6) 80%,transparent);
  border-bottom:1px solid var(--border); align-items:center; flex-shrink:0;
  font-size:0.7rem;
}
.cur-speaker-strip-label { color:var(--text-muted); margin-right:2px; white-space:nowrap; }
.cur-speaker-chip {
  padding:1px 9px; border-radius:12px; border:1px solid var(--border);
  background:var(--surface3,#e5e7eb); cursor:pointer; font-size:0.7rem;
  transition:background .12s, color .12s;
}
.cur-speaker-chip:hover { background:var(--accent,#3b82f6); color:#fff; border-color:transparent; }
/* Highlight speaker prefix in preview panes */
.cur-speaker-tag { color:var(--accent,#3b82f6); font-weight:600; }

/* ── A-1 : badges statut alignement par langue ─────────────── */
.align-lang-badge {
  display: inline-block; font-size: 0.68rem; font-weight: 600;
  padding: 1px 6px; border-radius: 10px; margin-right: 3px; white-space: nowrap;
}
.align-lang-badge.done    { background: color-mix(in srgb, var(--success,#16a34a) 15%, transparent); color: var(--success,#16a34a); border: 1px solid color-mix(in srgb, var(--success,#16a34a) 35%, transparent); }
.align-lang-badge.pending { background: color-mix(in srgb, var(--danger,#dc2626) 10%, transparent);  color: var(--danger-text,#991b1b); border: 1px solid color-mix(in srgb, var(--danger,#dc2626) 25%, transparent); }
.align-ep-blocked { font-size: 0.74rem; color: var(--text-muted); font-style: italic; }
/* Colonnes liste épisodes : voir .acts-ep-cell-* sous .acts-ep-list */

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
.audit-table { width: 100%; border-collapse: collapse; font-size: 0.76rem; table-layout: fixed; }
.audit-table thead { position: sticky; top: 0; background: var(--surface); z-index: 2; }
.audit-table th {
  padding: 5px 8px; border-bottom: 2px solid var(--border);
  text-align: left; font-size: 0.7rem; color: var(--text-muted);
  text-transform: uppercase; white-space: nowrap; overflow: hidden;
}
.audit-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audit-vs-spacer td { padding: 0; border: none; }
.audit-table tr:hover td { background: var(--surface2); }
.audit-table tr.accepted td { background: #f0fdf4; }
.audit-table tr.rejected td { background: #fef2f2; opacity: .7; }
.audit-table tr.ignored  td { background: #f1f5f9; opacity: .6; }
.audit-table tr.audit-focused td { outline: 2px solid var(--accent, #0f766e); outline-offset: -2px; }
.audit-status-badge {
  display: inline-flex; align-items: center;
  padding: 1px 6px; border-radius: 3px;
  font-size: 0.68rem; font-weight: 700;
  white-space: nowrap;
}
.audit-status-badge.auto     { background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border); }
.audit-status-badge.accepted { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
.audit-status-badge.rejected { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
.audit-status-badge.ignored  { background: #e2e8f0; color: #64748b; border: 1px solid #cbd5e1; }
.audit-action-btn {
  padding: 1px 6px; font-size: 0.7rem;
  border: 1px solid var(--border); border-radius: 3px;
  background: var(--surface); cursor: pointer; font-family: inherit;
  color: var(--text-muted); transition: background .1s;
}
.audit-action-btn:hover { background: var(--surface2); }
.audit-action-btn.accept { color: #15803d; border-color: #86efac; }
.audit-action-btn.reject { color: #b91c1c; border-color: #fca5a5; }
.audit-action-btn.ignore { color: #64748b; border-color: #94a3b8; }
.audit-action-btn.undo   { color: var(--text-muted); }
/* Barre d'actions bulk (MX-039) */
.audit-bulk-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.audit-bulk-bar-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-weight: 600;
  white-space: nowrap;
  margin-right: 2px;
}
.audit-bulk-sep {
  width: 1px; height: 14px;
  background: var(--border);
  flex-shrink: 0;
}
.audit-bulk-conf-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  color: var(--text-muted);
}
.audit-bulk-conf-wrap input[type="number"] {
  width: 44px; padding: 1px 4px;
  font-size: 0.7rem;
  border: 1px solid var(--border); border-radius: 3px;
  background: var(--surface2); color: var(--text);
  text-align: center;
}
.audit-conf-bar {
  display: inline-block; height: 5px; border-radius: 2px;
  background: linear-gradient(90deg, #0f766e, #5eead4);
  vertical-align: middle; margin-right: 4px;
}
.audit-note-input {
  width: 120px; font-size: 0.72rem;
  padding: 2px 4px; border-radius: 3px;
  border: 1px solid transparent; background: transparent;
  color: var(--text, #111);
  transition: border-color 0.15s, background 0.15s;
}
.audit-note-input:hover { border-color: var(--border, #d1d5db); background: var(--bg-alt, #f9fafb); }
.audit-note-input:focus { outline: none; border-color: var(--accent, #0f766e); background: var(--bg-alt, #f9fafb); }
/* ── Minimap (G-004 / MX-047) ────────────────────────────────────── */
.audit-links-layout { flex: 1; display: flex; flex-direction: row; min-height: 0; overflow: hidden; }
.audit-links-col { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.audit-minimap-wrap {
  width: 16px; flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
  position: relative;
  cursor: pointer;
  overflow: hidden;
}
.audit-minimap { width: 16px; display: block; }
/* ── Retarget modal (MX-040) ──────────────────────────────────────── */
.retarget-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.retarget-modal {
  background: var(--bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.22);
  width: 560px; max-width: 96vw;
  max-height: 80vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.retarget-modal-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.retarget-modal-title {
  font-size: 0.85rem; font-weight: 700; color: var(--text); flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.retarget-modal-close {
  background: none; border: none; cursor: pointer;
  font-size: 1rem; color: var(--text-muted); padding: 2px 6px;
}
.retarget-modal-close:hover { color: var(--text); }
.retarget-context {
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 0.75rem;
  background: #fffbeb;
  flex-shrink: 0;
}
.retarget-context-pivot {
  color: var(--text-muted); margin-bottom: 3px;
}
.retarget-context-current {
  color: #b45309; font-style: italic;
}
.retarget-search-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.retarget-search-bar input {
  flex: 1; padding: 4px 8px;
  font-size: 0.78rem;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--text);
}
.retarget-search-hint {
  font-size: 0.68rem; color: var(--text-muted); white-space: nowrap;
}
.retarget-results {
  overflow-y: auto; flex: 1;
  padding: 6px 0;
}
.retarget-cue-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 14px; cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background .1s;
}
.retarget-cue-row:hover { background: var(--surface2); }
.retarget-cue-row.selected { background: #dbeafe; }
.retarget-cue-n {
  font-size: 0.68rem; color: var(--text-muted);
  font-family: ui-monospace, monospace;
  flex-shrink: 0; padding-top: 2px;
  min-width: 28px; text-align: right;
}
.retarget-cue-time {
  font-size: 0.65rem; color: var(--text-muted);
  font-family: ui-monospace, monospace;
  flex-shrink: 0; padding-top: 3px;
}
.retarget-cue-text {
  flex: 1; font-size: 0.78rem; color: var(--text);
  line-height: 1.4;
}
.retarget-modal-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.retarget-empty {
  padding: 16px 14px; font-size: 0.78rem; color: var(--text-muted); text-align: center;
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
.audit-quality-seg.ignored  { background: #94a3b8; }
.audit-quality-label {
  font-size: 0.68rem; color: var(--text-muted); white-space: nowrap; flex-shrink: 0;
}
/* Collisions */
.audit-collision-list { overflow-y: auto; flex: 1; min-height: 0; padding: 0; display: flex; flex-direction: column; }
.audit-collision-actions {
  display: flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-bottom: 1px solid #fca5a5; background: #fff8f8; flex-shrink: 0; flex-wrap: wrap;
}
.audit-collision-scroll { overflow-y: auto; flex: 1; min-height: 0; padding: 10px 14px; display: flex; flex-direction: column; gap: 10px; }
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

/* ── S-1 : Table segments ───────────────────────────────────── */
.seg-table-info {
  font-size: 0.72rem; color: var(--text-muted); padding: 4px 2px;
  flex-shrink: 0;
}
.seg-segments-scroll {
  /* Contrainte de hauteur : la table des segments a son propre scroll
     pour ne pas forcer le scroll global sur une liste trop longue. */
  max-height: min(420px, 50vh);
  min-height: 60px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.seg-segments-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.seg-segments-table th { position: sticky; top: 0; background: var(--surface2); z-index: 1; }
.seg-cell-n     { width: 36px; text-align: right; color: var(--text-muted); padding: 3px 6px; font-family: ui-monospace,monospace; }
.seg-cell-speaker { width: 90px; padding: 3px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seg-cell-text    { padding: 3px 6px; line-height: 1.5; cursor: text; }
.seg-cell-text:hover, .seg-cell-speaker:hover { background: var(--surface2); }
.seg-cell-len   { width: 46px; text-align: right; padding: 3px 6px; font-family: ui-monospace,monospace; font-size: 0.72rem; }
/* S-3 : warning utterance */
.seg-warn-utterance {
  margin: 8px; padding: 8px 12px; border-radius: 6px; font-size: 0.78rem;
  background: color-mix(in srgb, var(--warning,#f59e0b) 12%, transparent);
  color: var(--warning-text, #92400e); border: 1px solid color-mix(in srgb, var(--warning,#f59e0b) 30%, transparent);
}

/* Distribution — utterance ↔ personnage */
#dist-panel-root {
  min-height: 0;
  /* Ne pas faire défiler tout le panneau : seul #dist-table-wrap doit scroller (évite double scroll + bugs) */
  overflow: hidden !important;
  overscroll-behavior: none;
  width: 100%;
  max-width: none;
}
.dist-body-split {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 12px 18px;
}
.dist-main-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dist-sidebar {
  flex: 0 0 clamp(196px, 22vw, 288px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-left: 12px;
  border-left: 1px solid var(--border);
  box-sizing: border-box;
}
.dist-sidebar:has(#dist-ep-chars[hidden]) {
  flex-basis: 0;
  flex-grow: 0;
  width: 0;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: none;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.dist-sidebar-head {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 8px;
  flex-shrink: 0;
  line-height: 1.3;
}
@media (max-width: 880px) {
  .dist-body-split {
    flex-direction: column;
  }
  .dist-sidebar {
    flex: 0 0 auto !important;
    width: 100% !important;
    max-width: none;
    border-left: none;
    border-top: 1px solid var(--border);
    padding: 12px 0 0;
    opacity: 1 !important;
    pointer-events: auto !important;
  }
  .dist-sidebar:has(#dist-ep-chars[hidden]) {
    display: none;
  }
}
/* Flex + scroll : wrap ne scrolle pas — c'est #dist-table-inner (sinon acts-text-empty centre le tableau → impossibilité de remonter au début). */
#dist-table-wrap {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}
#dist-table-inner {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
/* Tableau : pas de flex/center du parent (.acts-text-empty) */
#dist-table-inner:not(.acts-text-empty) {
  display: block;
  padding: 0 !important;
}
.dist-toolbar-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  margin-bottom: 10px;
}
.dist-toolbar-row label { font-size: 0.76rem; color: var(--text-muted); }
.dist-filter-input {
  flex: 1; min-width: 140px; max-width: 320px;
  padding: 4px 8px; font-size: 0.78rem;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--text); font-family: inherit;
}
/* separate + spacing 0 : pas de sticky sur thead — sur WKWebView (Tauri), sticky + thead dans overflow:auto
   peut fixer un scrollTop minimal > 0 et empêcher de remonter au début du tableau (lignes « bloquées »). */
.dist-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.76rem;
}
.dist-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-muted);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface2);
}
.dist-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
  background: var(--surface);
}
.dist-table tbody tr:hover td { background: color-mix(in srgb, var(--surface2) 70%, transparent); }
.dist-td-n { width: 36px; text-align: right; font-family: ui-monospace, monospace; color: var(--text-muted); }
.dist-td-sp { width: 100px; max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.72rem; }
.dist-td-tx { line-height: 1.45; word-break: break-word; }
.dist-char-select { max-width: 200px; font-size: 0.75rem; }
.dist-sp-input {
  width: 100%; max-width: 140px; box-sizing: border-box;
  padding: 3px 6px; font-size: 0.72rem; font-family: inherit;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--surface); color: var(--text);
}
.dist-sp-input.dist-sp-saved { border-color: var(--success, #16a34a); }
.dist-sp-input.dist-sp-err { border-color: var(--danger, #dc2626); }

/* ── Distribution : résumé personnages de l'épisode (source courante) — colonne droite ── */
.dist-ep-chars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  font-size: 0.76rem;
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface2) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  min-height: 0;
}
.dist-ep-chars.dist-ep-chars-sidebar {
  margin-bottom: 0;
  flex: 1;
  min-height: 120px;
  overflow-x: hidden;
  overflow-y: auto;
  flex-direction: column;
  align-items: stretch;
  align-content: flex-start;
}
.dist-ep-chars-sidebar .dist-ep-char-chip {
  align-self: flex-start;
}
.dist-ep-chars[hidden] { display: none !important; }
.dist-ep-chars-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  width: 100%;
  margin-bottom: 2px;
}
.dist-ep-chars-empty {
  font-size: 0.74rem;
  color: var(--text-muted);
  font-style: italic;
  line-height: 1.4;
}
.dist-ep-char-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #0f766e) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent, #0f766e) 22%, transparent);
  color: var(--text);
  font-weight: 600;
  font-size: 0.74rem;
  max-width: 100%;
}
.dist-ep-char-n {
  font-size: 0.68rem;
  font-weight: 700;
  font-family: ui-monospace, monospace;
  color: var(--text-muted);
  opacity: 0.9;
}

/* ── Mode traduction (MX-036) ────────────────────────────────── */
.seg-trad-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: var(--surface);
  border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap;
}
.seg-trad-label { font-size: 0.72rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.seg-trad-columns { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.seg-trad-col { display: flex; flex-direction: column; flex: 1; min-width: 0; overflow: hidden; border-right: 1px solid var(--border); }
.seg-trad-col:last-child { border-right: none; }
.seg-trad-col-header {
  font-size: 0.7rem; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .05em;
  padding: 5px 12px; background: var(--surface2);
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.seg-trad-content { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 2px; }
.seg-trad-row {
  font-size: 0.79rem; line-height: 1.5; padding: 4px 6px;
  border-radius: 3px; border-left: 2px solid transparent;
}
.seg-trad-row:hover { background: var(--surface2); border-left-color: var(--accent); }
.seg-trad-n { font-size: 0.65rem; color: var(--text-muted); font-family: ui-monospace, monospace; margin-right: 5px; }
.seg-trad-speaker { font-size: 0.65rem; font-weight: 700; color: var(--accent); display: block; margin-bottom: 1px; }
.seg-trad-time { font-size: 0.62rem; color: var(--text-muted); font-family: ui-monospace, monospace; display: block; margin-bottom: 1px; }
.seg-trad-empty { padding: 24px 12px; text-align: center; font-size: 0.78rem; color: var(--text-muted); line-height: 1.5; }

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
/* Segmentation / Alignement : moins de marge latérale au-dessus de la liste épisodes */
.cons-actions-pane[data-subview="segmentation"] .acts-params,
.cons-actions-pane[data-subview="alignement"] .acts-params {
  padding: 6px 8px;
  gap: 12px;
}
/* Aide segmentation (pédagogie + attentes format) */
.seg-help-panel {
  margin: 0 8px 8px;
  padding: 0 8px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--text);
}
.seg-help-panel > summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text-muted);
  list-style: none;
  padding: 6px 0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.seg-help-panel > summary::-webkit-details-marker { display: none; }
.seg-help-panel > summary::before { content: "▸ "; color: var(--accent); }
.seg-help-panel[open] > summary::before { content: "▾ "; }
.seg-help-body { padding: 0 0 4px 2px; color: var(--text); }
.seg-help-body p { margin: 0 0 8px; }
.seg-help-body ul { margin: 4px 0 8px 1.1rem; padding: 0; }
.seg-help-body li { margin: 4px 0; }
.seg-help-body code {
  font-size: 0.74rem;
  background: color-mix(in srgb, var(--surface2) 80%, transparent);
  padding: 1px 4px;
  border-radius: 3px;
}
.seg-help-muted { font-size: 0.72rem; color: var(--text-muted); font-style: italic; }

.seg-right-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  box-sizing: border-box;
  /* Conteneur maître : défile si le contenu dépasse la hauteur du panneau. */
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
.seg-preview-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  font-size: 0.76rem; color: var(--text-muted);
}
.seg-preview-banner strong { color: var(--text); }
.seg-utt-opts { margin-bottom: 8px; flex-shrink: 0; }
.seg-utt-opts summary { font-size: 0.72rem; font-weight: 600; cursor: pointer; padding: 4px 0; }
.seg-utt-opts-body { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.seg-utt-opts .seg-label { display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; color: var(--text-muted); }
.seg-utt-opts .seg-check { font-size: 0.72rem; color: var(--text); display: flex; align-items: center; gap: 6px; }
.seg-opt-input { width: 100%; font-size: 0.74rem; font-family: ui-monospace, monospace; padding: 4px 8px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); }
.seg-utt-opts-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.seg-utt-opts-hint { font-size: 0.68rem; color: var(--text-muted); margin: 0; line-height: 1.4; }
.seg-clean-textarea {
  width: 100%; min-height: 120px; max-height: 220px; resize: vertical; box-sizing: border-box;
  font-size: 0.78rem; font-family: ui-monospace, monospace; line-height: 1.45;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface2); color: var(--text);
}
.seg-preview-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.seg-preview-stats { font-size: 0.72rem; color: var(--text-muted); }
.seg-preview-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  /* flex: 1 inutile dans un contexte overflow-y: auto — laisser la hauteur naturelle */
}
@media (max-width: 900px) {
  .seg-preview-split { grid-template-columns: 1fr; }
}
.seg-preview-col-title {
  font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-muted); margin-bottom: 4px;
}
.seg-preview-list {
  max-height: 200px; overflow: auto; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); padding: 4px 6px; font-size: 0.76rem; line-height: 1.45;
}
.seg-prev-row { padding: 4px 2px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
.seg-prev-row:last-child { border-bottom: none; }
.seg-prev-spk { display: block; font-size: 0.65rem; font-weight: 700; color: var(--accent); margin-bottom: 2px; }
.seg-prev-tx { word-break: break-word; }
.seg-prev-empty { font-size: 0.74rem; color: var(--text-muted); padding: 8px; text-align: center; }
.seg-verify-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  /* pas de flex: 1 — dans overflow-y: auto, flex-grow peut donner 0px si le reste dépasse */
}
.seg-verify-head {
  font-size: 0.72rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.04em;
  margin-bottom: 6px;
  flex-shrink: 0;
}
.seg-segments-slot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}
.seg-segments-slot > .seg-warn-utterance,
.seg-segments-slot > .seg-table-info {
  flex-shrink: 0;
}
.seg-pending-msg {
  font-size: 0.74rem; color: var(--text-muted); padding: 8px 0; line-height: 1.45;
  flex-shrink: 0;
}
.seg-run-actions {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  padding: 8px 0 4px; border-top: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  margin-top: 8px;
}
.seg-run-actions-note { font-size: 0.72rem; color: var(--text-muted); max-width: 28rem; line-height: 1.4; }
.seg-toolbar-hint {
  font-size: 0.72rem; color: var(--text-muted); padding: 4px 8px 8px 16px; line-height: 1.4; border-bottom: 1px solid var(--border);
}

.cons-actions-pane[data-subview="segmentation"] .cons-toolbar,
.cons-actions-pane[data-subview="alignement"] .cons-toolbar {
  padding: 8px 10px;
}
.cons-actions-pane[data-subview="segmentation"] .cons-error.seg-error {
  margin: 6px 8px;
}
/* Filtres liste épisodes (segmentation / alignement) */
.acts-ep-filters {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.acts-ep-filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.acts-ep-filter-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.acts-ep-filter-select {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  padding: 3px 22px 3px 6px;
  font-size: 0.74rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface2);
  color: var(--text);
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
}
.acts-ep-filter-select:focus { outline: none; border-color: var(--accent, #0f766e); }
.acts-ep-filter-search {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  font-size: 0.76rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface2);
  color: var(--text);
  font-family: inherit;
}
.acts-ep-filter-search::placeholder { color: var(--text-muted); opacity: 0.85; }
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
.acts-params-range { width: 80px; accent-color: var(--accent); vertical-align: middle; }
.acts-params-range-val { font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--accent); font-weight: 700; min-width: 28px; }
.acts-params-check { display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 0.78rem; color: var(--text); }
.acts-params-check input[type=checkbox] { accent-color: var(--accent); cursor: pointer; width: 14px; height: 14px; }

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
.cfg-path-label { display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 4px; font-style: normal; }
.cfg-index-summary {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.4;
  padding: 8px 10px;
  background: var(--surface-elevated, rgba(0,0,0,0.035));
  border-radius: 6px;
  border: 1px solid var(--border);
  margin-bottom: 2px;
}
.cfg-index-summary strong { color: var(--text); font-weight: 600; }
.cfg-index-muted { font-style: italic; }
.cfg-hint { font-size: 0.72rem; color: var(--text-muted); line-height: 1.35; margin-top: 3px; width: 100%; }
.cfg-muted-inline { font-size: 0.78rem; color: var(--text-muted); }

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
let _constituerMountId = 0; // incrémenté au dispose pour invalider les callbacks async en vol
let _jobsExpanded = true;
let _activeSection = "actions";
let _activeActionsSubView: "hub" | "curation" | "distribution" | "segmentation" | "alignement" = "hub";
let _navCollapsed = false;
let _page = 0;
/** Données épisodes en cache pour Documents (rechargées à chaque mount section) */
let _cachedEpisodes: EpisodesResponse | null = null;
/** Config projet en cache */
let _cachedConfig: ConfigResponse | null = null;
/** Référence ShellContext (nécessaire pour navigateTo depuis Documents) */
let _ctx: ShellContext | null = null;
/** Épisode actuellement ouvert dans le panneau Documents */
let _docsPanelEpId: string | null = null;
/** Filtre saison actif dans Documents (null = toutes) */
let _docsSeasonFilter: number | null = null;
/** Listes épisodes complètes pour filtres saison / recherche (Segmentation & Alignement) */
let _segEpisodesAll: Episode[] = [];
/** Debounce aperçu segmentation (textarea clean) */
let _segSegPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let _alignEpisodesAll: Episode[] = [];
let _alignRunsLangMap: Map<string, Set<string>> = new Map();

const DIST_EP_LS_KEY        = "himyc_dist_ep";
const DIST_SOURCE_LS_KEY    = "himyc_dist_source";
const DIST_CUE_LANG_LS_KEY  = "himyc_dist_cue_lang";
const ACTIVE_SECTION_LS_KEY = "cons-active-section";
const ACTIVE_SUBVIEW_LS_KEY = "cons-active-subview";
const NAV_COLLAPSED_LS_KEY  = "cons-nav-collapsed";
const ACTIVE_PRESET_LS_KEY  = "himyc.active-preset";

let _projectPrefix = "";
/** Préfixe toutes les clés localStorage avec l'identifiant du projet courant. */
function lsKey(k: string): string {
  return _projectPrefix ? `${_projectPrefix}:${k}` : k;
}

type DistSourceKind = "utterance" | "sentence" | "cue";

function readDistSourceKind(): DistSourceKind {
  const v = localStorage.getItem(lsKey(DIST_SOURCE_LS_KEY));
  if (v === "sentence" || v === "cue" || v === "utterance") return v;
  return "utterance";
}

/** Source affichée (segments tours / phrases / cues SRT) — aligné PyQt */
let _distSourceKind: DistSourceKind = "utterance";
let _distCueLang = "en";

/** Segments chargés pour l’épisode courant (Distribution) — utterance ou sentence */
let _distLoadedSegments: SegmentRow[] = [];
/** Cues SRT chargées (mode cue) */
let _distLoadedCues: SubtitleCue[] = [];
let _distLoadedEpId: string | null = null;
/** Invalide le cache si la source ou la langue cue change */
let _distLoadedSourceKind: DistSourceKind | null = null;
let _distLoadedCueLangSnap: string | null = null;
/** Choix personnage par ligne (segment_id ou cue_id) */
let _distCharPick = new Map<string, string>();
let _distFilterTimer: ReturnType<typeof setTimeout> | null = null;
/** Listener `himyc:open-distribution` — retiré au dispose */
let _openDistributionNavListener: (() => void) | null = null;
let _unsub2: (() => void) | null = null;

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

function episodeHasSegmentedTranscript(ep: Episode): boolean {
  const t = sourceForKey(ep, "transcript");
  return !!(t?.available && (t.state === "segmented" || t.state === "ready_for_alignment"));
}

/** Au moins un fichier transcript importé (étapes amont possibles). */
function episodeHasTranscript(ep: Episode): boolean {
  return !!sourceForKey(ep, "transcript")?.available;
}

function transcriptStageLabel(ep: Episode): string {
  const t = sourceForKey(ep, "transcript");
  if (!t?.available) return "";
  const st = t.state ?? "unknown";
  if (st === "segmented" || st === "ready_for_alignment") return "segmenté";
  if (st === "normalized") return "normalisé";
  if (st === "raw") return "brut";
  return st;
}

/** Langues SRT importées pour un épisode. */
function episodeSrtLangs(ep: Episode): string[] {
  const langs: string[] = [];
  for (const s of ep.sources) {
    if (s.source_key.startsWith("srt_") && s.available) langs.push(s.source_key.slice(4));
  }
  return [...new Set(langs)].sort();
}

function episodeHasSrtLang(ep: Episode, lang: string): boolean {
  return !!sourceForKey(ep, `srt_${lang}`)?.available;
}

function distSegmentMarker(kind: "utterance" | "sentence"): string {
  return kind === "utterance" ? ":utterance:" : ":sentence:";
}

/** Personnages distincts du catalogue assignés à au moins une ligne (courant : _distCharPick), avec nombre de lignes. */
function distEpisodeCharacterCounts(): Array<{ id: string; name: string; count: number }> {
  const byId = new Map(_characters.map((c) => [c.id, c] as const));
  const countMap = new Map<string, number>();
  if (_distSourceKind === "cue") {
    for (const c of _distLoadedCues) {
      const cid = _distCharPick.get(c.cue_id)?.trim();
      if (!cid) continue;
      countMap.set(cid, (countMap.get(cid) ?? 0) + 1);
    }
  } else {
    for (const s of _distLoadedSegments) {
      const cid = _distCharPick.get(s.segment_id)?.trim();
      if (!cid) continue;
      countMap.set(cid, (countMap.get(cid) ?? 0) + 1);
    }
  }
  return [...countMap.entries()]
    .map(([id, count]) => ({ id, name: byId.get(id)?.canonical ?? id, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function clearDistributionEpisodeCharsSummary(cnt: HTMLElement): void {
  const el = cnt.querySelector<HTMLElement>("#dist-ep-chars");
  if (!el) return;
  el.innerHTML = "";
  el.hidden = true;
}

function updateDistributionEpisodeCharsSummary(cnt: HTMLElement): void {
  const el = cnt.querySelector<HTMLElement>("#dist-ep-chars");
  if (!el) return;
  const epId = cnt.querySelector<HTMLSelectElement>("#dist-ep-select")?.value?.trim() ?? "";
  if (!epId || _distLoadedEpId !== epId || _characters.length === 0) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  const nRows = _distSourceKind === "cue" ? _distLoadedCues.length : _distLoadedSegments.length;
  if (nRows === 0) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  const items = distEpisodeCharacterCounts();
  if (items.length === 0) {
    el.innerHTML = `<span class="dist-ep-chars-empty">Aucun personnage assigné (source courante). Les sélections dans le tableau apparaissent ici ; <strong>Enregistrer</strong> pour persister.</span>`;
    el.hidden = false;
    return;
  }
  const chips = items
    .map(
      (x) =>
        `<span class="dist-ep-char-chip" title="${escapeHtml(x.id)}">${escapeHtml(x.name)} <span class="dist-ep-char-n">${x.count}</span></span>`,
    )
    .join("");
  el.innerHTML = chips;
  el.hidden = false;
}

/** Réinitialise la carte des choix depuis les assignations courantes pour l’épisode et la source. */
function distHydrateCharPick(epId: string, kind: DistSourceKind): void {
  _distCharPick.clear();
  for (const a of _assignments) {
    if (a.episode_id !== epId || !a.character_id) continue;
    if (kind === "cue") {
      if (a.cue_id) _distCharPick.set(a.cue_id, a.character_id);
      continue;
    }
    const sid = a.segment_id ?? "";
    if (!sid.includes(distSegmentMarker(kind))) continue;
    _distCharPick.set(sid, a.character_id);
  }
}

/** Garde les assignations qui ne sont pas recouvertes par l’enregistrement courant. */
function distKeepOtherAssignments(
  epId: string,
  kind: DistSourceKind,
  loadedSegmentIds: Set<string>,
  loadedCueIds: Set<string>,
): CharacterAssignment[] {
  return _assignments.filter((a) => {
    if (a.episode_id !== epId) return true;
    if (kind === "cue") {
      if (!a.cue_id) return true;
      return !loadedCueIds.has(a.cue_id);
    }
    if (a.cue_id) return true;
    const sid = a.segment_id ?? "";
    if (!sid.includes(distSegmentMarker(kind))) return true;
    return !loadedSegmentIds.has(sid);
  });
}

/** Comme PyQt : préremplit les combos quand le texte commence par un alias. */
function distApplySuggestByAlias(rows: { id: string; text: string }[]): number {
  if (_characters.length === 0) return 0;
  const charAliases: { id: string; aliases: string[] }[] = [];
  for (const ch of _characters) {
    const aliases = (ch.aliases ?? []).filter((x) => (x ?? "").trim());
    if (aliases.length === 0) continue;
    charAliases.push({
      id: ch.id,
      aliases: [...aliases].sort((a, b) => b.length - a.length),
    });
  }
  if (charAliases.length === 0) return 0;
  let filled = 0;
  for (const row of rows) {
    const text = (row.text || "").trim();
    if (!text) continue;
    const textLower = text.toLowerCase();
    outer: for (const { id, aliases } of charAliases) {
      for (const alias of aliases) {
        const al = alias.toLowerCase();
        if (
          textLower.startsWith(al) ||
          textLower.startsWith(`${al}:`) ||
          textLower.startsWith(`${al} `)
        ) {
          _distCharPick.set(row.id, id);
          filled++;
          break outer;
        }
      }
    }
  }
  return filled;
}

function syncDistributionSourceControls(cnt: HTMLElement): void {
  const srcSel = cnt.querySelector<HTMLSelectElement>("#dist-source-kind");
  const langWrap = cnt.querySelector<HTMLElement>("#dist-cue-lang-wrap");
  const langSel = cnt.querySelector<HTMLSelectElement>("#dist-cue-lang");
  const filt = cnt.querySelector<HTMLInputElement>("#dist-filter");
  if (srcSel) srcSel.value = _distSourceKind;
  if (langWrap) langWrap.style.display = _distSourceKind === "cue" ? "flex" : "none";
  if (filt) {
    filt.placeholder =
      _distSourceKind === "cue" ? "Filtrer le texte des cues…" : "Filtrer texte ou locuteur…";
  }
  const epSel = cnt.querySelector<HTMLSelectElement>("#dist-ep-select");
  const epId = epSel?.value ?? "";
  if (!langSel || !epId || !_cachedEpisodes) return;
  const ep = _cachedEpisodes.episodes.find((e) => e.episode_id === epId);
  if (!ep) return;
  const langs = episodeSrtLangs(ep);
  langSel.innerHTML =
    langs.length > 0
      ? langs.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("")
      : `<option value="">— Aucun SRT —</option>`;
  if (langs.includes(_distCueLang)) langSel.value = _distCueLang;
  else if (langs.length) {
    _distCueLang = langs[0];
    langSel.value = _distCueLang;
    localStorage.setItem(lsKey(DIST_CUE_LANG_LS_KEY), _distCueLang);
  }
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

      // Barre de progression pour les jobs align en cours (G-007 / MX-048)
      let progressHtml = "";
      if (j.status === "running" && j.job_type === "align") {
        const prog = j.result._progress as { progress_pct?: number; segments_done?: number; segments_total?: number } | undefined;
        if (prog && prog.progress_pct != null) {
          const pct  = Math.min(100, Math.max(0, prog.progress_pct));
          const info = prog.segments_total
            ? `${prog.segments_done ?? 0} / ${prog.segments_total} seg.`
            : `${pct}%`;
          progressHtml = `
            <div class="cons-job-progress-wrap" title="${info}">
              <div class="cons-job-progress-bar" style="width:${pct}%"></div>
            </div>
            <span class="cons-job-progress-label">${escapeHtml(info)}</span>`;
        } else {
          progressHtml = `<span class="cons-job-progress-label" style="font-style:italic;color:var(--text-muted)">En cours…</span>`;
        }
      }

      return `
        <div class="cons-job-row">
          <span class="cons-job-status ${escapeHtml(j.status)}"></span>
          <span class="cons-job-label">${label}</span>
          <span class="cons-job-ep">${ep}${sk}</span>
          ${progressHtml}
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

/** Câblage unique des contrôles Distribution (épisode, filtre, enregistrer, locuteur). */
function wireDistributionPanel(cnt: HTMLElement): void {
  const root = cnt.querySelector<HTMLElement>("#dist-panel-root");
  if (!root || root.dataset.wired === "1") return;
  root.dataset.wired = "1";
  cnt.querySelector<HTMLSelectElement>("#dist-ep-select")?.addEventListener("change", () => {
    const v = cnt.querySelector<HTMLSelectElement>("#dist-ep-select")?.value ?? "";
    if (v) localStorage.setItem(lsKey(DIST_EP_LS_KEY), v);
    _distLoadedEpId = null;
    _distLoadedSegments = [];
    _distLoadedCues = [];
    _distLoadedSourceKind = null;
    syncDistributionSourceControls(cnt);
    void renderDistributionTable(cnt);
  });
  cnt.querySelector<HTMLSelectElement>("#dist-source-kind")?.addEventListener("change", () => {
    const v = cnt.querySelector<HTMLSelectElement>("#dist-source-kind")?.value ?? "utterance";
    _distSourceKind = v === "sentence" || v === "cue" || v === "utterance" ? v : "utterance";
    localStorage.setItem(lsKey(DIST_SOURCE_LS_KEY), _distSourceKind);
    _distLoadedEpId = null;
    _distLoadedSegments = [];
    _distLoadedCues = [];
    _distLoadedSourceKind = null;
    syncDistributionSourceControls(cnt);
    void renderDistributionTable(cnt);
  });
  cnt.querySelector<HTMLSelectElement>("#dist-cue-lang")?.addEventListener("change", () => {
    const v = cnt.querySelector<HTMLSelectElement>("#dist-cue-lang")?.value?.trim() ?? "";
    if (v) {
      _distCueLang = v;
      localStorage.setItem(lsKey(DIST_CUE_LANG_LS_KEY), v);
    }
    _distLoadedEpId = null;
    _distLoadedCues = [];
    _distLoadedSourceKind = null;
    void renderDistributionTable(cnt);
  });
  cnt.querySelector<HTMLButtonElement>("#dist-suggest-alias")?.addEventListener("click", () => {
    const epId = cnt.querySelector<HTMLSelectElement>("#dist-ep-select")?.value ?? "";
    if (!epId) return;
    let rows: { id: string; text: string }[] = [];
    if (_distSourceKind === "cue") {
      rows = _distLoadedCues.map((c) => ({ id: c.cue_id, text: c.text_clean ?? "" }));
    } else {
      rows = _distLoadedSegments.map((s) => ({ id: s.segment_id, text: s.text ?? "" }));
    }
    const n = distApplySuggestByAlias(rows);
    const sum = cnt.querySelector<HTMLElement>("#dist-summary");
    if (sum) {
      sum.textContent =
        n > 0
          ? `Suggestion par alias : ${n} ligne(s) renseignée(s).`
          : "Aucune correspondance (vérifiez les alias dans Personnages).";
    }
    void renderDistributionTable(cnt);
  });
  cnt.querySelector<HTMLButtonElement>("#dist-save-btn")?.addEventListener("click", () => void saveDistributionAssignments(cnt));
  cnt.querySelector<HTMLInputElement>("#dist-filter")?.addEventListener("input", () => {
    if (_distFilterTimer) clearTimeout(_distFilterTimer);
    _distFilterTimer = setTimeout(() => {
      void renderDistributionTable(cnt);
    }, 180);
  });

  root.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("dist-char-select")) return;
    const id = (t as HTMLSelectElement).dataset.rowId?.trim();
    const v = (t as HTMLSelectElement).value.trim();
    if (!id) return;
    if (v) _distCharPick.set(id, v);
    else _distCharPick.delete(id);
    updateDistributionEpisodeCharsSummary(cnt);
  });

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.id === "dist-jump-curation") {
      cnt.querySelector<HTMLButtonElement>('.cons-nav-tree-link[data-subview="curation"]')?.click();
    }
    if (t.id === "dist-jump-seg") {
      cnt.querySelector<HTMLButtonElement>('.cons-nav-tree-link[data-subview="segmentation"]')?.click();
    }
  });

  root.addEventListener("focusout", (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("dist-sp-input")) return;
    const sid = t.dataset.segmentId;
    const epId = cnt.querySelector<HTMLSelectElement>("#dist-ep-select")?.value ?? "";
    if (!sid || !epId) return;
    const inp = t as HTMLInputElement;
    const raw = inp.value.trim();
    const seg = _distLoadedSegments.find((s) => s.segment_id === sid);
    const prev = (seg?.speaker_explicit ?? "").trim();
    if (raw === prev) return;
    inp.classList.remove("dist-sp-saved", "dist-sp-err");
    void (async () => {
      try {
        const updated = await patchSegment(epId, sid, { speaker_explicit: raw || null });
        if (seg) seg.speaker_explicit = updated.speaker_explicit;
        inp.classList.add("dist-sp-saved");
        setTimeout(() => inp.classList.remove("dist-sp-saved"), 900);
      } catch (err) {
        inp.classList.add("dist-sp-err");
        inp.value = prev;
        const errEl = cnt.querySelector<HTMLElement>("#dist-error");
        if (errEl) {
          errEl.style.display = "block";
          errEl.textContent = err instanceof ApiError ? `${err.errorCode} — ${err.message}` : formatApiError(err);
        }
        setTimeout(() => inp.classList.remove("dist-sp-err"), 1600);
      }
    })();
  });
}

/** Segments (tours/phrases) ou cues SRT + sélecteurs personnage — aligné PyQt. */
async function renderDistributionTable(cnt: HTMLElement): Promise<void> {
  const tableInner = cnt.querySelector<HTMLElement>("#dist-table-inner");
  const summary = cnt.querySelector<HTMLElement>("#dist-summary");
  const epSel = cnt.querySelector<HTMLSelectElement>("#dist-ep-select");
  if (!tableInner || !epSel) return;

  clearDistributionEpisodeCharsSummary(cnt);

  const setDistTableInner = (html: string) => {
    const wrap = cnt.querySelector<HTMLElement>("#dist-table-wrap");
    const isTable = html.trimStart().startsWith("<table");
    /* CRITIQUE : .acts-text-empty = flex + align-items:center + height:100% sur ce nœud
       centre verticalement un grand tableau → scroll « bloqué » au milieu (~ligne 200+). */
    if (isTable) {
      tableInner.classList.remove("acts-text-empty");
      tableInner.style.padding = "0";
    } else {
      tableInner.classList.add("acts-text-empty");
      tableInner.style.padding = "14px";
    }
    tableInner.innerHTML = html;
    const scrollEl = tableInner;
    scrollEl.scrollTop = 0;
    scrollEl.scrollLeft = 0;
    if (wrap) {
      wrap.scrollTop = 0;
      wrap.scrollLeft = 0;
    }
    requestAnimationFrame(() => {
      scrollEl.scrollTop = 0;
      requestAnimationFrame(() => {
        scrollEl.scrollTop = 0;
      });
    });
  };

  const filter = (cnt.querySelector<HTMLInputElement>("#dist-filter")?.value ?? "").trim().toLowerCase();
  const epId = epSel.value;
  const saveBtn = cnt.querySelector<HTMLButtonElement>("#dist-save-btn");
  const filt = cnt.querySelector<HTMLInputElement>("#dist-filter");
  const suggestBtn = cnt.querySelector<HTMLButtonElement>("#dist-suggest-alias");
  const kind = _distSourceKind;

  if (!epId) {
    if (saveBtn) saveBtn.disabled = true;
    if (filt) filt.disabled = true;
    if (suggestBtn) suggestBtn.disabled = true;
    setDistTableInner(`<div class="acts-text-empty" style="padding:14px">Choisissez un épisode avec transcript importé.</div>`);
    if (summary) summary.textContent = "";
    return;
  }

  const ep = _cachedEpisodes?.episodes.find((e) => e.episode_id === epId);
  if (!ep || !episodeHasTranscript(ep)) {
    if (saveBtn) saveBtn.disabled = true;
    if (filt) filt.disabled = true;
    if (suggestBtn) suggestBtn.disabled = true;
    setDistTableInner(`<div class="acts-text-empty" style="padding:14px">Aucun transcript pour cet épisode.</div>`);
    if (summary) summary.textContent = "";
    return;
  }

  if (kind !== "cue") {
    if (!episodeHasSegmentedTranscript(ep)) {
      if (saveBtn) saveBtn.disabled = true;
      if (filt) filt.disabled = true;
      if (suggestBtn) suggestBtn.disabled = true;
      const st = transcriptStageLabel(ep);
      if (summary) {
        summary.textContent = `Segmentation requise (${st}).`;
      }
      setDistTableInner(`
      <div class="dist-preseg-panel" style="padding:12px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);max-width:36rem">
        <div style="font-size:0.8rem;color:var(--text);line-height:1.5;margin-bottom:10px">
          Normaliser → segmenter, puis revenir ici pour assigner les personnages.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button type="button" class="btn btn-secondary btn-sm" id="dist-jump-curation">Curation</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dist-jump-seg">Segmentation</button>
        </div>
      </div>`);
      return;
    }
  } else {
    const langs = episodeSrtLangs(ep);
    if (langs.length === 0 || !episodeHasSrtLang(ep, _distCueLang)) {
      if (saveBtn) saveBtn.disabled = true;
      if (filt) filt.disabled = true;
      if (suggestBtn) suggestBtn.disabled = true;
      setDistTableInner(`<div class="acts-text-empty" style="padding:14px">Importez un SRT pour cet épisode (langue affichée à droite) pour éditer les cues.</div>`);
      if (summary) summary.textContent = "";
      return;
    }
  }

  if (saveBtn) saveBtn.disabled = false;
  if (filt) filt.disabled = false;
  if (suggestBtn) suggestBtn.disabled = false;

  const cacheMiss =
    _distLoadedEpId !== epId ||
    _distLoadedSourceKind !== kind ||
    (kind === "cue" && _distLoadedCueLangSnap !== _distCueLang);

  if (cacheMiss) {
    setDistTableInner(`<div class="acts-text-empty" style="padding:14px">Chargement…</div>`);
    try {
      if (kind === "cue") {
        _distLoadedCues = (await fetchAllSubtitleCues(epId, _distCueLang)).slice().sort((a, b) => a.n - b.n);
        _distLoadedSegments = [];
        _distLoadedEpId = epId;
        _distLoadedSourceKind = kind;
        _distLoadedCueLangSnap = _distCueLang;
        distHydrateCharPick(epId, kind);
      } else {
        const segKind = kind === "utterance" ? "utterance" : "sentence";
        const resp = await fetchEpisodeSegments(epId, segKind);
        _distLoadedSegments = resp.segments.slice().sort((a, b) => a.n - b.n);
        _distLoadedCues = [];
        _distLoadedEpId = epId;
        _distLoadedSourceKind = kind;
        _distLoadedCueLangSnap = null;
        distHydrateCharPick(epId, kind);
      }
    } catch (e) {
      setDistTableInner(`<div class="acts-text-empty" style="padding:14px;color:var(--danger)">${escapeHtml(formatApiError(e))}</div>`);
      return;
    }
  }

  const isCue = kind === "cue";
  const totalRaw = isCue ? _distLoadedCues.length : _distLoadedSegments.length;
  if (totalRaw === 0) {
    setDistTableInner(`<div class="acts-text-empty" style="padding:14px">Aucune ligne (${isCue ? "cues SRT" : kind}).</div>`);
    if (summary) summary.textContent = "";
    return;
  }

  let rowsSeg: SegmentRow[] = [];
  let rowsCue: SubtitleCue[] = [];
  if (isCue) {
    rowsCue = _distLoadedCues;
    if (filter) {
      rowsCue = rowsCue.filter((c) => (c.text_clean ?? "").toLowerCase().includes(filter));
    }
  } else {
    rowsSeg = _distLoadedSegments;
    if (filter) {
      rowsSeg = rowsSeg.filter((s) => {
        const blob = `${s.text}\n${s.speaker_explicit ?? ""}`.toLowerCase();
        return blob.includes(filter);
      });
    }
  }

  const nAssignCur = _assignments.filter((a) => {
    if (a.episode_id !== epId) return false;
    if (isCue) return !!a.cue_id;
    const sid = a.segment_id ?? "";
    return sid.includes(distSegmentMarker(kind));
  }).length;

  if (_characters.length === 0) {
    if (summary) {
      summary.textContent = `${totalRaw} ligne(s) · ${nAssignCur} assign. — ajoutez des personnages (onglet Personnages).`;
    }
    setDistTableInner(`
      <div class="acts-text-empty" style="padding:14px">
        Aucun personnage. Créez-en dans <strong>Personnages</strong>.
      </div>`);
    return;
  }

  const rowCount = isCue ? rowsCue.length : rowsSeg.length;
  if (rowCount === 0) {
    if (summary) {
      summary.textContent = `0 / ${totalRaw} (filtre) · ${nAssignCur} assign. · ${_characters.length} pers.`;
    }
    setDistTableInner(`<div class="acts-text-empty" style="padding:14px">Aucune ligne ne correspond au filtre.</div>`);
    updateDistributionEpisodeCharsSummary(cnt);
    return;
  }

  const pageSeg = isCue ? [] : rowsSeg;
  const pageCue = isCue ? rowsCue : [];

  const srcLabel =
    kind === "utterance" ? "tours" : kind === "sentence" ? "phrases" : `cues ${_distCueLang.toUpperCase()}`;

  if (summary) {
    summary.textContent =
      `${rowCount}/${totalRaw} (${srcLabel}) · ${nAssignCur} assign. · ${_characters.length} pers.`;
  }

  const showSpeakerCol = kind === "utterance";

  const tableRowsFixed = isCue
    ? pageCue.map((c, i) => {
        const cur = _distCharPick.get(c.cue_id) ?? "";
        const preview =
          c.text_clean.length > 160 ? `${c.text_clean.slice(0, 160)}…` : c.text_clean;
        const opts = _characters
          .map((ch) => `<option value="${escapeHtml(ch.id)}"${cur === ch.id ? " selected" : ""}>${escapeHtml(ch.canonical)}</option>`)
          .join("");
        const nTitle = escapeHtml(`n=${c.n} · ${c.cue_id}`);
        return `<tr>
      <td class="dist-td-n" title="${nTitle}">${i + 1}</td>
      <td class="dist-td-tx">${escapeHtml(preview)}</td>
      <td class="dist-td-sel">
        <select class="dist-char-select acts-params-select" data-row-id="${escapeHtml(c.cue_id)}">
          <option value="">—</option>
          ${opts}
        </select>
      </td>
    </tr>`;
      })
    : pageSeg.map((s, i) => {
        const cur = _distCharPick.get(s.segment_id) ?? "";
        const preview = s.text.length > 160 ? `${s.text.slice(0, 160)}…` : s.text;
        const opts = _characters
          .map((ch) => `<option value="${escapeHtml(ch.id)}"${cur === ch.id ? " selected" : ""}>${escapeHtml(ch.canonical)}</option>`)
          .join("");
        const spVal = escapeHtml(s.speaker_explicit ?? "");
        const nTitle = escapeHtml(`n=${s.n} · ${s.segment_id}`);
        const charCell = `<td class="dist-td-sel">
        <select class="dist-char-select acts-params-select" data-row-id="${escapeHtml(s.segment_id)}">
          <option value="">—</option>
          ${opts}
        </select>
      </td>`;
        const locCell = showSpeakerCol
          ? `<td class="dist-td-sp">
        <input type="text" class="dist-sp-input" data-segment-id="${escapeHtml(s.segment_id)}"
          value="${spVal}" placeholder="—" title="speaker_explicit (sauvé au blur)" />
      </td>`
          : "";
        if (showSpeakerCol) {
          return `<tr>
      <td class="dist-td-n" title="${nTitle}">${i + 1}</td>
      ${charCell}
      <td class="dist-td-tx">${escapeHtml(preview)}</td>
      ${locCell}
    </tr>`;
        }
        return `<tr>
      <td class="dist-td-n" title="${nTitle}">${i + 1}</td>
      <td class="dist-td-tx">${escapeHtml(preview)}</td>
      ${charCell}
    </tr>`;
      });

  const head = isCue
    ? `<th title="Rang dans la liste (n° de cue en infobulle)">#</th><th>Texte (SRT)</th><th>Personnage</th>`
    : showSpeakerCol
      ? `<th title="Rang dans la liste (n du segment en infobulle)">#</th><th>Personnage</th><th>Texte</th><th>Locuteur</th>`
      : `<th title="Rang dans la liste (n du segment en infobulle)">#</th><th>Texte</th><th>Personnage</th>`;

  setDistTableInner(`
    <table class="dist-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${tableRowsFixed.join("")}</tbody>
    </table>`);
  updateDistributionEpisodeCharsSummary(cnt);
}

async function saveDistributionAssignments(cnt: HTMLElement): Promise<void> {
  const msg = cnt.querySelector<HTMLElement>("#dist-save-msg");
  const errEl = cnt.querySelector<HTMLElement>("#dist-error");
  const epId = cnt.querySelector<HTMLSelectElement>("#dist-ep-select")?.value?.trim() ?? "";
  if (!epId) return;
  if (_characters.length === 0) {
    if (msg) {
      msg.textContent = "Aucun personnage (onglet Personnages).";
      msg.style.color = "var(--danger,#dc2626)";
    }
    return;
  }
  if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }
  if (msg) {
    msg.textContent = "Enregistrement…";
    msg.style.color = "var(--text-muted)";
  }

  const kind = _distSourceKind;

  try {
    if (kind === "cue") {
      const loadedSet = new Set(_distLoadedCues.map((c) => c.cue_id));
      const kept = distKeepOtherAssignments(epId, kind, new Set(), loadedSet);
      const next: CharacterAssignment[] = [];
      for (const c of _distLoadedCues) {
        const cid = _distCharPick.get(c.cue_id)?.trim();
        if (!cid) continue;
        next.push({
          cue_id: c.cue_id,
          character_id: cid,
          episode_id: epId,
          speaker_label: (c.text_clean ?? "").trim().slice(0, 200) || undefined,
        });
      }
      await saveAssignments([...kept, ...next]);
    } else {
      const segKind = kind === "utterance" ? "utterance" : "sentence";
      const segResp = await fetchEpisodeSegments(epId, segKind);
      const loadedSet = new Set(segResp.segments.map((s) => s.segment_id));
      const kept = distKeepOtherAssignments(epId, kind, loadedSet, new Set());
      const next: CharacterAssignment[] = [];
      for (const s of segResp.segments) {
        const cid = _distCharPick.get(s.segment_id)?.trim();
        if (!cid) continue;
        next.push({
          segment_id: s.segment_id,
          character_id: cid,
          episode_id: epId,
          speaker_label: s.speaker_explicit?.trim() || undefined,
          source_key: "transcript",
        });
      }
      await saveAssignments([...kept, ...next]);
    }
    const fresh = await fetchAssignments();
    _assignments = fresh.assignments;
    distHydrateCharPick(epId, kind);
    if (msg) {
      msg.textContent = "✓ Enregistré";
      msg.style.color = "var(--success, #16a34a)";
      setTimeout(() => { if (msg.textContent === "✓ Enregistré") msg.textContent = ""; }, 2200);
    }
    await renderDistributionTable(cnt);
  } catch (e) {
    if (msg) {
      msg.textContent = "";
      msg.style.color = "";
    }
    if (errEl) {
      errEl.style.display = "block";
      errEl.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : formatApiError(e);
    }
  }
}

async function loadDistributionPanel(cnt: HTMLElement, opts?: { force?: boolean }): Promise<void> {
  wireDistributionPanel(cnt);
  if (opts?.force) {
    _distLoadedEpId = null;
    _distLoadedSegments = [];
    _distLoadedCues = [];
    _distLoadedSourceKind = null;
  }

  const errEl = cnt.querySelector<HTMLElement>("#dist-error");
  const statsEl = cnt.querySelector<HTMLElement>("#dist-corpus-stats");
  const tableInner = cnt.querySelector<HTMLElement>("#dist-table-inner");
  const epSel = cnt.querySelector<HTMLSelectElement>("#dist-ep-select");
  if (!tableInner || !epSel) return;

  if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }

  try {
    if (!_cachedEpisodes) _cachedEpisodes = await fetchEpisodes();
    const [charResp, assignResp] = await Promise.all([fetchCharacters(), fetchAssignments()]);
    _characters = charResp.characters;
    _assignments = assignResp.assignments;

    const eps = _cachedEpisodes.episodes;
    const n = eps.length;
    const withTr = eps.filter((e) => episodeHasTranscript(e)).length;
    const segReady = eps.filter((e) => episodeHasSegmentedTranscript(e)).length;
    if (statsEl) {
      statsEl.innerHTML =
        `<strong>${n}</strong> ép. · <strong>${withTr}</strong> transcript · <strong>${segReady}</strong> segmentés`;
    }

    const sorted = [...eps].sort((a, b) => (a.season !== b.season ? a.season - b.season : a.episode - b.episode));
    const stored = localStorage.getItem(lsKey(DIST_EP_LS_KEY)) ?? "";
    let htmlOpts = "";
    for (const e of sorted) {
      if (!episodeHasTranscript(e)) continue;
      const stage = transcriptStageLabel(e);
      const titleShort = e.title.length > 36 ? `${e.title.slice(0, 36)}…` : e.title;
      const label = `${e.episode_id} — ${titleShort} · ${stage}`;
      htmlOpts += `<option value="${escapeHtml(e.episode_id)}">${escapeHtml(label)}</option>`;
    }
    if (!htmlOpts) {
      htmlOpts = `<option value="" disabled>Aucun épisode avec transcript</option>`;
    }
    epSel.innerHTML = `<option value="">— Choisir un épisode —</option>${htmlOpts}`;

    const prev = stored && eps.some((e) => e.episode_id === stored) ? stored : "";
    const prevEp = prev ? eps.find((e) => e.episode_id === prev) : undefined;
    const prevHasTr = prevEp ? episodeHasTranscript(prevEp) : false;
    if (prevHasTr) {
      epSel.value = prev;
    } else {
      const firstSeg = sorted.find((e) => episodeHasTranscript(e) && episodeHasSegmentedTranscript(e));
      const firstTr = sorted.find((e) => episodeHasTranscript(e));
      const pick = firstSeg ?? firstTr;
      if (pick) {
        epSel.value = pick.episode_id;
        localStorage.setItem(lsKey(DIST_EP_LS_KEY), pick.episode_id);
      } else {
        epSel.value = "";
      }
    }

    const sk = cnt.querySelector<HTMLSelectElement>("#dist-source-kind");
    if (sk) sk.value = _distSourceKind;
    syncDistributionSourceControls(cnt);
    await renderDistributionTable(cnt);
  } catch (e) {
    tableInner.classList.add("acts-text-empty");
    tableInner.style.padding = "14px";
    tableInner.innerHTML = `<div class="acts-text-empty" style="padding:14px;color:var(--danger)">Impossible de charger les données.</div>`;
    tableInner.scrollTop = 0;
    cnt.querySelector<HTMLElement>("#dist-table-wrap")?.scrollTo({ top: 0, left: 0 });
    if (errEl) {
      errEl.style.display = "block";
      errEl.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : formatApiError(e);
    }
  }
}

async function refreshJobs(container: HTMLElement) {
  const myMountId = _constituerMountId;
  try {
    const { jobs } = await fetchJobs();
    if (_constituerMountId !== myMountId) return; // navigation survenue pendant l'await
    renderJobsPanel(container, jobs);
    // Polling actif tant que jobs pending/running
    const hasActive = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (!hasActive) {
      stopJobPoll();
      document.dispatchEvent(new CustomEvent("himyc:corpus-changed"));
      // Refresh the active sub-view episode list so badges reflect actual job results
      if (_activeSection === "actions") {
        if (_activeActionsSubView === "curation") {
          await loadAndRender(container);
          // Re-marquer l'épisode actif après le re-rendu de la liste
          if (_curPreviewEpId && !_curEditMode) {
            const listEl   = container.querySelector<HTMLElement>("#cur-ep-list");
            const epItem   = listEl?.querySelector<HTMLElement>(`[data-ep-id="${_curPreviewEpId}"]`);
            if (epItem) epItem.classList.add("active");
            const panes    = container.querySelector<HTMLElement>("#cur-preview-panes");
            const epTitle  = epItem?.dataset.epTitle ?? _curPreviewEpId;
            const mode     = container.querySelector<HTMLElement>(".cur-preview-tab.active")?.dataset.mode ?? "side";
            if (panes) {
              _curPreviewData = null; // forcer le rechargement depuis le serveur
              await loadCurationPreview(panes, _curPreviewEpId, epTitle, mode, container);
            }
            // Remettre le bouton normaliser à "Re-normaliser" après job terminé
            const normBtn = container.querySelector<HTMLButtonElement>("#cur-apply-normalize");
            if (normBtn) { normBtn.disabled = false; normBtn.textContent = "Re-normaliser et sauvegarder"; }
          }
        }
        if (_activeActionsSubView === "segmentation") loadAndRenderSegmentation(container);
        if (_activeActionsSubView === "alignement")   loadAndRenderAlignement(container);
        if (_activeActionsSubView === "distribution") void loadDistributionPanel(container);
      }
    }
  } catch { /* backend down — stop poll */ stopJobPoll(); }
}

function startJobPoll(container: HTMLElement) {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => refreshJobs(container), 2000);
}

function stopJobPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/** Si vrai : pas de surlignage mot-à-mot brut/normalisé (la fusion sous-titres noie tout en « suppressions »). */
function mergeSubtitleBreaksEnabled(cnt: HTMLElement): boolean {
  return !!collectNormalizeOpts(cnt).merge_subtitle_breaks;
}

function collectNormalizeOpts(cnt: HTMLElement): Record<string, unknown> {
  const cb = (id: string) => cnt.querySelector<HTMLInputElement>(id)?.checked ?? false;
  const punct = cnt.querySelector<HTMLSelectElement>("#cur-punct")?.value ?? "none";
  return {
    merge_subtitle_breaks:  cb("#cur-opt-merge"),
    fix_double_spaces:      cb("#cur-opt-double"),
    fix_french_punctuation: punct === "fr",
    fix_english_punctuation: punct === "en",
    normalize_apostrophes:  cb("#cur-norm-apos"),
    normalize_quotes:       cb("#cur-norm-quotes"),
    strip_line_spaces:      cb("#cur-norm-strip"),
    strip_empty_lines:      cb("#cur-norm-strip-empty"),
    case_transform:         cnt.querySelector<HTMLSelectElement>("#cur-norm-case")?.value ?? "none",
  };
}

function applyNormalizeOptsToPanel(cnt: HTMLElement, opts: NormalizeOptions) {
  const set = (id: string, val: boolean) => {
    const el = cnt.querySelector<HTMLInputElement>(id);
    if (el) el.checked = val;
  };
  set("#cur-opt-merge",       opts.merge_subtitle_breaks);
  set("#cur-opt-double",      opts.fix_double_spaces);
  const punctSel = cnt.querySelector<HTMLSelectElement>("#cur-punct");
  if (punctSel) {
    if (opts.fix_french_punctuation && opts.fix_english_punctuation) punctSel.value = "fr";
    else if (opts.fix_french_punctuation) punctSel.value = "fr";
    else if (opts.fix_english_punctuation) punctSel.value = "en";
    else punctSel.value = "none";
  }
  set("#cur-norm-apos",        opts.normalize_apostrophes);
  set("#cur-norm-quotes",      opts.normalize_quotes);
  set("#cur-norm-strip",       opts.strip_line_spaces);
  set("#cur-norm-strip-empty", opts.strip_empty_lines);
  const caseEl = cnt.querySelector<HTMLSelectElement>("#cur-norm-case");
  if (caseEl) caseEl.value = opts.case_transform;
}

async function queueBatchNormalize(
  episodes: Episode[],
  container: HTMLElement,
) {
  const scopeAll = (container.querySelector<HTMLInputElement>("input[name='hub-scope'][value='all']")?.checked) ?? false;
  const profile  = container.querySelector<HTMLSelectElement>("#hub-profile")?.value ?? "default_en_v1";
  const normalizeOpts = collectNormalizeOpts(container);
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
        await createJob("normalize_transcript", ep.episode_id, "transcript", {
          normalize_profile: profile,
          normalize_options: normalizeOpts,
        });
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

/**
 * Convertit un Uint8Array en chaîne base64.
 *
 * Encode par blocs de 6144 octets (multiple de 3) afin que chaque appel
 * à btoa produise un fragment base64 sans padding intermédiaire.
 * Les fragments sont concaténés : le résultat est un base64 valide et
 * complet. Évite de construire une unique grande chaîne binaire en mémoire.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 3 * 2048; // 6144 — multiple de 3 : pas de padding intermédiaire
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    parts.push(btoa(String.fromCharCode(...chunk)));
  }
  return parts.join("");
}

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
        { name: "Texte brut",   extensions: ["txt"] },
        { name: "Word",         extensions: ["docx", "docm"] },
        { name: "OpenDocument", extensions: ["odt"] },
        { name: "Tous fichiers", extensions: ["*"] },
      ],
    });
    if (!selected) return;
    const filePath = selected as string;
    const filename = filePath.replace(/\\/g, "/").split("/").pop() ?? "";

    // Lecture binaire → base64 pour que le backend gère l'encodage / l'extraction
    const bytes  = await readFile(filePath as string);
    const rawB64 = uint8ToBase64(bytes);
    await importTranscriptFile(episodeId, rawB64, filename);
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

      // Actions : import/suppression transcript + import SRT
      const hasTranscript = transcript?.available ?? false;
      const importTrBtn = !hasTranscript
        ? `<button class="btn btn-primary btn-sm" data-action="import-transcript" data-ep="${escapeHtml(ep.episode_id)}">+ transcript</button>`
        : `<button class="btn btn-ghost btn-sm" data-action="delete-transcript" data-ep="${escapeHtml(ep.episode_id)}"
             title="Supprimer le transcript (raw, clean, segments)"
             style="color:var(--danger);opacity:.7">✕ transcript</button>`;
      const importSrtBtn = `<button class="btn btn-secondary btn-sm" data-action="import-srt" data-ep="${escapeHtml(ep.episode_id)}">+ SRT</button>`;

      // Boutons ✕ pour chaque SRT présent
      const deleteSrtBtns = srtLangs
        .filter((lang) => sourceForKey(ep, `srt_${lang}`)?.available)
        .map((lang) => `<button class="btn btn-ghost btn-sm" data-action="delete-srt"
             data-ep="${escapeHtml(ep.episode_id)}" data-lang="${escapeHtml(lang)}"
             title="Supprimer la piste SRT ${lang.toUpperCase()}"
             style="color:var(--danger);opacity:.7">✕ SRT ${escapeHtml(lang.toUpperCase())}</button>`)
        .join("");

      return `
        <tr data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}">
          <td style="font-family:ui-monospace,monospace;font-size:0.78rem">${escapeHtml(ep.episode_id)}</td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title)}</td>
          <td>${transcriptCell}</td>
          ${srtCells}
          <td><div class="cons-actions">${importTrBtn}${importSrtBtn}${deleteSrtBtns}</div></td>
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
    } else if (action === "delete-transcript") {
      hideErr();
      if (!confirm(`Supprimer le transcript de « ${epId} » ?\n(raw, clean, segments — irréversible)`)) {
        btn.disabled = false; return;
      }
      try {
        await deleteTranscript(epId);
        onRefresh();
      } catch (err: unknown) {
        showErr(err instanceof Error ? err.message : String(err));
      }
    } else if (action === "delete-srt") {
      hideErr();
      const lang = btn.dataset.lang!;
      if (!confirm(`Supprimer la piste SRT ${lang.toUpperCase()} de « ${epId} » ? (irréversible)`)) {
        btn.disabled = false; return;
      }
      try {
        await deleteSrt(epId, lang);
        onRefresh();
      } catch (err: unknown) {
        showErr(err instanceof Error ? err.message : String(err));
      }
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
      <button class="acts-text-edit-btn" title="Modifier le texte normalisé" style="display:none">✏️ Modifier</button>
    </div>
    <div class="acts-text-body acts-text-loading">Chargement…</div>
    <div class="acts-text-edit-bar" style="display:none">
      <button class="acts-text-save-btn btn btn-primary btn-sm">Sauvegarder</button>
      <button class="acts-text-cancel-btn btn btn-ghost btn-sm">Annuler</button>
      <span class="acts-text-edit-status" style="font-size:0.75rem;color:var(--text-muted);margin-left:8px"></span>
    </div>`;

  try {
    const src = await fetchEpisodeSource(epId, "transcript") as TranscriptSourceContent;
    const contentMap: Record<string, string> = {
      raw:   src.raw  ?? "",
      clean: src.clean ?? src.raw ?? "",
    };
    const bodyEl     = panel.querySelector<HTMLElement>(".acts-text-body")!;
    const editBtn    = panel.querySelector<HTMLButtonElement>(".acts-text-edit-btn")!;
    const editBar    = panel.querySelector<HTMLElement>(".acts-text-edit-bar")!;
    const saveBtn    = panel.querySelector<HTMLButtonElement>(".acts-text-save-btn")!;
    const cancelBtn  = panel.querySelector<HTMLButtonElement>(".acts-text-cancel-btn")!;
    const editStatus = panel.querySelector<HTMLElement>(".acts-text-edit-status")!;

    let currentTab = tabs[0].key;

    function showTab(key: string) {
      currentTab = key;
      panel.querySelectorAll<HTMLElement>(".acts-text-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === key),
      );
      // Edit button only visible on clean tab
      editBtn.style.display = key === "clean" ? "" : "none";
      exitEditMode(false);
      bodyEl.className = "acts-text-body";
      bodyEl.textContent = contentMap[key] ?? contentMap["raw"] ?? "";
    }

    function enterEditMode() {
      const textarea = document.createElement("textarea");
      textarea.className = "acts-text-editor";
      textarea.value = contentMap["clean"];
      bodyEl.textContent = "";
      bodyEl.appendChild(textarea);
      editBar.style.display = "";
      editBtn.style.display = "none";
      editStatus.textContent = "";
      textarea.focus();
    }

    function exitEditMode(restoreContent: boolean) {
      editBar.style.display = "none";
      editBtn.style.display = currentTab === "clean" ? "" : "none";
      editStatus.textContent = "";
      if (restoreContent) {
        bodyEl.className = "acts-text-body";
        bodyEl.textContent = contentMap["clean"];
      }
    }

    editBtn.addEventListener("click", () => enterEditMode());

    cancelBtn.addEventListener("click", () => exitEditMode(true));

    saveBtn.addEventListener("click", async () => {
      const textarea = bodyEl.querySelector<HTMLTextAreaElement>("textarea");
      if (!textarea) return;
      const newClean = textarea.value;
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      editStatus.textContent = "Sauvegarde…";
      try {
        await patchTranscript(epId, newClean);
        contentMap["clean"] = newClean;
        exitEditMode(true);
        editStatus.textContent = "";
      } catch (err: unknown) {
        editStatus.textContent = err instanceof ApiError
          ? `${err.errorCode} — ${err.message}`
          : String(err);
        editStatus.style.color = "var(--danger)";
      } finally {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

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

// Mapping option → chip label et ID checkbox (options avancées + bloc Normaliser)
const OPTION_CHIP_MAP: Array<{
  optKey: keyof NormalizeOptions;
  label: string;
  checkboxId: string;
}> = [
  { optKey: "merge_subtitle_breaks",  label: "Fusion lignes",    checkboxId: "#cur-opt-merge" },
  { optKey: "fix_double_spaces",      label: "Espaces doubles",  checkboxId: "#cur-opt-double" },
  { optKey: "normalize_apostrophes",  label: "Apostrophes",      checkboxId: "#cur-norm-apos" },
  { optKey: "normalize_quotes",       label: "Guillemets",       checkboxId: "#cur-norm-quotes" },
  { optKey: "strip_line_spaces",      label: "Marges ligne",     checkboxId: "#cur-norm-strip" },
  { optKey: "strip_empty_lines",      label: "Lignes vides",     checkboxId: "#cur-norm-strip-empty" },
];

/** Rend les chips règles actives à partir de l'état courant du panneau options.
 *  Chaque chip est un bouton toggle bidirectionnel avec sa checkbox. */
function renderCurationRuleChips(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>("#cur-rule-chips");
  if (!el) return;
  el.innerHTML = OPTION_CHIP_MAP.map(({ optKey, label, checkboxId }) => {
    const cb = container.querySelector<HTMLInputElement>(checkboxId);
    const on = cb?.checked ?? false;
    return `<button type="button" class="cur-rule-chip ${on ? "on" : "off"}" data-opt-key="${escapeHtml(optKey)}" data-cb-id="${escapeHtml(checkboxId)}" title="${on ? "Désactiver" : "Activer"}">${escapeHtml(label)}</button>`;
  }).join("");

  // Wire toggle clicks
  el.querySelectorAll<HTMLButtonElement>(".cur-rule-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cbId = chip.dataset.cbId!;
      const cb = container.querySelector<HTMLInputElement>(cbId);
      if (cb) cb.checked = !cb.checked;
      renderCurationRuleChips(container); // re-render to reflect new state
      scheduleCurationPreview(container); // déclencher l'aperçu normalisé
    });
  });
}

/**
 * Clique automatiquement sur le row/item correspondant à _constituerSharedEpId
 * dans scopeEl, si cet élément n'est pas déjà actif.
 * rowSel : sélecteur CSS de base (ex. "tr[data-ep-id]", ".cur-ep-item")
 * activeCls : classe CSS qui indique l'état actif (ex. "active-row", "active")
 */
function autoSelectSharedEp(scopeEl: HTMLElement, rowSel: string, activeCls: string) {
  if (!_constituerSharedEpId) return;
  const el = scopeEl.querySelector<HTMLElement>(
    `${rowSel}[data-ep-id="${window.CSS.escape(_constituerSharedEpId)}"]`,
  );
  if (el && !el.classList.contains(activeCls)) el.click();
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

  const srcBar = container.querySelector<HTMLElement>("#cur-src-bar");

  listEl.querySelectorAll<HTMLElement>(".cur-ep-item").forEach((item) => {
    item.addEventListener("click", async () => {
      listEl.querySelectorAll(".cur-ep-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      const epId    = item.dataset.epId!;
      const epTitle = item.dataset.epTitle!;
      const epState = item.dataset.epState!;
      _constituerSharedEpId = epId;

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

      // Mettre à jour la barre de source (C-1)
      const ep = _cachedEpisodes?.episodes.find((e) => e.episode_id === epId);
      _curPreviewEpSources = ep?.sources ?? [];
      // Revenir au transcript si la source courante n'est pas disponible pour cet épisode
      const srcAvail = _curPreviewEpSources.find((s) => s.source_key === _curPreviewSourceKey && s.available);
      if (!srcAvail) _curPreviewSourceKey = "transcript";
      _curPreviewData = null;
      _curSearchRegex = null;
      _clientPreviewClean = null;
      if (_clientPreviewTimer) { clearTimeout(_clientPreviewTimer); _clientPreviewTimer = null; }
      if (_curEditMode) exitEditMode(container);
      if (srcBar) renderCurSourceBar(srcBar, _curPreviewEpSources, container);
      updateCurationModeTabsForSource(container, _curPreviewSourceKey);

      await loadCurationPreview(previewPanes, epId, epTitle, activeMode(), container);
      // Bouton normaliser : activer + libellé selon état
      const normBtn = container.querySelector<HTMLButtonElement>("#cur-apply-normalize");
      if (normBtn) {
        normBtn.disabled = false;
        normBtn.textContent = (epState === "normalized" || epState === "segmented" || epState === "ready_for_alignment")
          ? "Re-normaliser et sauvegarder"
          : "Normaliser et sauvegarder";
      }
      // Mettre à jour le sélecteur de pistes SRT
      updateSrtLangSelector(container, ep);
      // Déclencher l'aperçu avec les paramètres courants dès qu'un épisode est sélectionné
      scheduleCurationPreview(container);
    });
  });

  // Per-episode normalize buttons
  listEl.querySelectorAll<HTMLButtonElement>(".cur-ep-normalize").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const epId = btn.dataset.ep!;
      const profile = container.querySelector<HTMLSelectElement>("#cur-profile")?.value ?? "default_en_v1";
      const normalizeOpts = collectNormalizeOpts(container);
      btn.disabled = true;
      btn.textContent = "…";
      try {
        await createJob("normalize_transcript", epId, "transcript", {
          normalize_profile: profile,
          normalize_options: normalizeOpts,
        });
        startJobPoll(container);
        btn.textContent = "✓";
        setTimeout(() => btn.remove(), 800);
      } catch {
        btn.disabled = false;
        btn.textContent = "⚡";
      }
    });
  });

  // N-2 : auto-sélection de l'épisode cible (depuis Documents → "→ Curation")
  if (_pendingCurationEpisodeId) {
    const target = _pendingCurationEpisodeId;
    _pendingCurationEpisodeId = null;
    const targetItem = listEl.querySelector<HTMLElement>(`.cur-ep-item[data-ep-id="${target}"]`);
    if (targetItem) {
      targetItem.click();
      targetItem.scrollIntoView({ block: "nearest" });
    }
  } else {
    // Persistance inter-sous-vues : ré-ouvrir l'épisode actif si on revient sur Curation
    autoSelectSharedEp(listEl, ".cur-ep-item", "active");
  }
}

let _pendingCurationEpisodeId: string | null = null; // N-2 : pré-sélection depuis Documents
let _curPreviewEpId: string | null = null;
/** Épisode actif partagé entre toutes les sous-vues (curation, segmentation, alignement) */
let _constituerSharedEpId: string | null = null;
let _curPreviewData: { raw: string; clean: string } | null = null;
let _curPreviewSourceKey: string = "transcript";
let _curPreviewEpSources: EpisodeSource[] = [];
let _curEditMode = false;
let _curSearchRegex: RegExp | null = null; // Regex active pour le surlignage Rechercher
let _clientPreviewClean: string | null = null; // Aperçu client-side (paramètres modifiés, non sauvegardé)
let _clientPreviewTimer: ReturnType<typeof setTimeout> | null = null; // Debounce timer aperçu

/**
 * Déclenche un aperçu normalisé (via /normalize/preview) avec debounce de 300ms.
 * Met à jour _clientPreviewClean et rafraîchit le preview sans sauvegarder.
 */
/**
 * Implémentation client-side du normalize (miroir du Python profiles.py).
 * Permet un aperçu instantané sans appel réseau.
 */
function _clientShouldMerge(prev: string, next: string): boolean {
  const p = prev.trimEnd();
  if (!p || !next.trim()) return false;
  if (".?!".includes(p[p.length - 1])) return false;
  if (/^[A-Z][A-Z0-9 _'.-]*: /i.test(next.trimStart())) return false;
  return true;
}

function normalizeTextClient(text: string, opts: Record<string, unknown>): { clean: string; merges: number } {
  const bool = (k: string) => opts[k] === true;
  let lines = text.split("\n");

  if (bool("strip_empty_lines")) lines = lines.filter((l) => l.trim() !== "");

  let merges = 0;
  const result: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine;
    if (bool("strip_line_spaces"))       line = line.trim();
    if (bool("fix_double_spaces"))       line = line.replace(/ {2,}/g, " ");
    if (bool("fix_french_punctuation"))  line = line.replace(/\s*([;:!?])/g, "\u00a0$1");
    if (bool("fix_english_punctuation")) line = line.replace(/\s+([;:!?])/g, "$1");
    if (bool("normalize_apostrophes"))   line = line.replace(/'/g, "\u2019");
    if (bool("normalize_quotes"))        line = line.replace(/"([^"]+)"/g, "\u00ab\u00a0$1\u00a0\u00bb");

    if (bool("merge_subtitle_breaks") && result.length > 0 && _clientShouldMerge(result[result.length - 1], line)) {
      result[result.length - 1] = result[result.length - 1].trimEnd() + " " + line.trimStart();
      merges++;
    } else {
      result.push(line);
    }
  }

  const caseOpt = (opts["case_transform"] as string) ?? "none";
  const finalLines = result.map((l) => {
    if (caseOpt === "lowercase")     return l.toLowerCase();
    if (caseOpt === "UPPERCASE")     return l.toUpperCase();
    if (caseOpt === "Title Case")    return l.replace(/\b\w/g, (c) => c.toUpperCase());
    if (caseOpt === "Sentence case") return l.length > 0 ? l[0].toUpperCase() + l.slice(1).toLowerCase() : l;
    return l;
  });

  return { clean: finalLines.join("\n"), merges };
}

function scheduleCurationPreview(container: HTMLElement) {
  if (_clientPreviewTimer) clearTimeout(_clientPreviewTimer);
  _clientPreviewTimer = setTimeout(() => {
    _clientPreviewTimer = null;
    if (!_curPreviewData || _curEditMode || !_curPreviewEpId || _curPreviewSourceKey !== "transcript") return;
    const opts = collectNormalizeOpts(container);
    const { clean, merges } = normalizeTextClient(_curPreviewData.raw, opts);
    _clientPreviewClean = clean;
    const panes   = container.querySelector<HTMLElement>("#cur-preview-panes");
    const mode    = container.querySelector<HTMLElement>(".cur-preview-tab.active")?.dataset.mode ?? "side";
    const epTitle = container.querySelector<HTMLElement>(".cur-ep-item.active")?.dataset.epTitle ?? _curPreviewEpId;
    if (panes) {
      renderCurationPreviewMode(panes, { raw: _curPreviewData.raw, clean }, mode, epTitle, _curSearchRegex, mergeSubtitleBreaksEnabled(container));
    }
    const fb = container.querySelector<HTMLElement>("#cur-preview-feedback");
    if (fb) {
      fb.style.color = merges > 0 ? "var(--accent,#6366f1)" : "var(--text-muted)";
      fb.textContent = merges > 0
        ? `⟳ aperçu · ${merges} fusion${merges > 1 ? "s" : ""} de lignes`
        : `⟳ aperçu · aucune fusion — si le texte a des lignes vides entre les répliques, coche « Supprimer lignes vides »`;
    }
  }, 150);
}

/** Passe en mode édition : remplace le preview par un textarea avec le texte clean. */
function enterEditMode(container: HTMLElement) {
  if (_curEditMode) return;
  if (!_curPreviewData || _curPreviewSourceKey !== "transcript") return;
  _curEditMode = true;

  const editBar = container.querySelector<HTMLElement>("#cur-edit-bar")!;
  const editBtn = container.querySelector<HTMLButtonElement>("#cur-edit-btn")!;
  const panes   = container.querySelector<HTMLElement>("#cur-preview-panes")!;
  const status  = container.querySelector<HTMLElement>("#cur-edit-status")!;

  editBar.style.display = "";
  editBtn.style.display = "none";

  // Masquer les preview tabs (ne pas les supprimer, juste les cacher)
  container.querySelector<HTMLElement>(".cur-preview-bar")!.style.opacity = "0.4";
  container.querySelector<HTMLElement>(".cur-preview-bar")!.style.pointerEvents = "none";

  const textarea = document.createElement("textarea");
  textarea.className = "cur-pane-textarea";
  textarea.value = _curPreviewData.clean;
  textarea.id = "cur-edit-textarea";

  panes.innerHTML = "";
  panes.appendChild(textarea);
  textarea.focus();

  status.textContent = "Édition du texte normalisé — les modifications invalideront les segments existants.";

  // C-5 : charger les personnages pour l'annotation locuteurs
  renderSpeakerStrip(container);
}

/** Quitte le mode édition et restaure le preview. */
function exitEditMode(container: HTMLElement) {
  if (!_curEditMode) return;
  _curEditMode = false;

  const editBar = container.querySelector<HTMLElement>("#cur-edit-bar")!;
  const editBtn = container.querySelector<HTMLButtonElement>("#cur-edit-btn")!;
  const status  = container.querySelector<HTMLElement>("#cur-edit-status")!;
  const previewBar = container.querySelector<HTMLElement>(".cur-preview-bar")!;

  editBar.style.display = "none";
  editBtn.style.display = _curPreviewSourceKey === "transcript" ? "" : "none";
  previewBar.style.opacity = "";
  previewBar.style.pointerEvents = "";
  status.textContent = "";

  // C-5 : masquer le strip locuteurs
  const strip = container.querySelector<HTMLElement>("#cur-speaker-strip");
  if (strip) strip.style.display = "none";

  // Restaurer le preview
  const panes = container.querySelector<HTMLElement>("#cur-preview-panes")!;
  const activeMode = (container.querySelector<HTMLElement>(".cur-preview-tab.active") as HTMLElement | null)?.dataset.mode ?? "side";
  if (_curPreviewData && _curPreviewEpId) {
    const epTitle = container.querySelector<HTMLElement>(".cur-ep-item.active")?.dataset.epTitle ?? _curPreviewEpId;
    renderCurationPreviewMode(panes, _curPreviewData, activeMode, epTitle, _curSearchRegex, mergeSubtitleBreaksEnabled(container));
  } else {
    panes.innerHTML = `<div class="acts-text-empty" style="width:100%">← Sélectionnez un épisode</div>`;
  }
}

/**
 * Insère ou remplace le préfixe "NOM: " en début de la ligne courante dans le textarea.
 * Si la ligne commence déjà par "QUELQUECHOSE: ", le préfixe existant est remplacé.
 */
function insertSpeakerPrefix(textarea: HTMLTextAreaElement, name: string) {
  const val   = textarea.value;
  const pos   = textarea.selectionStart ?? 0;
  const start = val.lastIndexOf("\n", pos - 1) + 1; // début de ligne courante
  const end   = val.indexOf("\n", pos);              // fin de ligne courante (-1 si dernière)
  const lineEnd = end === -1 ? val.length : end;
  const line  = val.slice(start, lineEnd);

  // Remplacer le préfixe "EXISTING: " s'il existe, sinon préfixer
  const newLine = /^[A-Z][A-Z0-9 _'.-]*:\s/i.test(line)
    ? line.replace(/^[^:]+:\s*/, `${name}: `)
    : `${name}: ${line}`;

  const newVal = val.slice(0, start) + newLine + val.slice(lineEnd);
  textarea.value = newVal;

  // Repositionner le curseur après le préfixe inséré
  const newCursorPos = start + name.length + 2; // "NOM: " = name + ": "
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();
}

/**
 * Charge les personnages et affiche les chips dans le strip.
 * Chaque chip insère le préfixe locuteur dans le textarea actif.
 */
async function renderSpeakerStrip(container: HTMLElement) {
  const strip = container.querySelector<HTMLElement>("#cur-speaker-strip");
  if (!strip) return;
  strip.style.display = "";
  strip.innerHTML = `<span class="cur-speaker-strip-label">Locuteur :</span><span style="font-size:0.7rem;color:var(--text-muted)">Chargement…</span>`;

  let characters: import("../api").Character[] = [];
  try {
    const res = await fetchCharacters();
    characters = res.characters;
  } catch {
    strip.innerHTML = `<span class="cur-speaker-strip-label">Locuteur :</span><span style="font-size:0.7rem;color:var(--danger,#dc2626)">Erreur chargement personnages</span>`;
    return;
  }

  if (characters.length === 0) {
    strip.innerHTML = `<span class="cur-speaker-strip-label">Locuteur :</span><span style="font-size:0.7rem;color:var(--text-muted);font-style:italic">Aucun personnage défini — configurer dans <strong>Personnages</strong></span>`;
    return;
  }

  strip.innerHTML = `<span class="cur-speaker-strip-label">Locuteur :</span>`;
  characters.forEach((ch) => {
    const btn = document.createElement("button");
    btn.className = "cur-speaker-chip";
    btn.textContent = ch.canonical;
    btn.title = `Insérer "${ch.canonical}: " en début de ligne`;
    btn.addEventListener("click", () => {
      const textarea = container.querySelector<HTMLTextAreaElement>("#cur-edit-textarea");
      if (textarea) insertSpeakerPrefix(textarea, ch.canonical);
    });
    strip.appendChild(btn);
  });
}

/**
 * Surligne les préfixes "NOM: " dans un bloc de texte brut (pour le preview).
 * Retourne du HTML avec <span class="cur-speaker-tag"> sur le préfixe.
 */
function highlightSpeakerTags(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return `<span class="cur-blank-line">¶</span>`;
      const m = line.match(/^([A-Z][A-Z0-9 _'.-]*)(: )/i);
      if (!m) return escapeHtml(line);
      return `<span class="cur-speaker-tag">${escapeHtml(m[1])}${escapeHtml(m[2])}</span>${escapeHtml(line.slice(m[0].length))}`;
    })
    .join("\n");
}

/**
 * Combine surlignage locuteur + surlignage recherche sur du texte brut.
 * Utiliser à la place de highlightSpeakerTags quand une recherche est active.
 */
function renderRawText(text: string, searchRegex?: RegExp | null): string {
  if (!searchRegex) return highlightSpeakerTags(text);
  const applyH = (t: string) => highlightInText(t, searchRegex);
  return text
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return `<span class="cur-blank-line">¶</span>`;
      const m = line.match(/^([A-Z][A-Z0-9 _'.-]*)(: )/i);
      if (!m) return applyH(line);
      return `<span class="cur-speaker-tag">${applyH(m[1])}${escapeHtml(m[2])}</span>${applyH(line.slice(m[0].length))}`;
    })
    .join("\n");
}

/** Met à jour la barre de sélection de source pour l'épisode courant. */
function renderCurSourceBar(bar: HTMLElement, sources: EpisodeSource[], container: HTMLElement) {
  const available = sources.filter((s) => s.available);
  if (available.length === 0) {
    bar.innerHTML = `<span style="font-size:0.72rem;color:var(--text-muted);font-style:italic">Aucun document</span>`;
    return;
  }
  bar.innerHTML = available.map((s) => {
    const label = s.source_key === "transcript"
      ? "📄 Transcript"
      : `🌐 SRT ${s.language?.toUpperCase() ?? s.source_key.replace("srt_", "")}`;
    const active = s.source_key === _curPreviewSourceKey;
    return `<button class="cur-src-tab${active ? " active" : ""}" data-src-key="${escapeHtml(s.source_key)}">${escapeHtml(label)}</button>`;
  }).join("");

  bar.querySelectorAll<HTMLButtonElement>(".cur-src-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.srcKey === _curPreviewSourceKey) return;
      _curPreviewSourceKey = btn.dataset.srcKey!;
      _curPreviewData = null; // invalide le cache
      // Quitter le mode édition si actif
      if (_curEditMode) exitEditMode(container);
      const panes = container.querySelector<HTMLElement>("#cur-preview-panes")!;
      const activeItem = container.querySelector<HTMLElement>(".cur-ep-item.active");
      const epId = activeItem?.dataset.epId ?? _curPreviewEpId ?? "";
      const epTitle = activeItem?.dataset.epTitle ?? epId;
      const mode = (container.querySelector<HTMLElement>(".cur-preview-tab.active") as HTMLElement | null)?.dataset.mode ?? "side";
      renderCurSourceBar(bar, _curPreviewEpSources, container);
      await loadCurationPreview(panes, epId, epTitle, mode, container);
      updateCurationModeTabsForSource(container, _curPreviewSourceKey);
    });
  });
}

/** Masque/affiche les tabs modes selon le type de source sélectionné. */
// ── Curation SRT helpers ───────────────────────────────────────────────────

function updateSrtLangSelector(container: HTMLElement, ep: Episode | undefined) {
  const sel      = container.querySelector<HTMLSelectElement>("#cur-srt-lang");
  const normBtn  = container.querySelector<HTMLButtonElement>("#cur-srt-normalize");
  const viewBtn  = container.querySelector<HTMLButtonElement>("#cur-srt-view-btn");
  if (!sel) return;
  const srtSrcs = (ep?.sources ?? []).filter((s) => s.source_key.startsWith("srt_") && s.available);
  sel.innerHTML = srtSrcs.length === 0
    ? `<option value="">— Aucune piste SRT —</option>`
    : srtSrcs.map((s) => {
        const lang = s.source_key.replace("srt_", "");
        return `<option value="${escapeHtml(lang)}">${escapeHtml(lang.toUpperCase())} (${s.state ?? "?"})</option>`;
      }).join("");
  sel.disabled  = srtSrcs.length === 0;
  if (normBtn)  normBtn.disabled  = srtSrcs.length === 0;
  if (viewBtn)  viewBtn.disabled  = srtSrcs.length === 0;
}

let _curSrtCuesOffset = 0;
const CUR_SRT_CUES_LIMIT = 50;

async function renderSrtCues(container: HTMLElement, epId: string, lang: string, append = false) {
  const listEl  = container.querySelector<HTMLElement>("#cur-srt-cues-list");
  const moreEl  = container.querySelector<HTMLElement>("#cur-srt-cues-more");
  if (!listEl) return;

  if (!append) {
    _curSrtCuesOffset = 0;
    listEl.innerHTML = `<div style="padding:12px;font-size:0.8rem;color:var(--text-muted)">Chargement…</div>`;
    if (moreEl) moreEl.style.display = "none";
  }

  let data: Awaited<ReturnType<typeof fetchSubtitleCues>>;
  try {
    data = await fetchSubtitleCues(epId, { lang, limit: CUR_SRT_CUES_LIMIT, offset: _curSrtCuesOffset });
  } catch (e) {
    if (!append) listEl.innerHTML = `<div style="padding:12px;color:var(--danger);font-size:0.8rem">${escapeHtml(String(e))}</div>`;
    return;
  }

  if (!append) listEl.innerHTML = "";
  if (data.cues.length === 0 && !append) {
    listEl.innerHTML = `<div style="padding:12px;font-size:0.8rem;color:var(--text-muted)">Aucune cue pour ${lang.toUpperCase()}.</div>`;
    return;
  }

  const _ms = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const f = ms % 1000;
    return (h ? `${h}:` : "") + `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(f).padStart(3,"0")}`;
  };

  for (const cue of data.cues) {
    const row = document.createElement("div");
    row.className = "cur-srt-cue-row";
    row.dataset.cueId = cue.cue_id;
    const showClean = (cue.text_clean || cue.text_raw).replace(/</g, "&lt;");
    const showRaw   = cue.text_raw.replace(/</g, "&lt;");
    row.innerHTML = `
      <div class="cur-srt-cue-meta">
        <span class="cur-srt-cue-n">#${cue.n}</span>
        <span class="cur-srt-cue-tc">${_ms(cue.start_ms)} → ${_ms(cue.end_ms)}</span>
        <button class="btn btn-ghost btn-sm cur-srt-cue-edit-btn" style="margin-left:auto;padding:1px 6px;font-size:0.7rem">✏</button>
      </div>
      <div class="cur-srt-cue-raw" style="color:var(--text-muted);font-size:0.72rem;padding:0 10px 2px">${showRaw}</div>
      <div class="cur-srt-cue-clean" style="padding:0 10px 4px;font-size:0.8rem">${showClean}</div>
      <div class="cur-srt-cue-edit-area" style="display:none;padding:4px 10px 6px">
        <textarea class="cur-srt-cue-textarea" rows="2" style="width:100%;font-size:0.8rem;resize:vertical;font-family:inherit;border:1px solid var(--border);border-radius:4px;padding:4px 6px;background:var(--surface);color:var(--text)">${(cue.text_clean || cue.text_raw).replace(/</g, "&lt;")}</textarea>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="btn btn-primary btn-sm cur-srt-cue-save-btn" style="font-size:0.75rem">💾 Sauvegarder</button>
          <button class="btn btn-ghost btn-sm cur-srt-cue-cancel-btn" style="font-size:0.75rem">✕</button>
        </div>
        <span class="cur-srt-cue-save-fb" style="font-size:0.7rem;color:var(--text-muted);display:block;margin-top:2px"></span>
      </div>`;

    // Wire edit toggle
    row.querySelector<HTMLButtonElement>(".cur-srt-cue-edit-btn")!.addEventListener("click", () => {
      const editArea = row.querySelector<HTMLElement>(".cur-srt-cue-edit-area")!;
      const ta       = row.querySelector<HTMLTextAreaElement>(".cur-srt-cue-textarea")!;
      const isOpen   = editArea.style.display !== "none";
      editArea.style.display = isOpen ? "none" : "";
      if (!isOpen) ta.focus();
    });

    // Wire save
    row.querySelector<HTMLButtonElement>(".cur-srt-cue-save-btn")!.addEventListener("click", async () => {
      const ta   = row.querySelector<HTMLTextAreaElement>(".cur-srt-cue-textarea")!;
      const fb   = row.querySelector<HTMLElement>(".cur-srt-cue-save-fb")!;
      const btn  = row.querySelector<HTMLButtonElement>(".cur-srt-cue-save-btn")!;
      const newText = ta.value.trim();
      btn.disabled = true; btn.textContent = "…";
      fb.style.color = "var(--text-muted)"; fb.textContent = "";
      try {
        await patchSubtitleCue(cue.cue_id, newText);
        // Update display
        const cleanEl = row.querySelector<HTMLElement>(".cur-srt-cue-clean")!;
        cleanEl.textContent = newText;
        row.querySelector<HTMLElement>(".cur-srt-cue-edit-area")!.style.display = "none";
        fb.style.color = "var(--success,#16a34a)"; fb.textContent = "✓ Sauvegardé";
        setTimeout(() => { fb.textContent = ""; }, 2000);
      } catch (e) {
        fb.style.color = "var(--danger,#dc2626)";
        fb.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        btn.disabled = false; btn.textContent = "💾 Sauvegarder";
      }
    });

    // Wire cancel
    row.querySelector<HTMLButtonElement>(".cur-srt-cue-cancel-btn")!.addEventListener("click", () => {
      row.querySelector<HTMLElement>(".cur-srt-cue-edit-area")!.style.display = "none";
    });

    listEl.appendChild(row);
  }

  _curSrtCuesOffset += data.cues.length;
  if (moreEl) {
    const hasMore = _curSrtCuesOffset < data.total;
    moreEl.style.display = hasMore ? "" : "none";
  }
}

function updateCurationModeTabsForSource(container: HTMLElement, sourceKey: string) {
  const isTranscript = sourceKey === "transcript";
  container.querySelectorAll<HTMLButtonElement>(".cur-preview-tab").forEach((t) => {
    const mode = t.dataset.mode!;
    // Diff et côte-à-côte n'ont de sens que pour transcript (raw+clean)
    const hide = !isTranscript && (mode === "diff" || mode === "side");
    t.style.display = hide ? "none" : "";
    // Si le mode actif est masqué, passer à "raw"
    if (hide && t.classList.contains("active")) {
      t.classList.remove("active");
      const rawTab = container.querySelector<HTMLButtonElement>('.cur-preview-tab[data-mode="raw"]');
      if (rawTab) rawTab.classList.add("active");
    }
  });
}

async function loadCurationPreview(
  panes: HTMLElement,
  epId: string,
  epTitle: string,
  mode: string,
  container: HTMLElement,
) {
  _curPreviewEpId = epId;
  const sourceKey = _curPreviewSourceKey;

  if (!_curPreviewData) {
    panes.innerHTML = `<div class="acts-text-empty" style="width:100%">Chargement…</div>`;
    try {
      const src = await fetchEpisodeSource(epId, sourceKey);
      if (sourceKey === "transcript") {
        const t = src as TranscriptSourceContent;
        _curPreviewData = { raw: t.raw ?? "", clean: t.clean ?? t.raw ?? "" };
      } else {
        // SRT : pas de raw/clean, on met le content dans les deux
        const s = src as SrtSourceContent;
        _curPreviewData = { raw: s.content ?? "", clean: "" };
      }
      // Réinitialiser l'aperçu client lors d'un rechargement depuis le serveur
      _clientPreviewClean = null;
    } catch (e) {
      panes.innerHTML = `<div class="acts-text-empty" style="width:100%">${escapeHtml(e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e))}</div>`;
      return;
    }
  }

  // Pour SRT, forcer mode "raw" (pas de diff/clean)
  const effectiveMode = sourceKey !== "transcript" ? "raw" : mode;
  // Si aperçu client actif, l'utiliser comme texte "clean"
  const displayData = _clientPreviewClean !== null
    ? { raw: _curPreviewData.raw, clean: _clientPreviewClean }
    : _curPreviewData;
  renderCurationPreviewMode(
    panes,
    displayData,
    effectiveMode,
    epTitle,
    _curSearchRegex,
    mergeSubtitleBreaksEnabled(container),
  );
}

// ── Word-level diff (LCS sur tokens) ────────────────────────────────────────

/** Tokenise une chaîne en mots + séparateurs pour le diff. */
function tokenize(s: string): string[] {
  return s.match(/\S+|\s+/g) ?? (s ? [s] : []);
}

/** LCS-diff sur tableau de tokens → retourne opérations {eq|del|ins}. */
function tokenDiff(
  a: string[], b: string[],
): Array<{ type: "eq" | "del" | "ins"; text: string }> {
  const m = a.length, n = b.length;
  // Limiter les calculs sur de très longues lignes
  if (m > 400 || n > 400) {
    const ops: Array<{ type: "eq" | "del" | "ins"; text: string }> = [];
    a.forEach((t) => ops.push({ type: "del", text: t }));
    b.forEach((t) => ops.push({ type: "ins", text: t }));
    return ops;
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const result: Array<{ type: "eq" | "del" | "ins"; text: string }> = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { result.push({ type: "eq",  text: a[i++] }); j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { result.push({ type: "ins", text: b[j++] }); }
    else { result.push({ type: "del", text: a[i++] }); }
  }
  return result;
}

/** Retourne le HTML d'une ligne avec changements inline surlignés. */
function inlineLineDiff(rawLine: string, cleanLine: string): string {
  const ops = tokenDiff(tokenize(rawLine), tokenize(cleanLine));
  return ops.map(({ type, text }) => {
    const t = escapeHtml(text);
    if (type === "del") return `<span class="cur-w-del">${t}</span>`;
    if (type === "ins") return `<span class="cur-w-ins">${t}</span>`;
    return t;
  }).join("");
}

/** Construit le HTML du panneau diff. Si `lineOnly`, pas de diff inline (ex. fusion sous-titres). */
function buildDiffHtml(raw: string, clean: string, lineOnly = false): { html: string; nChanges: number } {
  const rawLines   = raw.split("\n");
  const cleanLines = clean.split("\n");
  const maxLen = Math.max(rawLines.length, cleanLines.length);
  let nChanges = 0;
  const parts: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const r = rawLines[i];
    const c = cleanLines[i];
    if (r === undefined) {
      nChanges++;
      parts.push(`<div class="cur-diff-changed"><div class="cur-diff-ins">+ ${escapeHtml(c)}</div></div>`);
    } else if (c === undefined) {
      nChanges++;
      parts.push(`<div class="cur-diff-changed"><div class="cur-diff-del">- ${escapeHtml(r)}</div></div>`);
    } else if (r === c) {
      parts.push(`<div class="cur-diff-same">${escapeHtml(r)}</div>`);
    } else {
      nChanges++;
      if (lineOnly) {
        parts.push(
          `<div class="cur-diff-changed cur-diff-lineonly"><div class="cur-diff-del">− ${escapeHtml(r)}</div><div class="cur-diff-ins">+ ${escapeHtml(c)}</div></div>`,
        );
      } else {
        parts.push(`<div class="cur-diff-changed"><div class="cur-diff-ins" style="text-decoration:none">${inlineLineDiff(r, c)}</div></div>`);
      }
    }
  }
  return { html: parts.join(""), nChanges };
}

/** Surligne les occurrences d'un pattern dans du texte brut → HTML échappé avec <mark>. */
function highlightInText(text: string, regex: RegExp): string {
  const parts: string[] = [];
  let lastIdx = 0;
  const r = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(escapeHtml(text.slice(lastIdx, m.index)));
    parts.push(`<mark class="cur-search-hl">${escapeHtml(m[0])}</mark>`);
    lastIdx = r.lastIndex;
    if (m[0].length === 0) r.lastIndex++;
  }
  parts.push(escapeHtml(text.slice(lastIdx)));
  return parts.join("");
}

/** Une ligne : locuteur + recherche (pour panneaux avec surlignage des changements). */
function highlightSpeakerOneLine(line: string, searchRegex?: RegExp | null): string {
  if (line.trim() === "") return `<span class="cur-blank-line">¶</span>`;
  const m = line.match(/^([A-Z][A-Z0-9 _'.-]*)(: )/i);
  if (!m) return searchRegex ? highlightInText(line, searchRegex) : escapeHtml(line);
  const rest = line.slice(m[0].length);
  const tag = `<span class="cur-speaker-tag">${searchRegex ? highlightInText(m[1], searchRegex) : escapeHtml(m[1])}${escapeHtml(m[2])}</span>`;
  return tag + (searchRegex ? highlightInText(rest, searchRegex) : escapeHtml(rest));
}

/** Côté brut : tokens supprimés ou modifiés (sans les insertions propres au normalisé). */
function inlineLineDiffRaw(rawLine: string, cleanLine: string): string {
  const ops = tokenDiff(tokenize(rawLine), tokenize(cleanLine));
  return ops
    .filter((op) => op.type !== "ins")
    .map(({ type, text }) => {
      const t = escapeHtml(text);
      if (type === "del") return `<span class="cur-w-del">${t}</span>`;
      return t;
    })
    .join("");
}

/** Panneau brut (aperçu) : rouge = texte qui disparaît ou change. */
function buildRawHighlighted(raw: string, clean: string, searchRegex?: RegExp | null): string {
  const rawLines = raw.split("\n");
  const cleanLines = clean.split("\n");
  const maxLen = Math.max(rawLines.length, cleanLines.length);
  const out: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const r = rawLines[i];
    const c = cleanLines[i];
    if (r === undefined && c !== undefined) {
      out.push(`<span class="cur-blank-line">¶</span>`);
    } else if (c === undefined && r !== undefined) {
      out.push(
        `<span class="cur-w-del">${searchRegex ? highlightInText(r, searchRegex) : escapeHtml(r)}</span>`,
      );
    } else if (r !== undefined && c !== undefined) {
      if (r === c) out.push(highlightSpeakerOneLine(r, searchRegex));
      else if (!r && c) out.push(`<span class="cur-blank-line">¶</span>`);
      else out.push(inlineLineDiffRaw(r, c));
    }
  }
  return out.join("\n");
}

/** Panneau normalisé (aperçu) : vert = ajouts, rouge dans le diff inline = remplacements. */
function buildCleanHighlighted(raw: string, clean: string, searchRegex?: RegExp | null): string {
  const rawLines = raw.split("\n");
  const cleanLines = clean.split("\n");
  const maxLen = Math.max(rawLines.length, cleanLines.length);
  const out: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const r = rawLines[i];
    const c = cleanLines[i];
    if (r === undefined && c !== undefined) {
      out.push(`<span class="cur-w-ins">${searchRegex ? highlightInText(c, searchRegex) : escapeHtml(c)}</span>`);
    } else if (c === undefined && r !== undefined) {
      out.push(`<span class="cur-blank-line">¶</span>`);
    } else if (r !== undefined && c !== undefined) {
      if (r === c) out.push(highlightSpeakerOneLine(c, searchRegex));
      else if (!r && c) out.push(`<span class="cur-w-ins">${searchRegex ? highlightInText(c, searchRegex) : escapeHtml(c)}</span>`);
      else out.push(inlineLineDiff(r, c));
    }
  }
  return out.join("\n");
}

function renderCurationPreviewMode(
  panes: HTMLElement,
  data: { raw: string; clean: string },
  mode: string,
  epTitle: string,
  searchRegex?: RegExp | null,
  /** Fusion sous-titres : masque le surlignage mot à mot (trop de « faux » suppressions). */
  suppressInlineChangeHighlight = false,
) {
  const hasClean = !!data.clean && data.clean !== data.raw;

  const isPreview = _clientPreviewClean !== null;
  const previewTag = isPreview
    ? ` <span style="color:var(--warning,#f59e0b);font-size:0.6rem;font-style:italic">⟳ aperçu</span>`
    : "";
  const changeLegend =
    ` <span style="font-size:0.58rem;color:var(--text-muted);font-weight:400">· rouge = supprimé / modifié · vert = ajouté</span>`;
  if (mode === "side") {
    const cleanText = data.clean || data.raw;
    const previewDiff = cleanText !== data.raw && !suppressInlineChangeHighlight;
    const rawPaneHtml = previewDiff
      ? buildRawHighlighted(data.raw, cleanText, searchRegex)
      : renderRawText(data.raw, searchRegex);
    const cleanPaneHtml = previewDiff
      ? buildCleanHighlighted(data.raw, cleanText, searchRegex)
      : renderRawText(cleanText, searchRegex);
    panes.innerHTML = `
      <div class="cur-pane">
        <div class="cur-pane-head">Brut — ${escapeHtml(epTitle)}</div>
        <div class="cur-pane-text">${rawPaneHtml}</div>
      </div>
      <div class="cur-pane">
        <div class="cur-pane-head">Normalisé${hasClean ? " <span style='color:var(--accent);font-size:0.6rem'>● modifié</span>" : ""}${previewTag}${previewDiff ? changeLegend : suppressInlineChangeHighlight && cleanText !== data.raw ? ` <span style="font-size:0.58rem;color:var(--text-muted);font-weight:400">· fusion sous-titres : aperçu plein texte</span>` : ""}</div>
        <div class="cur-pane-text">${cleanPaneHtml}</div>
      </div>`;
  } else if (mode === "raw") {
    panes.innerHTML = `
      <div class="cur-pane">
        <div class="cur-pane-head">Texte brut — ${escapeHtml(epTitle)}</div>
        <div class="cur-pane-text">${renderRawText(data.raw, searchRegex)}</div>
      </div>`;
  } else if (mode === "diff") {
    const cleanText = data.clean || data.raw;
    const { html, nChanges } = buildDiffHtml(data.raw, cleanText, suppressInlineChangeHighlight);
    const totalLines = data.raw.split("\n").length;
    const diffTitle = suppressInlineChangeHighlight ? "Diff par ligne" : "Diff mot-à-mot";
    panes.innerHTML = `
      <div class="cur-pane" style="overflow:hidden;display:flex;flex-direction:column">
        <div class="cur-pane-head">${diffTitle} — ${escapeHtml(epTitle)}</div>
        <div class="cur-diff-summary">
          <strong>${nChanges}</strong> ligne(s) modifiée(s) sur ${totalLines}
          ${!hasClean ? ' <span style="color:var(--text-muted)">(pas encore normalisé)</span>' : ""}
        </div>
        <div class="cur-diff-view">${html}</div>
      </div>`;
  } else {
    // mode "clean"
    const cleanText = data.clean || data.raw;
    const previewDiff = cleanText !== data.raw && !suppressInlineChangeHighlight;
    const cleanPaneOnly = previewDiff
      ? buildCleanHighlighted(data.raw, cleanText, searchRegex)
      : renderRawText(cleanText, searchRegex);
    const notNormBanner = !hasClean
      ? `<div style="font-size:0.75rem;color:var(--text-muted);padding:4px 0 8px;font-style:italic">Texte non encore normalisé — cliquez ⚡ sur un épisode pour normaliser.</div>`
      : "";
    panes.innerHTML = `
      <div class="cur-pane">
        <div class="cur-pane-head">Normalisé — ${escapeHtml(epTitle)}${previewTag}${previewDiff ? changeLegend : suppressInlineChangeHighlight && cleanText !== data.raw ? ` <span style="font-size:0.58rem;color:var(--text-muted);font-weight:400">· fusion sous-titres : aperçu plein texte</span>` : ""}</div>
        ${notNormBanner}
        <div class="cur-pane-text">${cleanPaneOnly}</div>
      </div>`;
  }
}

/** P2-3 : Injecte les compteurs d'état dans les titres du hub. */
function updateHubStats(cnt: HTMLElement) {
  const episodes = _cachedEpisodes?.episodes ?? [];
  if (episodes.length === 0) return;

  const transcripts = episodes.map((ep) => ep.sources.find((s) => s.source_key === "transcript"));
  const nRaw        = transcripts.filter((t) => t?.available && (t.state === "raw" || t.state === "unknown")).length;
  const nNormalized = transcripts.filter((t) => t?.available && t.state === "normalized").length;
  const nSegmented  = transcripts.filter((t) => t?.available && t.state === "segmented").length;
  const nTotal      = transcripts.filter((t) => t?.available).length;
  const nWithSrt    = episodes.filter((ep) => ep.sources.some((s) => s.source_key.startsWith("srt_") && s.available)).length;

  const curStat   = cnt.querySelector<HTMLElement>("#hub-stat-cur");
  const segStat   = cnt.querySelector<HTMLElement>("#hub-stat-seg");
  const alignStat = cnt.querySelector<HTMLElement>("#hub-stat-align");

  if (curStat)   curStat.textContent   = nRaw > 0
    ? `${nRaw} brut${nRaw > 1 ? "s" : ""} · ${nNormalized} norm. · ${nSegmented} seg. / ${nTotal}`
    : `${nNormalized} norm. · ${nSegmented} seg. / ${nTotal}`;
  if (segStat)   segStat.textContent   = nNormalized > 0
    ? `${nNormalized} à segmenter · ${nSegmented} / ${nTotal}`
    : `${nSegmented} / ${nTotal} segmentés`;
  if (alignStat) alignStat.textContent = `${nWithSrt} avec SRT${nWithSrt > 1 ? "s" : ""} / ${nTotal}`;
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
    const data = await withNoDbRecovery(() =>
      measureAsync("constituer:load_episodes", fetchEpisodes),
    );
    _cachedEpisodes = data;

    const seriesEl = container.querySelector<HTMLElement>(".cons-toolbar-series");
    if (seriesEl) seriesEl.textContent = data.series_title ?? "";

    renderCurationEpList(container, data.episodes);

    const profileSel = container.querySelector<HTMLSelectElement>("#cur-profile");
    if (profileSel) renderCurationRuleChips(container);

    // P2-3 : mise à jour des stats hub
    updateHubStats(container);
  } catch (e) {
    const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
    if (epListEl) epListEl.innerHTML = `<div style="color:var(--danger);font-size:0.78rem">${escapeHtml(msg)}</div>`;
    const errEl2 = container.querySelector<HTMLElement>(".cons-error");
    if (errEl2) { errEl2.textContent = `Impossible de charger les épisodes : ${msg}`; errEl2.style.display = "block"; }
  }
}

// ── Section Documents ───────────────────────────────────────────────────────

function renderDocumentsSection(pane: HTMLElement) {
  pane.style.position = "relative"; // nécessaire pour le panneau absolument positionné
  pane.innerHTML = `
    <div class="cons-toolbar">
      <span class="cons-toolbar-title">Documents</span>
      <span class="docs-series-title" id="docs-series-title" style="font-size:0.78rem;color:var(--text-muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
      <select id="docs-season-sel" class="insp-select" style="font-size:0.78rem;padding:2px 6px">
        <option value="">Toutes les saisons</option>
      </select>
      <input class="cons-search" id="docs-search" type="search" placeholder="Filtrer…"
        style="font-size:0.8rem;padding:3px 8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);width:160px">
      <button class="btn btn-ghost btn-sm" id="docs-refresh">↺ Actualiser</button>
    </div>
    <div class="docs-stats-bar" id="docs-stats-bar"></div>
    <div class="cons-error" id="docs-error" style="display:none"></div>
    <div id="docs-list" style="flex:1;overflow-y:auto;min-height:0">
      <div class="cons-empty">Chargement…</div>
    </div>`;

  pane.querySelector<HTMLButtonElement>("#docs-refresh")!
    .addEventListener("click", () => loadDocuments(pane));

  pane.querySelector<HTMLInputElement>("#docs-search")!
    .addEventListener("input", () => renderDocumentsGrouped(pane));

  pane.querySelector<HTMLSelectElement>("#docs-season-sel")!
    .addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      _docsSeasonFilter = v ? parseInt(v, 10) : null;
      renderDocumentsGrouped(pane);
    });

  loadDocuments(pane);
}

async function loadDocuments(pane: HTMLElement) {
  const errEl = pane.querySelector<HTMLElement>("#docs-error");
  if (errEl) errEl.style.display = "none";
  try {
    _cachedEpisodes = await fetchEpisodes();
    // Peupler le sélecteur de saisons
    const sel = pane.querySelector<HTMLSelectElement>("#docs-season-sel");
    if (sel && _cachedEpisodes) {
      const seasons = [...new Set(_cachedEpisodes.episodes.map((e) => e.season))].sort((a, b) => a - b);
      const opts = seasons.map((s) => `<option value="${s}">Saison ${s}</option>`).join("");
      sel.innerHTML = `<option value="">Toutes les saisons</option>${opts}`;
      if (_docsSeasonFilter !== null) sel.value = String(_docsSeasonFilter);
    }
    // Titre de série
    const titleEl = pane.querySelector<HTMLElement>("#docs-series-title");
    if (titleEl && _cachedEpisodes?.series_title) titleEl.textContent = _cachedEpisodes.series_title;
    renderDocumentsGrouped(pane);
  } catch (e) {
    if (errEl) {
      errEl.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
      errEl.style.display = "block";
    }
  }
}

function renderDocumentsGrouped(pane: HTMLElement) {
  const list = pane.querySelector<HTMLElement>("#docs-list");
  if (!list || !_cachedEpisodes) return;

  // Stats bar (sur l'ensemble non filtré)
  const statsBar = pane.querySelector<HTMLElement>("#docs-stats-bar");
  if (statsBar) {
    let nRaw = 0, nNorm = 0, nSeg = 0, nMissing = 0;
    for (const ep of _cachedEpisodes.episodes) {
      const t = ep.sources.find((s) => s.source_key === "transcript");
      if (!t?.available) { nMissing++; continue; }
      if (t.state === "segmented")        nSeg++;
      else if (t.state === "normalized")  nNorm++;
      else                                nRaw++;
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

  // Filtres
  const q = (pane.querySelector<HTMLInputElement>("#docs-search")?.value ?? "").toLowerCase();
  let episodes = _cachedEpisodes.episodes;
  if (_docsSeasonFilter !== null) episodes = episodes.filter((ep) => ep.season === _docsSeasonFilter);
  if (q) episodes = episodes.filter((ep) =>
    ep.episode_id.toLowerCase().includes(q) || ep.title.toLowerCase().includes(q),
  );

  if (episodes.length === 0) {
    list.innerHTML = `<div class="cons-empty">${q || _docsSeasonFilter !== null ? "Aucun résultat." : "Aucun épisode dans ce projet."}</div>`;
    return;
  }

  // Grouper par saison
  const bySeasonMap = new Map<number, typeof episodes>();
  for (const ep of episodes) {
    if (!bySeasonMap.has(ep.season)) bySeasonMap.set(ep.season, []);
    bySeasonMap.get(ep.season)!.push(ep);
  }
  const seasons = [...bySeasonMap.keys()].sort((a, b) => a - b);
  const srtLangs = collectSrtLangs(episodes);

  list.innerHTML = "";
  for (const season of seasons) {
    const eps = bySeasonMap.get(season)!;
    const group = document.createElement("div");
    group.className = "docs-season-group";
    group.dataset.season = String(season);

    // Header saison
    const header = document.createElement("div");
    header.className = "docs-season-header";
    header.innerHTML = `
      <span class="docs-season-caret">▾</span>
      <span>Saison ${season}</span>
      <span class="docs-season-count">${eps.length} épisode${eps.length > 1 ? "s" : ""}</span>`;
    header.addEventListener("click", () => group.classList.toggle("collapsed"));

    // Body
    const body = document.createElement("div");
    body.className = "docs-season-body";

    for (const ep of eps) {
      const transcript = sourceForKey(ep, "transcript");
      const srtBadges = srtLangs.map((lang) => {
        const src = sourceForKey(ep, `srt_${lang}`);
        return src?.available
          ? stateBadge(src)
          : `<span class="cons-badge absent" title="SRT ${lang.toUpperCase()} absent">${lang.toUpperCase()}</span>`;
      }).join("");

      const row = document.createElement("div");
      row.className = `docs-ep-row${_docsPanelEpId === ep.episode_id ? " active" : ""}`;
      row.dataset.epId = ep.episode_id;
      row.innerHTML = `
        <span class="docs-ep-id">${escapeHtml(ep.episode_id)}</span>
        <span class="docs-ep-title" title="${escapeHtml(ep.title)}">${escapeHtml(ep.title) || "<em style='color:var(--text-muted)'>sans titre</em>"}</span>
        <span class="docs-ep-badges">
          ${transcript?.available ? stateBadge(transcript) : `<span class="cons-badge absent">—</span>`}
          ${srtBadges}
        </span>
        <span class="docs-ep-arrow">›</span>`;
      row.addEventListener("click", () => openDocPanel(ep, pane));
      body.appendChild(row);
    }

    group.appendChild(header);
    group.appendChild(body);
    list.appendChild(group);
  }
}

// ── Panneau latéral Documents ────────────────────────────────────────────────

function closeDocPanel(pane: HTMLElement) {
  _docsPanelEpId = null;
  pane.querySelector(".docs-panel-backdrop")?.remove();
  pane.querySelector(".docs-panel")?.remove();
  pane.querySelectorAll<HTMLElement>(".docs-ep-row.active")
    .forEach((r) => r.classList.remove("active"));
}

function openDocPanel(ep: Episode, pane: HTMLElement) {
  // Fermer si re-clic sur le même épisode
  if (_docsPanelEpId === ep.episode_id) { closeDocPanel(pane); return; }
  closeDocPanel(pane);
  _docsPanelEpId = ep.episode_id;

  // Marquer la ligne active
  pane.querySelector<HTMLElement>(`.docs-ep-row[data-ep-id="${ep.episode_id}"]`)
    ?.classList.add("active");

  // Backdrop (ferme le panel au clic)
  const backdrop = document.createElement("div");
  backdrop.className = "docs-panel-backdrop";
  backdrop.addEventListener("click", () => closeDocPanel(pane));

  // Panel
  const panel = document.createElement("div");
  panel.className = "docs-panel";
  renderDocPanel(ep, panel, pane);

  pane.appendChild(backdrop);
  pane.appendChild(panel);
}

function renderDocPanel(ep: Episode, panel: HTMLElement, pane: HTMLElement) {
  const onRefresh = async () => {
    await loadDocuments(pane);
    // Ré-ouvrir le panel avec les données fraîches
    const fresh = _cachedEpisodes?.episodes.find((e) => e.episode_id === ep.episode_id);
    if (fresh) renderDocPanel(fresh, panel, pane);
    else closeDocPanel(pane);
  };

  const srtLangs = _cachedEpisodes ? collectSrtLangs(_cachedEpisodes.episodes) : [];

  panel.innerHTML = `
    <div class="docs-panel-head">
      <span class="docs-panel-ep-id">${escapeHtml(ep.episode_id)}</span>
      <span class="docs-panel-title">${escapeHtml(ep.title) || "—"}</span>
      <button class="docs-panel-close" id="docs-panel-close" title="Fermer">✕</button>
    </div>
    <div class="docs-panel-body">

      <!-- Métadonnées -->
      <div>
        <div class="docs-panel-section-head">Métadonnées</div>
        <div class="docs-panel-field">
          <span class="docs-panel-lbl">ID</span>
          <span class="docs-panel-val">${escapeHtml(ep.episode_id)}</span>
        </div>
        <div class="docs-panel-field">
          <span class="docs-panel-lbl">Saison · Ép.</span>
          <span class="docs-panel-val">S${String(ep.season).padStart(2,"0")} · E${String(ep.episode).padStart(2,"0")}</span>
        </div>
        <div class="docs-panel-field" style="align-items:flex-start">
          <span class="docs-panel-lbl" style="padding-top:4px">Titre</span>
          <div style="flex:1">
            <div class="docs-edit-row">
              <input class="docs-edit-input" id="docs-edit-title" type="text" value="${escapeHtml(ep.title)}" placeholder="Titre de l'épisode">
              <button class="btn btn-ghost btn-sm" id="docs-save-title">✓</button>
            </div>
            <div id="docs-title-fb" style="font-size:0.72rem;min-height:1em;margin-top:2px;color:var(--text-muted)"></div>
          </div>
        </div>
      </div>

      <!-- Sources -->
      <div>
        <div class="docs-panel-section-head">Sources</div>
        <div id="docs-panel-sources"></div>
      </div>

    </div>`;

  // Fermeture
  panel.querySelector<HTMLButtonElement>("#docs-panel-close")!
    .addEventListener("click", () => closeDocPanel(pane));

  // Édition titre
  const titleInput = panel.querySelector<HTMLInputElement>("#docs-edit-title")!;
  const titleFb    = panel.querySelector<HTMLElement>("#docs-title-fb")!;
  panel.querySelector<HTMLButtonElement>("#docs-save-title")!
    .addEventListener("click", async () => {
      const newTitle = titleInput.value.trim();
      if (newTitle === ep.title) return;
      titleFb.textContent = "Enregistrement…";
      titleFb.style.color = "var(--text-muted)";
      try {
        const idx = await fetchSeriesIndex();
        const updated = idx.episodes.map((e) =>
          e.episode_id === ep.episode_id ? { ...e, title: newTitle } : e,
        );
        await saveSeriesIndex({ ...idx, episodes: updated });
        titleFb.textContent = "✓ Sauvegardé";
        titleFb.style.color = "var(--success, #16a34a)";
        ep = { ...ep, title: newTitle };
        panel.querySelector<HTMLElement>(".docs-panel-title")!.textContent = newTitle || "—";
        setTimeout(() => { titleFb.textContent = ""; }, 2000);
        _cachedEpisodes = null; // invalider le cache
      } catch (e) {
        titleFb.textContent = formatApiError(e);
        titleFb.style.color = "var(--danger, #dc2626)";
      }
    });
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") panel.querySelector<HTMLButtonElement>("#docs-save-title")!.click();
  });

  // Sources
  const sourcesEl = panel.querySelector<HTMLElement>("#docs-panel-sources")!;
  const allSrtSources = srtLangs.map((lang) => sourceForKey(ep, `srt_${lang}`));
  const hasTranscript = sourceForKey(ep, "transcript");

  // Transcript
  renderDocPanelSource(
    sourcesEl, ep, "transcript",
    hasTranscript ?? null, pane, onRefresh,
  );

  // SRT connus
  for (const lang of srtLangs) {
    renderDocPanelSource(
      sourcesEl, ep, `srt_${lang}`,
      allSrtSources[srtLangs.indexOf(lang)] ?? null, pane, onRefresh,
    );
  }

  // Bouton "Importer nouveau SRT" (toute langue)
  const importSrtRow = document.createElement("div");
  importSrtRow.className = "docs-source-row";
  importSrtRow.style.borderBottom = "none";
  const srtLangInput = document.createElement("input");
  srtLangInput.type = "text"; srtLangInput.value = "fr"; srtLangInput.placeholder = "ex: fr, en";
  srtLangInput.className = "docs-edit-input";
  srtLangInput.style.cssText = "width:60px;margin-right:4px";
  const importSrtBtn = document.createElement("button");
  importSrtBtn.className = "btn btn-secondary btn-sm";
  importSrtBtn.textContent = "🔤 Importer SRT";
  const newSrtFb = document.createElement("div");
  newSrtFb.style.cssText = "font-size:0.72rem;min-height:1em;margin-top:4px;color:var(--danger,#dc2626)";
  importSrtBtn.addEventListener("click", async () => {
    const lang = srtLangInput.value.trim();
    if (!lang) return;
    importSrtBtn.disabled = true;
    importSrtBtn.textContent = "…";
    newSrtFb.textContent = "";
    const resetBtn = () => {
      importSrtBtn.disabled = false;
      importSrtBtn.textContent = "🔤 Importer SRT";
    };
    await handleImportSrt(ep.episode_id, lang, onRefresh, (msg) => {
      newSrtFb.textContent = msg;
      resetBtn();
    });
    // Réactiver si le dialog a été annulé (onDone/onError non appelés)
    if (importSrtBtn.isConnected) resetBtn();
  });
  importSrtRow.innerHTML = `<div class="docs-panel-section-head" style="margin-bottom:4px">Nouvelle piste SRT</div>`;
  const row = document.createElement("div");
  row.className = "docs-source-actions";
  row.appendChild(srtLangInput);
  row.appendChild(importSrtBtn);
  importSrtRow.appendChild(row);
  importSrtRow.appendChild(newSrtFb);
  sourcesEl.appendChild(importSrtRow);
}

function renderDocPanelSource(
  container: HTMLElement,
  ep: Episode,
  sourceKey: string,
  src: EpisodeSource | null,
  pane: HTMLElement,
  onRefresh: () => void,
) {
  const row = document.createElement("div");
  row.className = "docs-source-row";

  const keyLabel = document.createElement("div");
  keyLabel.style.display = "flex"; keyLabel.style.alignItems = "center"; keyLabel.style.gap = "6px";
  const keyEl = document.createElement("span");
  keyEl.className = "docs-source-key";
  keyEl.textContent = sourceKey;
  keyLabel.appendChild(keyEl);
  if (src?.available) keyLabel.appendChild((() => { const el = document.createElement("span"); el.innerHTML = stateBadge(src); return el.firstChild as Node; })());
  else {
    const absent = document.createElement("span"); absent.className = "cons-badge absent"; absent.textContent = "absent";
    keyLabel.appendChild(absent);
  }
  row.appendChild(keyLabel);

  const actions = document.createElement("div");
  actions.className = "docs-source-actions";

  if (src?.available) {
    // N-1 : remplace "→ Inspecter" par "→ Curation" avec pré-sélection épisode (N-2)
    const inspBtn = document.createElement("button");
    inspBtn.className = "btn btn-secondary btn-sm";
    inspBtn.textContent = "→ Curation";
    inspBtn.title = "Ouvrir dans la sous-vue Curation (Constituer)";
    inspBtn.addEventListener("click", () => {
      // Stocker l'épisode cible pour l'auto-sélection dans loadAndRender (N-2)
      _pendingCurationEpisodeId = ep.episode_id;
      // Naviguer vers la sous-vue Curation en cliquant sur le link de nav
      const root = inspBtn.closest(".cons-root") ?? inspBtn.getRootNode() as HTMLElement;
      const curationLink = root.querySelector<HTMLButtonElement>('.cons-nav-tree-link[data-subview="curation"]');
      if (curationLink) {
        curationLink.click();
      }
    });
    actions.appendChild(inspBtn);

    // Supprimer
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-ghost btn-sm";
    delBtn.title = `Supprimer ${sourceKey}`;
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", async () => {
      const what = sourceKey === "transcript" ? "le transcript" : `la piste ${sourceKey}`;
      if (!confirm(`Supprimer ${what} de « ${ep.episode_id} » ? (irréversible)`)) return;
      try {
        if (sourceKey === "transcript") await deleteTranscript(ep.episode_id);
        else await deleteSrt(ep.episode_id, sourceKey.replace("srt_", ""));
        onRefresh();
      } catch (e) { alert(formatApiError(e)); }
    });
    actions.appendChild(delBtn);
  } else if (sourceKey === "transcript") {
    // ⬇ Télécharger depuis Subslikescript (si URL connue)
    if (ep.url && ep.url.includes("subslikescript")) {
      const slBtn = document.createElement("button");
      slBtn.className = "btn btn-primary btn-sm";
      slBtn.textContent = "⬇ Subslikescript";
      slBtn.title = ep.url;
      slBtn.addEventListener("click", async () => {
        slBtn.disabled = true;
        slBtn.textContent = "…";
        try {
          const res = await fetchSubslikescriptTranscript(ep.episode_id, ep.url!);
          slBtn.textContent = "✓";
          setTimeout(onRefresh, 300);
          void res;
        } catch (e) {
          slBtn.disabled = false;
          slBtn.textContent = "⬇ Subslikescript";
          alert(formatApiError(e));
        }
      });
      actions.appendChild(slBtn);
    }
    // Importer depuis fichier local
    const impBtn = document.createElement("button");
    impBtn.className = "btn btn-secondary btn-sm";
    impBtn.textContent = "📄 Fichier local";
    impBtn.addEventListener("click", () => handleImportTranscript(ep.episode_id, onRefresh, (msg) => alert(msg)));
    actions.appendChild(impBtn);
  } else if (sourceKey.startsWith("srt_")) {
    // Piste SRT connue mais absente pour cet épisode — bouton d'import direct
    const lang = sourceKey.slice(4);
    const impSrtBtn = document.createElement("button");
    impSrtBtn.className = "btn btn-secondary btn-sm";
    impSrtBtn.textContent = "📁 Importer";
    impSrtBtn.addEventListener("click", async () => {
      impSrtBtn.disabled = true;
      impSrtBtn.textContent = "…";
      await handleImportSrt(ep.episode_id, lang, onRefresh, (msg) => {
        impSrtBtn.disabled = false;
        impSrtBtn.textContent = "📁 Importer";
        alert(msg);
      });
    });
    actions.appendChild(impSrtBtn);
  }

  if (actions.childElementCount > 0) row.appendChild(actions);
  container.appendChild(row);
}

// ── Section Importer ────────────────────────────────────────────────────────

function renderImporterSection(pane: HTMLElement) {
  pane.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1rem;padding:1.25rem;overflow-y:auto;height:100%">
      <!-- Métadonnées projet (identité corpus — la découverte d’épisodes est dans Sources web) -->
      <div class="cons-card">
        <div class="cons-card-title">Projet</div>
        <div style="font-size:0.76rem;color:var(--text-muted);margin:-4px 0 2px">Nom, langues, dossier — pas le choix de la source de données.</div>
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
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
            <label style="font-size:0.8rem;color:var(--text-muted);min-width:90px">Langue SRT</label>
            <input id="imp-srt-lang" type="text" value="fr" placeholder="ex: fr, en, it"
              style="width:80px;padding:3px 7px;font-size:0.82rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text)">
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="imp-transcript-btn">📄 Importer transcript</button>
            <button class="btn btn-secondary btn-sm" id="imp-srt-btn">🔤 Importer SRT</button>
          </div>
          <div id="imp-feedback" style="font-size:0.78rem;color:var(--text-muted);min-height:1.2em"></div>
        </div>
      </div>
      <!-- Sources web (MX-021b) — point d’entrée principal pour structure + transcripts -->
      <div class="cons-card">
        <div class="cons-card-title">Sources web</div>
        <div class="cons-card-body" id="web-src-body">
          <p style="margin:0 0 10px;font-size:0.8rem;color:var(--text-muted);line-height:1.35">
            Découvrir la série, enregistrer la <strong>structure d’épisodes</strong> et importer des <strong>transcripts</strong> (TVMaze ou Subslikescript).
          </p>
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

interface NormalizeOptions {
  merge_subtitle_breaks: boolean;
  fix_double_spaces: boolean;
  fix_french_punctuation: boolean;
  fix_english_punctuation: boolean;
  normalize_apostrophes: boolean;
  normalize_quotes: boolean;
  strip_line_spaces: boolean;
  strip_empty_lines: boolean;
  case_transform: string;
}

const NORMALIZE_PROFILES: Array<{ id: string; label: string; options: NormalizeOptions }> = [
  { id: "default_en_v1",   label: "default_en_v1 — Anglais standard",
    options: { merge_subtitle_breaks: true,  fix_double_spaces: true,  fix_french_punctuation: false,
               fix_english_punctuation: false, normalize_apostrophes: false, normalize_quotes: false,
               strip_line_spaces: true,  strip_empty_lines: false, case_transform: "none" } },
  { id: "default_fr_v1",   label: "default_fr_v1 — Français standard",
    options: { merge_subtitle_breaks: true,  fix_double_spaces: true,  fix_french_punctuation: true,
               fix_english_punctuation: false, normalize_apostrophes: true,  normalize_quotes: false,
               strip_line_spaces: true,  strip_empty_lines: false, case_transform: "none" } },
  { id: "conservative_v1", label: "conservative_v1 — Conservateur",
    options: { merge_subtitle_breaks: true,  fix_double_spaces: true,  fix_french_punctuation: false,
               fix_english_punctuation: false, normalize_apostrophes: false, normalize_quotes: false,
               strip_line_spaces: true,  strip_empty_lines: false, case_transform: "none" } },
  { id: "aggressive_v1",   label: "aggressive_v1 — Agressif",
    options: { merge_subtitle_breaks: true,  fix_double_spaces: true,  fix_french_punctuation: false,
               fix_english_punctuation: false, normalize_apostrophes: false, normalize_quotes: false,
               strip_line_spaces: true,  strip_empty_lines: true,  case_transform: "lowercase" } },
];

/** Libellé pour la métadonnée `source_id` (remplie automatiquement depuis Sources web, pas éditable ici). */
function formatStoredSourceMeta(id: string): string {
  if (!id) return "— (après « Enregistrer la structure » dans Sources web)";
  if (id === "tvmaze") return "TVMaze";
  if (id === "subslikescript") return "Subslikescript";
  return id;
}

type SeriesIndexForImporter = Awaited<ReturnType<typeof fetchSeriesIndex>>;

async function loadImporterConfig(pane: HTMLElement) {
  const body = pane.querySelector<HTMLElement>("#imp-config-body");
  if (!body) return;
  body.innerHTML = `<div class="cons-loading" style="padding:8px 0">Chargement…</div>`;
  try {
    const cfg = await fetchConfig();
    _cachedConfig = cfg;
    let seriesIndex: SeriesIndexForImporter;
    try {
      seriesIndex = await fetchSeriesIndex();
    } catch {
      seriesIndex = { series_title: "", series_url: "", episodes: [] };
    }
    renderConfigForm(body, cfg, pane, seriesIndex);
  } catch (e) {
    const errDiv = document.createElement("div");
    errDiv.style.cssText = "color:var(--danger);font-size:0.82rem";
    errDiv.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
    body.innerHTML = "";
    body.appendChild(errDiv);
  }
}

function renderConfigForm(
  body: HTMLElement,
  cfg: ConfigResponse,
  pane: HTMLElement,
  seriesIndex: SeriesIndexForImporter,
) {
  const nIdxEp = seriesIndex.episodes?.length ?? 0;
  const idxTitle = (seriesIndex.series_title || "").trim();
  const hasIdx = nIdxEp > 0 || idxTitle.length > 0;
  const idxSummary = hasIdx
    ? `<div class="cfg-index-summary">
        <strong>Index série enregistré</strong> — ${escapeHtml(idxTitle || "—")}
        ${seriesIndex.series_url ? ` <span>· ${escapeHtml(seriesIndex.series_url)}</span>` : ""}
        <span> · ${nIdxEp} épisode${nIdxEp > 1 ? "s" : ""}</span>
      </div>`
    : `<div class="cfg-index-summary cfg-index-muted">
        Pas encore d’index série. Utilisez la section <strong>Sources web</strong> ci-dessous pour découvrir la série et créer les dossiers d’épisodes.
      </div>`;

  const mergedSeriesUrl = (cfg.series_url || "").trim() || (seriesIndex.series_url || "").trim();

  body.innerHTML = `
    <div class="cfg-form">
      ${idxSummary}
      <div class="cfg-row">
        <span class="cfg-label">Nom du projet</span>
        <input class="cfg-input" id="cfg-project-name" type="text" value="${escapeHtml(cfg.project_name)}" />
      </div>
      <div class="cfg-row">
        <span class="cfg-label" title="Renseignée automatiquement quand vous enregistrez la structure depuis Sources web.">Origine</span>
        <span class="cfg-muted-inline">${escapeHtml(formatStoredSourceMeta(cfg.source_id))}</span>
      </div>
      <div class="cfg-row" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;width:100%">
          <span class="cfg-label">URL page série</span>
          <input class="cfg-input" id="cfg-series-url" type="text" value="${escapeHtml(mergedSeriesUrl)}" placeholder="Subslikescript : URL de la page série · TVMaze : souvent vide (recherche en dessous)" />
        </div>
        <div class="cfg-hint">
          Valeur aussi stockée dans l’<strong>index série</strong> lorsque vous enregistrez la structure via Sources web (les deux restent synchronisés si vous enregistrez depuis cette page).
          Pour TVMaze, l’URL n’est pas saisie ici : elle provient de la découverte puis de « Enregistrer la structure ».
        </div>
      </div>
      <div class="cfg-row" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;width:100%">
          <span class="cfg-label" title="Langues du corpus (pivot, traductions)">Langues du corpus</span>
          <input class="cfg-input" id="cfg-languages" type="text" value="${escapeHtml(cfg.languages.join(", "))}" placeholder="en, fr, it…" />
        </div>
        <div class="cfg-hint">
          Indépendant du champ <strong>Langue SRT</strong> dans « Importer des fichiers locaux » (langue du fichier importé).
        </div>
      </div>
      <div class="cfg-row">
        <span class="cfg-label">Normalisation</span>
        <span class="cfg-muted-inline"><code>${escapeHtml(cfg.normalize_profile)}</code> — réglage dans l’onglet <strong>Actions</strong></span>
      </div>
      <div class="cfg-row" style="justify-content:flex-end;gap:6px">
        <span class="cfg-feedback" id="cfg-feedback"></span>
        <button class="btn btn-primary btn-sm" id="cfg-save-btn">Enregistrer</button>
      </div>
      <div class="cfg-path">
        <span class="cfg-path-label">Dossier projet (ouvert depuis le Hub / le démarrage)</span>
        📁 ${escapeHtml(cfg.project_path)}
      </div>
    </div>`;

  const feedback = body.querySelector<HTMLElement>("#cfg-feedback")!;
  body.querySelector<HTMLButtonElement>("#cfg-save-btn")!
    .addEventListener("click", async () => {
      feedback.textContent = "Enregistrement…";
      feedback.style.color = "var(--text-muted)";
      const update: ConfigUpdate = {
        project_name: (body.querySelector<HTMLInputElement>("#cfg-project-name")!.value),
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
    }).catch((err) => {
      const opt = document.createElement("option");
      opt.textContent = err instanceof ApiError ? err.errorCode : "Erreur chargement";
      epSel.innerHTML = "";
      epSel.appendChild(opt);
    });
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

function renderSubslikeBatchUI(episodes: WebEpisodeRef[]): string {
  if (episodes.length === 0) return `<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:0.82rem">Aucun épisode trouvé.</div>`;
  const rows = episodes.map((ep) => `
    <tr class="sl-ep-row" data-ep-id="${escapeHtml(ep.episode_id)}">
      <td style="padding:3px 6px"><input type="checkbox" class="sl-ep-check" data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-url="${escapeHtml(ep.url)}" checked></td>
      <td style="white-space:nowrap">${escapeHtml(ep.episode_id)}</td>
      <td>${escapeHtml(ep.title)}</td>
      <td class="sl-ep-status" style="white-space:nowrap;font-size:0.78rem;color:var(--text-muted)"></td>
    </tr>`).join("");
  return `
    <div class="sl-batch-toolbar" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.82rem">
        <input type="checkbox" id="sl-check-all" checked> Tout sélectionner
      </label>
      <span id="sl-sel-count" style="color:var(--text-muted);font-size:0.82rem">${episodes.length} épisodes sélectionnés</span>
      <button class="btn btn-primary btn-sm" id="sl-batch-btn" style="margin-left:auto">⬇ Télécharger la sélection (${episodes.length})</button>
    </div>
    <div style="overflow-x:auto;max-height:320px;overflow-y:auto">
      <table style="width:100%">
        <thead><tr><th></th><th>ID</th><th>Titre</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function wireSubslikeBatchUI(
  container: HTMLElement,
  setFeedback: (msg: string, ok?: boolean) => void,
) {
  const checkAll  = container.querySelector<HTMLInputElement>("#sl-check-all");
  if (!checkAll) return; // aucun épisode à afficher;
  const selCount  = container.querySelector<HTMLElement>("#sl-sel-count")!;
  const batchBtn  = container.querySelector<HTMLButtonElement>("#sl-batch-btn");
  if (!batchBtn) return;
  const allChecks = () => Array.from(container.querySelectorAll<HTMLInputElement>(".sl-ep-check"));

  const updateCount = () => {
    const n = allChecks().filter((c) => c.checked).length;
    selCount.textContent = `${n} épisode${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""}`;
    batchBtn.textContent = `⬇ Télécharger la sélection (${n})`;
    batchBtn.disabled = n === 0;
    checkAll.indeterminate = n > 0 && n < allChecks().length;
    checkAll.checked = n === allChecks().length;
  };

  checkAll.addEventListener("change", () => {
    allChecks().forEach((c) => { c.checked = checkAll.checked; });
    updateCount();
  });
  allChecks().forEach((c) => c.addEventListener("change", updateCount));

  batchBtn.addEventListener("click", async () => {
    const selected = allChecks().filter((c) => c.checked);
    if (selected.length === 0) { setFeedback("Aucun épisode sélectionné.", false); return; }
    batchBtn.disabled = true;
    let ok = 0, fail = 0;
    for (let i = 0; i < selected.length; i++) {
      const chk   = selected[i];
      const epId  = chk.dataset.epId!;
      const epUrl = chk.dataset.epUrl!;
      const row   = container.querySelector<HTMLElement>(`.sl-ep-row[data-ep-id="${window.CSS.escape(epId)}"]`);
      const statusEl = row?.querySelector<HTMLElement>(".sl-ep-status");
      setFeedback(`Téléchargement ${i + 1}/${selected.length} : ${epId}…`);
      if (statusEl) { statusEl.textContent = "…"; statusEl.style.color = "var(--text-muted)"; }
      try {
        const res = await fetchSubslikescriptTranscript(epId, epUrl);
        if (statusEl) { statusEl.textContent = `✓ ${res.chars} chars`; statusEl.style.color = "var(--success,#16a34a)"; }
        chk.checked = false;
        ok++;
      } catch (e) {
        if (statusEl) {
          statusEl.textContent = "✗";
          statusEl.style.color = "var(--danger,#dc2626)";
          statusEl.title = e instanceof Error ? e.message : String(e);
        }
        fail++;
      }
      updateCount();
      if (i < selected.length - 1) await new Promise<void>((r) => setTimeout(r, 1500));
    }
    _cachedEpisodes = null;
    batchBtn.disabled = false;
    setFeedback(
      `Terminé — ${ok} importé${ok > 1 ? "s" : ""}${fail > 0 ? `, ${fail} erreur${fail > 1 ? "s" : ""}` : ""}.`,
      fail === 0,
    );
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
        () => { setFeedback(`Transcript importé pour ${epId}.`); _cachedEpisodes = null; _tradViewMounted = false; },
        (msg) => setFeedback(msg, false),
      );
    });

  pane.querySelector<HTMLButtonElement>("#imp-srt-btn")!
    .addEventListener("click", async () => {
      const epId = pane.querySelector<HTMLSelectElement>("#imp-ep-select")!.value;
      if (!epId) { setFeedback("Sélectionnez un épisode.", false); return; }
      const lang = pane.querySelector<HTMLInputElement>("#imp-srt-lang")!.value.trim();
      if (!lang) { setFeedback("Saisissez un code langue (ex: fr, en).", false); return; }
      await handleImportSrt(
        epId, lang,
        () => { setFeedback(`SRT ${lang} importé pour ${epId}.`); _cachedEpisodes = null; _tradViewMounted = false; },
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

  let _tvLastData: import("../api").WebDiscoverResult | null = null;

  pane.querySelector<HTMLButtonElement>("#tvmaze-search-btn")!
    .addEventListener("click", async () => {
      const name = tvInput.value.trim();
      if (!name) { setTvFeedback("Saisissez un nom de série.", false); return; }
      setTvFeedback("Recherche en cours…");
      tvResults.style.display = "none";
      _tvLastData = null;
      try {
        const data = await discoverTvmaze(name);
        _tvLastData = data;
        setTvFeedback(`${data.series_title} — ${data.episode_count} épisodes.`);
        tvResults.style.display = "block";
        tvResults.innerHTML =
          renderWebEpisodesTable(data.episodes, false) +
          `<div style="margin-top:8px"><button class="btn btn-primary btn-sm" id="tvmaze-save-btn">✓ Enregistrer la structure (${data.episode_count} épisodes)</button></div>`;
        pane.querySelector<HTMLButtonElement>("#tvmaze-save-btn")!
          .addEventListener("click", async () => {
            if (!_tvLastData) return;
            try {
              const r = await saveSeriesIndex({ series_title: _tvLastData.series_title, series_url: _tvLastData.series_url, episodes: _tvLastData.episodes });
              try {
                await saveConfig({ series_url: _tvLastData.series_url, source_id: "tvmaze" });
                _cachedConfig = await fetchConfig();
              } catch (syncErr) {
                setTvFeedback(
                  `Index enregistré ; synchro métadonnées projet impossible : ${syncErr instanceof ApiError ? syncErr.message : String(syncErr)}`,
                  false,
                );
                await loadImporterConfig(pane);
                return;
              }
              setTvFeedback(`✓ Structure enregistrée — ${r.saved} épisodes, ${r.dirs_created.length} répertoires créés.`);
              await loadImporterConfig(pane);
            } catch (e) {
              setTvFeedback(e instanceof ApiError ? e.message : String(e), false);
            }
          });
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

  let _slLastData: import("../api").WebDiscoverResult | null = null;

  pane.querySelector<HTMLButtonElement>("#subslike-discover-btn")!
    .addEventListener("click", async () => {
      const url = slInput.value.trim();
      if (!url) { setSlFeedback("Saisissez l'URL de la série.", false); return; }
      setSlFeedback("Découverte en cours…");
      slResults.style.display = "none";
      _slLastData = null;
      try {
        const data = await discoverSubslikescript(url);
        _slLastData = data;
        setSlFeedback(`${data.series_title} — ${data.episode_count} épisodes.`);
        slResults.style.display = "block";
        slResults.innerHTML =
          renderSubslikeBatchUI(data.episodes) +
          `<div style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="subslike-save-btn">✓ Enregistrer la structure (${data.episode_count} épisodes)</button></div>`;
        wireSubslikeBatchUI(slResults, setSlFeedback);
        pane.querySelector<HTMLButtonElement>("#subslike-save-btn")!
          .addEventListener("click", async () => {
            if (!_slLastData) return;
            try {
              const r = await saveSeriesIndex({ series_title: _slLastData.series_title, series_url: _slLastData.series_url, episodes: _slLastData.episodes });
              try {
                await saveConfig({ series_url: _slLastData.series_url, source_id: "subslikescript" });
                _cachedConfig = await fetchConfig();
              } catch (syncErr) {
                setSlFeedback(
                  `Index enregistré ; synchro métadonnées projet impossible : ${syncErr instanceof ApiError ? syncErr.message : String(syncErr)}`,
                  false,
                );
                await loadImporterConfig(pane);
                return;
              }
              setSlFeedback(`✓ Structure enregistrée — ${r.saved} épisodes, ${r.dirs_created.length} répertoires créés.`);
              await loadImporterConfig(pane);
            } catch (e) {
              setSlFeedback(e instanceof ApiError ? e.message : String(e), false);
            }
          });
      } catch (e) {
        setSlFeedback(e instanceof ApiError ? e.message : String(e), false);
      }
    });

  slInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pane.querySelector<HTMLButtonElement>("#subslike-discover-btn")!.click();
  });
}

function seasonsSorted(episodes: Episode[]): number[] {
  const s = new Set<number>();
  for (const ep of episodes) {
    if (typeof ep.season === "number" && Number.isFinite(ep.season)) s.add(ep.season);
  }
  return Array.from(s).sort((a, b) => a - b);
}

function filterEpisodesBySeasonAndSearch(episodes: Episode[], seasonVal: string, q: string): Episode[] {
  const qq = q.trim().toLowerCase();
  const all = seasonVal === "all" || seasonVal === "";
  const sn = parseInt(seasonVal, 10);
  return episodes.filter((ep) => {
    if (!all && !(Number.isFinite(sn) && ep.season === sn)) return false;
    if (!qq) return true;
    const hay = `${ep.episode_id} ${ep.title ?? ""}`.toLowerCase();
    return hay.includes(qq);
  });
}

function debounceEpListFilter(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function fillSeasonOptions(sel: HTMLSelectElement, episodes: Episode[], previousValue: string) {
  const seasons = seasonsSorted(episodes);
  const opts = [`<option value="all">Toutes les saisons</option>`].concat(
    seasons.map((s) => `<option value="${s}">Saison ${s}</option>`),
  );
  sel.innerHTML = opts.join("");
  const valid = previousValue === "all" || seasons.includes(Number(previousValue));
  sel.value = valid ? previousValue : "all";
}

/**
 * Rend le volet liste-épisodes rétractable.
 * Mémorise l'état dans localStorage (clé = `acts-ep-collapse-${listId}`).
 * À appeler une seule fois par volet (garde interne sur `data-collapseWired`).
 */
function wireEpListCollapse(container: HTMLElement, listId: string) {
  const list = container.querySelector<HTMLElement>(`#${listId}`);
  if (!list || list.dataset.collapseWired === "1") return;
  list.dataset.collapseWired = "1";

  const btn = list.querySelector<HTMLButtonElement>(".acts-ep-collapse-btn");
  if (!btn) return;

  const collapseKey = lsKey(`acts-ep-collapse-${listId}`);
  let collapsed = localStorage.getItem(collapseKey) === "1";

  const apply = () => {
    list.classList.toggle("acts-ep-list--collapsed", collapsed);
    btn.textContent  = collapsed ? "›" : "‹";
    btn.title        = collapsed ? "Afficher la liste des épisodes" : "Réduire la liste";
    btn.setAttribute("aria-expanded", String(!collapsed));
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    localStorage.setItem(collapseKey, collapsed ? "1" : "0");
    apply();
  });

  apply(); // restore persisted state
}

function wireSegEpListFilters(container: HTMLElement) {
  const root = container.querySelector<HTMLElement>("#seg-acts-ep-list");
  wireEpListCollapse(container, "seg-acts-ep-list");
  if (!root || root.dataset.filterWired === "1") return;
  const season = container.querySelector<HTMLSelectElement>("#seg-ep-season");
  const search = container.querySelector<HTMLInputElement>("#seg-ep-search");
  if (!season || !search) return;
  root.dataset.filterWired = "1";
  const go = () => renderSegmentationPane(container, _segEpisodesAll);
  season.addEventListener("change", go);
  search.addEventListener("input", debounceEpListFilter(go, 200));
}

function wireAlignEpListFilters(container: HTMLElement) {
  const root = container.querySelector<HTMLElement>("#align-acts-ep-list");
  wireEpListCollapse(container, "align-acts-ep-list");
  if (!root || root.dataset.filterWired === "1") return;
  const season = container.querySelector<HTMLSelectElement>("#align-ep-season");
  const search = container.querySelector<HTMLInputElement>("#align-ep-search");
  if (!season || !search) return;
  root.dataset.filterWired = "1";
  const go = () => renderAlignementPane(container, _alignEpisodesAll, _alignRunsLangMap);
  season.addEventListener("change", go);
  search.addEventListener("input", debounceEpListFilter(go, 200));
}

// ── Sous-vue Segmentation ────────────────────────────────────────────────────

function renderSegmentationPane(container: HTMLElement, episodes: Episode[]) {
  _segEpisodesAll = episodes;
  const wrap = container.querySelector<HTMLElement>(".seg-table-wrap");
  const seasonSel = container.querySelector<HTMLSelectElement>("#seg-ep-season");
  const searchInp = container.querySelector<HTMLInputElement>("#seg-ep-search");
  if (!wrap) return;

  const prevActive = wrap.querySelector<HTMLTableRowElement>("tr.active-row")?.dataset.epId ?? null;

  if (seasonSel && searchInp) {
    const curSeason = seasonSel.value;
    const curSearch = searchInp.value;
    fillSeasonOptions(seasonSel, episodes, curSeason);
    searchInp.value = curSearch;
  }

  if (episodes.length === 0) {
    wrap.innerHTML = `<div class="cons-loading">Aucun épisode dans le projet.</div>`;
    wireSegEpListFilters(container);
    return;
  }

  const seasonVal = seasonSel?.value ?? "all";
  const searchVal = searchInp?.value ?? "";
  const filtered = filterEpisodesBySeasonAndSearch(episodes, seasonVal, searchVal);

  if (prevActive && !filtered.some((e) => e.episode_id === prevActive)) {
    const segTextPanel = container.querySelector<HTMLElement>("#seg-text-panel");
    if (segTextPanel) {
      segTextPanel.innerHTML = `<div class="acts-text-empty">← Sélectionnez un épisode</div>`;
    }
  }

  const rows = filtered.map((ep) => {
    const t = ep.sources.find((s) => s.source_key === "transcript");
    const state = t?.state ?? "unknown";
    const stateLabel =
      state === "segmented"   ? `<span class="cons-badge segmented">segmenté</span>` :
      state === "normalized"  ? `<span class="cons-badge normalized">normalisé</span>` :
      state === "raw"         ? `<span class="cons-badge raw">brut</span>` :
                                `<span class="cons-badge">—</span>`;
    const canFirst = state === "normalized";
    const canAgain = state === "segmented" || state === "ready_for_alignment";
    const action = canFirst
      ? `<button type="button" class="btn btn-primary btn-sm seg-ep-btn" data-ep="${escapeHtml(ep.episode_id)}" data-seg-run="first">Segmenter</button>`
      : canAgain
        ? `<button type="button" class="btn btn-secondary btn-sm seg-ep-btn" data-ep="${escapeHtml(ep.episode_id)}" data-seg-run="again" title="Recalcule phrases + tours depuis le transcript normalisé (clean)">Re-segmenter</button>`
        : `<span style="color:var(--text-muted);font-size:0.78rem">—</span>`;
    return `<tr data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}" data-ep-state="${escapeHtml(state)}">
      <td class="acts-ep-cell-id">${escapeHtml(ep.episode_id)}</td>
      <td class="acts-ep-cell-title">${escapeHtml(ep.title)}</td>
      <td class="acts-ep-cell-status">${stateLabel}</td>
      <td class="acts-ep-cell-action">${action}</td>
    </tr>`;
  }).join("");
  if (!filtered.length) {
    wrap.innerHTML = `<div class="cons-loading" style="padding:12px 8px;font-size:0.78rem;line-height:1.4">Aucun épisode ne correspond au filtre.</div>`;
    wireSegEpListFilters(container);
    return;
  }
  wrap.innerHTML = `
    <table class="cons-table">
      <thead><tr><th>ID</th><th>Titre</th><th>État transcript</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  if (prevActive && filtered.some((e) => e.episode_id === prevActive)) {
    wrap.querySelector(`tr[data-ep-id="${window.CSS.escape(prevActive)}"]`)?.classList.add("active-row");
  }
  wrap.querySelectorAll<HTMLButtonElement>(".seg-ep-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const epId = btn.dataset.ep!;
      const runKind = btn.dataset.segRun as "first" | "again" | undefined;
      const t = episodes.find((x) => x.episode_id === epId)?.sources.find((s) => s.source_key === "transcript");
      const langHint = container.querySelector<HTMLSelectElement>("#seg-lang-hint")?.value ?? "en";
      const segKind = (container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "sentence") as "sentence" | "utterance";
      const params = { lang_hint: langHint, segment_kind: segKind };
      const guard = runKind === "again" ? guardResegmentTranscript(t) : guardSegmentTranscript(t);
      const errEl = container.querySelector<HTMLElement>(".seg-error");
      const label = runKind === "again" ? "Re-segmenter" : "Segmenter";
      await guardedAction(
        guard,
        async () => {
          btn.disabled = true;
          btn.textContent = "…";
          if (errEl) { errEl.style.display = "none"; errEl.textContent = ""; }
          try {
            await createJob("segment_transcript", epId, "transcript", params);
            startJobPoll(container);
            btn.textContent = "✓ en file";
          } catch (e2) {
            const msg = e2 instanceof ApiError ? e2.message : String(e2);
            if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; }
            btn.textContent = label;
          } finally {
            btn.disabled = false;
          }
        },
        (reason) => {
          if (errEl) {
            errEl.textContent = reason;
            errEl.style.display = "block";
          }
        },
      );
    });
  });

  // S-1 : clic sur une ligne → afficher la table de segments dans le panneau droit
  const segTextPanel = container.querySelector<HTMLElement>("#seg-text-panel");
  wrap.querySelectorAll<HTMLTableRowElement>("tr[data-ep-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", async () => {
      wrap.querySelectorAll("tr[data-ep-id]").forEach((r) => r.classList.remove("active-row"));
      row.classList.add("active-row");
      _constituerSharedEpId = row.dataset.epId!;
      if (segTextPanel) {
        const kind = (container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "sentence") as "sentence" | "utterance";
        const st = row.dataset.epState ?? "unknown";
        await loadSegmentationRightPanel(segTextPanel, row.dataset.epId!, row.dataset.epTitle!, st, kind, container);
      }
    });
  });

  // Recharger quand « Afficher » (phrase/tour) change — pas la langue (sinon perte des edits dans l’aperçu)
  const kindSel = container.querySelector<HTMLSelectElement>("#seg-kind");
  if (kindSel && !kindSel.dataset.segWired) {
    kindSel.dataset.segWired = "1";
    kindSel.addEventListener("change", () => refreshActiveSegmentationPanel(container));
  }
  // Langue : seulement rafraîchir l’aperçu (textarea inchangé)
  if (!container.dataset.segLangPreviewWired) {
    container.dataset.segLangPreviewWired = "1";
    container.addEventListener("change", (ev) => {
      const t = ev.target as HTMLElement;
      if (t.id !== "seg-lang-hint") return;
      const segTextPanel = container.querySelector<HTMLElement>("#seg-text-panel");
      const ta = segTextPanel?.querySelector<HTMLTextAreaElement>("#seg-clean-edit");
      const root = segTextPanel?.querySelector<HTMLElement>(".seg-right-root");
      if (!ta || !root) return;
      void (async () => {
        try {
          const lh = (t as HTMLSelectElement).value;
          const uo = readSegUttOptionsFromDom(root);
          const pr = await withNoDbRecovery(() => fetchSegmentPreview(ta.value, lh, uo));
          fillSegmentPreviewLists(root, pr);
        } catch (e) {
          const st = root.querySelector<HTMLElement>("#seg-preview-stats");
          if (st) st.textContent = e instanceof ApiError ? e.message : String(e);
        }
      })();
    });
  }
  wireSegEpListFilters(container);
}

function fillSegmentPreviewLists(root: HTMLElement, pr: SegmentPreviewResponse): void {
  const sen = root.querySelector<HTMLElement>("#seg-prev-sentences");
  const utt = root.querySelector<HTMLElement>("#seg-prev-utterances");
  const stats = root.querySelector<HTMLElement>("#seg-preview-stats");
  const lineRow = (s: { n: number; text: string; speaker_explicit: string | null }, showSpk: boolean) => {
    const spk = showSpk && s.speaker_explicit
      ? `<span class="seg-prev-spk">${escapeHtml(s.speaker_explicit)}</span>`
      : "";
    return `<div class="seg-prev-row"><span class="seg-prev-n" style="font-size:0.62rem;color:var(--text-muted);margin-right:4px">#${s.n}</span>${spk}<span class="seg-prev-tx">${escapeHtml(s.text)}</span></div>`;
  };
  if (sen) {
    sen.innerHTML = pr.sentences.length
      ? pr.sentences.map((s) => lineRow(s, false)).join("")
      : `<div class="seg-prev-empty">Aucune</div>`;
  }
  if (utt) {
    utt.innerHTML = pr.utterances.length
      ? pr.utterances.map((s) => lineRow(s, true)).join("")
      : `<div class="seg-prev-empty">Aucune</div>`;
  }
  if (stats) stats.textContent = `${pr.n_sentences} phrases · ${pr.n_utterances} tours`;
}

function readSegUttOptionsFromDom(root: HTMLElement): Record<string, unknown> {
  const speaker = root.querySelector<HTMLInputElement>("#seg-opt-speaker-regex")?.value ?? "";
  const dashRe = root.querySelector<HTMLInputElement>("#seg-opt-dash-regex")?.value ?? "";
  const markersStr = root.querySelector<HTMLInputElement>("#seg-opt-markers")?.value ?? "";
  const markers = markersStr.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    speaker_regex: speaker,
    enable_dash_rule: root.querySelector<HTMLInputElement>("#seg-opt-dash-enable")?.checked ?? true,
    dash_regex: dashRe,
    continuation_markers: markers,
    merge_if_prev_ends_with_marker: root.querySelector<HTMLInputElement>("#seg-opt-merge-marker")?.checked ?? true,
    attach_unmarked_to_previous: root.querySelector<HTMLInputElement>("#seg-opt-attach-unmarked")?.checked ?? false,
  };
}

function fillSegUttOptionsDom(root: HTMLElement, o: UtteranceSegmentationOptions) {
  const sp = root.querySelector<HTMLInputElement>("#seg-opt-speaker-regex");
  if (sp) sp.value = o.speaker_regex ?? "";
  const en = root.querySelector<HTMLInputElement>("#seg-opt-dash-enable");
  if (en) en.checked = Boolean(o.enable_dash_rule);
  const dr = root.querySelector<HTMLInputElement>("#seg-opt-dash-regex");
  if (dr) dr.value = o.dash_regex ?? "";
  const mk = root.querySelector<HTMLInputElement>("#seg-opt-markers");
  if (mk) mk.value = Array.isArray(o.continuation_markers) ? o.continuation_markers.join(", ") : "";
  const mg = root.querySelector<HTMLInputElement>("#seg-opt-merge-marker");
  if (mg) mg.checked = Boolean(o.merge_if_prev_ends_with_marker);
  const at = root.querySelector<HTMLInputElement>("#seg-opt-attach-unmarked");
  if (at) at.checked = Boolean(o.attach_unmarked_to_previous);
}

function refreshActiveSegmentationPanel(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".seg-table-wrap");
  const activeRow = wrap?.querySelector<HTMLTableRowElement>("tr.active-row");
  const segTextPanel = container.querySelector<HTMLElement>("#seg-text-panel");
  if (!activeRow || !segTextPanel) return;
  const kind = (container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "sentence") as "sentence" | "utterance";
  const state = activeRow.dataset.epState ?? "unknown";
  void loadSegmentationRightPanel(
    segTextPanel,
    activeRow.dataset.epId!,
    activeRow.dataset.epTitle!,
    state,
    kind,
    container,
  );
}

/**
 * Aperçu (POST /segment/preview) + édition clean + tableau DB si déjà segmenté.
 */
function episodeTranscriptSourceForSeg(epId: string): EpisodeSource | undefined {
  const eps = _segEpisodesAll.length > 0 ? _segEpisodesAll : (_cachedEpisodes?.episodes ?? []);
  return eps.find((e) => e.episode_id === epId)?.sources.find((s) => s.source_key === "transcript");
}

function segTranscriptJobParams(container: HTMLElement): { lang_hint: string; segment_kind: string } {
  return {
    lang_hint: container.querySelector<HTMLSelectElement>("#seg-lang-hint")?.value ?? "en",
    segment_kind: container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "sentence",
  };
}

async function loadSegmentationRightPanel(
  panel: HTMLElement,
  epId: string,
  epTitle: string,
  transcriptState: string,
  kind: "sentence" | "utterance",
  container: HTMLElement,
) {
  panel.innerHTML = `<div class="acts-text-empty">Chargement…</div>`;
  try {
    const src = await withNoDbRecovery(() => fetchEpisodeSource(epId, "transcript")) as TranscriptSourceContent;
    let cleanBaseline = src.clean ?? "";
    if (!cleanBaseline.trim()) {
      panel.innerHTML = `<div class="acts-text-empty">Pas de texte normalisé — normalisez dans Curation.</div>`;
      return;
    }
    const langHint = container.querySelector<HTMLSelectElement>("#seg-lang-hint")?.value ?? "en";
    let segOptsRes: { options: UtteranceSegmentationOptions | null } = { options: null };
    try {
      segOptsRes = await withNoDbRecovery(() => fetchEpisodeSegmentationOptions(epId));
    } catch { /* route absente (vieux backend) — on utilise les défauts */ }
    const preview = await withNoDbRecovery(() => fetchSegmentPreview(cleanBaseline, langHint, segOptsRes.options));
    const showVerify = transcriptState === "segmented" || transcriptState === "ready_for_alignment";
    const canRunFirst = transcriptState === "normalized";
    const canRunAgain = transcriptState === "segmented" || transcriptState === "ready_for_alignment";
    const showRunBar = canRunFirst || canRunAgain;

    panel.innerHTML = `
<div class="seg-right-root">
  <div class="seg-preview-banner">
    <span><strong>Aperçu</strong> — même moteur que le job (rien n’écrit en base).</span>
    <button type="button" class="btn btn-ghost btn-sm" id="seg-refresh-preview">Actualiser</button>
  </div>
  <details class="seg-utt-opts" id="seg-utt-opts">
    <summary>Options tours (regex, marqueurs)</summary>
    <div class="seg-utt-opts-body">
      <label class="seg-label">Regex locuteur
        <input type="text" id="seg-opt-speaker-regex" class="seg-opt-input" spellcheck="false" autocomplete="off" />
      </label>
      <label class="seg-check"><input type="checkbox" id="seg-opt-dash-enable" /> Ligne commençant par tiret = nouveau tour</label>
      <label class="seg-label">Regex tiret
        <input type="text" id="seg-opt-dash-regex" class="seg-opt-input" spellcheck="false" autocomplete="off" />
      </label>
      <label class="seg-label">Marqueurs de continuation (virgules)
        <input type="text" id="seg-opt-markers" class="seg-opt-input" placeholder="..., …" autocomplete="off" />
      </label>
      <label class="seg-check"><input type="checkbox" id="seg-opt-merge-marker" /> Fusionner si la ligne précédente finit par un marqueur</label>
      <label class="seg-check"><input type="checkbox" id="seg-opt-attach-unmarked" /> Rattacher les lignes non marquées à la précédente</label>
      <div class="seg-utt-opts-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="seg-save-utt-opts">Enregistrer pour cet épisode</button>
        <button type="button" class="btn btn-ghost btn-sm" id="seg-reset-utt-opts">Réinitialiser défauts</button>
      </div>
      <p class="seg-utt-opts-hint">Utilisées par l’aperçu et le job <code>segment_transcript</code> (<code>episode_segmentation_options.json</code>).</p>
    </div>
  </details>
  <textarea id="seg-clean-edit" class="seg-clean-textarea" spellcheck="false"></textarea>
  <div class="seg-preview-toolbar">
    <button type="button" class="btn btn-secondary btn-sm" id="seg-save-clean" disabled>Enregistrer le clean</button>
    <span id="seg-preview-stats" class="seg-preview-stats"></span>
  </div>
  <div class="seg-preview-split">
    <div>
      <div class="seg-preview-col-title">Phrases</div>
      <div id="seg-prev-sentences" class="seg-preview-list"></div>
    </div>
    <div>
      <div class="seg-preview-col-title">Tours</div>
      <div id="seg-prev-utterances" class="seg-preview-list"></div>
    </div>
  </div>
  <div class="seg-run-actions" id="seg-run-actions-wrap" style="${showRunBar ? "" : "display:none"}">
    ${canRunFirst ? `<button type="button" class="btn btn-primary btn-sm" id="seg-run-panel">Lancer la segmentation</button><span class="seg-run-actions-note">Écrit <code>segments.jsonl</code> et l’index (job <code>segment_transcript</code>), comme le bouton <strong>Segmenter</strong> sur la ligne.</span>` : ""}
    ${canRunAgain ? `<button type="button" class="btn btn-secondary btn-sm" id="seg-reseg-panel">Re-segmenter</button><span class="seg-run-actions-note">Recalcule depuis le clean (identique au bouton de ligne).</span>` : ""}
  </div>
  <div class="seg-verify-section" id="seg-verify-section" style="${showVerify ? "" : "display:none"}">
    <div class="seg-verify-head">Segments enregistrés — vérification et correction</div>
    <div id="seg-segments-slot" class="seg-segments-slot"></div>
  </div>
  <div id="seg-pending-msg" class="seg-pending-msg" style="${showVerify ? "display:none" : ""}">
    <strong>Pas encore de segments en base.</strong> Quand l’aperçu convient : bouton <strong>Lancer la segmentation</strong> ci-dessus ou <strong>Segmenter</strong> sur la ligne à gauche.
  </div>
</div>`;

    const root = panel.querySelector<HTMLElement>(".seg-right-root")!;
    const ta = panel.querySelector<HTMLTextAreaElement>("#seg-clean-edit")!;
    ta.value = cleanBaseline;
    fillSegmentPreviewLists(root, preview);
    if (segOptsRes.options) fillSegUttOptionsDom(root, segOptsRes.options);

    const saveBtn = panel.querySelector<HTMLButtonElement>("#seg-save-clean")!;
    const syncDirty = () => {
      const dirty = ta.value !== cleanBaseline;
      saveBtn.disabled = !dirty;
    };

    const runPreviewNow = async () => {
      const lh = container.querySelector<HTMLSelectElement>("#seg-lang-hint")?.value ?? "en";
      const uo = readSegUttOptionsFromDom(root);
      const pr = await withNoDbRecovery(() => fetchSegmentPreview(ta.value, lh, uo));
      fillSegmentPreviewLists(root, pr);
    };

    ta.addEventListener("input", () => {
      syncDirty();
      if (_segSegPreviewTimer) clearTimeout(_segSegPreviewTimer);
      _segSegPreviewTimer = setTimeout(() => {
        _segSegPreviewTimer = null;
        if (!root.isConnected) return;
        void runPreviewNow().catch((e) => {
          const st = root.querySelector<HTMLElement>("#seg-preview-stats");
          if (st) st.textContent = e instanceof ApiError ? e.message : String(e);
        });
      }, 400);
    });

    panel.querySelector<HTMLButtonElement>("#seg-refresh-preview")?.addEventListener("click", () => {
      void runPreviewNow().catch(() => { /* stats */ });
    });

    const optBox = root.querySelector<HTMLElement>("#seg-utt-opts");
    const triggerOptPreview = () => {
      if (_segSegPreviewTimer) clearTimeout(_segSegPreviewTimer);
      _segSegPreviewTimer = setTimeout(() => {
        _segSegPreviewTimer = null;
        if (!root.isConnected) return;
        void runPreviewNow().catch((e) => {
          const st = root.querySelector<HTMLElement>("#seg-preview-stats");
          if (st) st.textContent = e instanceof ApiError ? e.message : String(e);
        });
      }, 400);
    };
    optBox?.addEventListener("input", triggerOptPreview);
    optBox?.addEventListener("change", triggerOptPreview);

    panel.querySelector<HTMLButtonElement>("#seg-save-utt-opts")?.addEventListener("click", async () => {
      const btn = panel.querySelector<HTMLButtonElement>("#seg-save-utt-opts")!;
      btn.disabled = true;
      try {
        await withNoDbRecovery(() => putEpisodeSegmentationOptions(epId, readSegUttOptionsFromDom(root)));
        await runPreviewNow();
      } catch (e) {
        const st = root.querySelector<HTMLElement>("#seg-preview-stats");
        if (st) st.textContent = e instanceof ApiError ? e.message : String(e);
      } finally {
        btn.disabled = false;
      }
    });

    panel.querySelector<HTMLButtonElement>("#seg-reset-utt-opts")?.addEventListener("click", async () => {
      const btn = panel.querySelector<HTMLButtonElement>("#seg-reset-utt-opts")!;
      btn.disabled = true;
      try {
        const res = await withNoDbRecovery(() => putEpisodeSegmentationOptions(epId, {}));
        fillSegUttOptionsDom(root, res.options);
        await runPreviewNow();
      } catch (e) {
        const st = root.querySelector<HTMLElement>("#seg-preview-stats");
        if (st) st.textContent = e instanceof ApiError ? e.message : String(e);
      } finally {
        btn.disabled = false;
      }
    });

    const errSeg = container.querySelector<HTMLElement>(".seg-error");
    panel.querySelector<HTMLButtonElement>("#seg-run-panel")?.addEventListener("click", async () => {
      const t = episodeTranscriptSourceForSeg(epId);
      await guardedAction(
        guardSegmentTranscript(t),
        async () => {
          await createJob("segment_transcript", epId, "transcript", segTranscriptJobParams(container));
          startJobPoll(container);
          if (errSeg) { errSeg.style.display = "none"; errSeg.textContent = ""; }
        },
        (reason) => {
          if (errSeg) { errSeg.textContent = reason; errSeg.style.display = "block"; }
        },
      );
    });
    panel.querySelector<HTMLButtonElement>("#seg-reseg-panel")?.addEventListener("click", async () => {
      const t = episodeTranscriptSourceForSeg(epId);
      await guardedAction(
        guardResegmentTranscript(t),
        async () => {
          await createJob("segment_transcript", epId, "transcript", segTranscriptJobParams(container));
          startJobPoll(container);
          if (errSeg) { errSeg.style.display = "none"; errSeg.textContent = ""; }
        },
        (reason) => {
          if (errSeg) { errSeg.textContent = reason; errSeg.style.display = "block"; }
        },
      );
    });

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        await patchTranscript(epId, ta.value);
        cleanBaseline = ta.value;
        await loadAndRenderSegmentation(container);
        const wrap2 = container.querySelector<HTMLElement>(".seg-table-wrap");
        const row2 = wrap2?.querySelector<HTMLTableRowElement>(`tr[data-ep-id="${window.CSS.escape(epId)}"]`);
        if (row2) {
          row2.classList.add("active-row");
          const st = row2.dataset.epState ?? "unknown";
          const segTextPanel2 = container.querySelector<HTMLElement>("#seg-text-panel");
          const kd = (container.querySelector<HTMLSelectElement>("#seg-kind")?.value ?? "sentence") as "sentence" | "utterance";
          if (segTextPanel2) void loadSegmentationRightPanel(segTextPanel2, epId, epTitle, st, kd, container);
        }
      } catch (e) {
        saveBtn.disabled = false;
        syncDirty();
        const errEl = container.querySelector<HTMLElement>(".seg-error");
        if (errEl) {
          errEl.textContent = e instanceof ApiError ? e.message : String(e);
          errEl.style.display = "block";
        }
      }
    });

    const slot = panel.querySelector<HTMLElement>("#seg-segments-slot");
    if (showVerify && slot) {
      await renderSegmentsDbBlock(slot, epId, epTitle, kind, container);
    }
  } catch (e) {
    panel.innerHTML = `<div class="acts-text-empty" style="color:var(--danger)">${escapeHtml(e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e))}</div>`;
  }
}

/**
 * Table segments en base (double-clic édition). Cible un sous-conteneur (#seg-segments-slot).
 */
async function renderSegmentsDbBlock(
  el: HTMLElement,
  epId: string,
  epTitle: string,
  kind: "sentence" | "utterance",
  container: HTMLElement,
) {
  el.innerHTML = `<div class="acts-text-empty">Chargement segments…</div>`;
  try {
    const res = await withNoDbRecovery(() => fetchEpisodeSegments(epId, kind));
    const segs = res.segments;

    if (segs.length === 0) {
      if (kind === "utterance") {
        el.innerHTML = `
          <div class="seg-warn-utterance">
            <strong>⚠ Aucun segment utterance</strong> pour ${escapeHtml(epTitle)}.<br>
            Le mode utterance nécessite des marqueurs de locuteur <code>NOM: </code> dans le transcript.
            <br><br>
            <button class="btn btn-primary btn-sm" id="seg-go-curation">→ Annoter dans Curation</button>
          </div>`;
        el.querySelector<HTMLButtonElement>("#seg-go-curation")?.addEventListener("click", () => {
          container.querySelector<HTMLButtonElement>('.cons-nav-tree-link[data-subview="curation"]')?.click();
        });
      } else {
        el.innerHTML = `<div class="acts-text-empty">Aucun segment — lancez la segmentation d'abord.</div>`;
      }
      return;
    }

    const hasSpeakers = segs.some((s) => s.speaker_explicit);
    const utteranceWarn = (kind === "utterance" && !hasSpeakers)
      ? `<div class="seg-warn-utterance" style="margin-bottom:8px">
          ⚠ Aucun locuteur identifié — les utterances n'ont pas de marqueurs <code>NOM: </code>.
          <button class="btn btn-ghost btn-sm" style="margin-left:6px" id="seg-warn-go-curation">→ Annoter</button>
        </div>`
      : "";

    const rows = segs.map((s) => {
      const speaker = s.speaker_explicit
        ? `<span class="seg-spk" style="color:var(--accent);font-weight:600">${escapeHtml(s.speaker_explicit)}</span>`
        : `<span class="seg-spk" style="color:var(--text-muted)">—</span>`;
      const len = s.text.length;
      const lenStyle = len > 200 ? "color:var(--danger,#dc2626)" : len > 120 ? "color:var(--warning,#b45309)" : "";
      return `<tr data-seg-id="${escapeHtml(s.segment_id)}" data-seg-text="${escapeHtml(s.text)}" data-seg-spk="${escapeHtml(s.speaker_explicit ?? "")}">
        <td class="seg-cell-n">${s.n}</td>
        <td class="seg-cell-speaker" title="Double-clic pour éditer le locuteur">${speaker}</td>
        <td class="seg-cell-text" title="Double-clic pour éditer le texte">${escapeHtml(s.text)}</td>
        <td class="seg-cell-len" style="${lenStyle}">${len}</td>
      </tr>`;
    }).join("");

    el.innerHTML = `
      ${utteranceWarn}
      <div class="seg-table-info">${escapeHtml(epTitle)} — ${segs.length} segment(s) · affichage <em>${kind}</em> · double-clic pour éditer · <span style="color:var(--text-muted);font-size:0.7rem">fusion/découpe : éditer le texte puis <strong>Re-segmenter</strong> si besoin</span></div>
      <div class="seg-segments-scroll">
        <table class="cons-table seg-segments-table">
          <thead><tr><th>#</th><th>Locuteur</th><th>Texte</th><th>Long.</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    el.querySelector<HTMLButtonElement>("#seg-warn-go-curation")?.addEventListener("click", () => {
      container.querySelector<HTMLButtonElement>('.cons-nav-tree-link[data-subview="curation"]')?.click();
    });

    el.querySelectorAll<HTMLTableRowElement>("tr[data-seg-id]").forEach((tr) => {
      const startCellEdit = async (
        cell: HTMLElement,
        field: "text" | "speaker_explicit",
        currentVal: string,
      ) => {
        if (cell.querySelector("input")) return; // déjà en édition
        cell.dataset.orig = cell.innerHTML;
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentVal;
        input.className = "docs-edit-input";
        input.style.cssText = "width:100%;box-sizing:border-box;font-size:0.76rem;padding:2px 5px";
        cell.innerHTML = "";
        cell.appendChild(input);
        input.focus();
        input.select();

        const commit = async () => {
          const newVal = input.value.trim();
          const segId = tr.dataset.segId!;
          if (newVal === currentVal) { cancelEdit(); return; }
          input.disabled = true;
          try {
            const patch: { text?: string; speaker_explicit?: string | null } = {};
            if (field === "text") patch.text = newVal;
            else patch.speaker_explicit = newVal || null;
            const updated = await withNoDbRecovery(() => patchSegment(epId, segId, patch));
            // Mettre à jour le DOM
            tr.dataset.segText = updated.text;
            tr.dataset.segSpk = updated.speaker_explicit ?? "";
            if (field === "text") {
              cell.textContent = updated.text;
              const lenCell = cell.nextElementSibling as HTMLElement | null;
              if (lenCell) {
                const len = updated.text.length;
                lenCell.textContent = String(len);
                lenCell.style.color = len > 200 ? "var(--danger,#dc2626)" : len > 120 ? "var(--warning,#b45309)" : "";
              }
            } else {
              const spkCell = cell;
              if (updated.speaker_explicit) {
                spkCell.innerHTML = `<span class="seg-spk" style="color:var(--accent);font-weight:600">${escapeHtml(updated.speaker_explicit)}</span>`;
              } else {
                spkCell.innerHTML = `<span class="seg-spk" style="color:var(--text-muted)">—</span>`;
              }
            }
          } catch (err) {
            cell.innerHTML = cell.dataset.orig ?? currentVal;
            const msg = err instanceof ApiError ? err.message : String(err);
            cell.title = `Erreur : ${msg}`;
            setTimeout(() => { cell.title = "Double-clic pour éditer"; }, 3000);
          }
        };
        const cancelEdit = () => { cell.innerHTML = cell.dataset.orig ?? currentVal; };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter")  { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
        });
        input.addEventListener("blur", () => { setTimeout(commit, 80); });
      };

      tr.querySelector<HTMLElement>(".seg-cell-text")?.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startCellEdit(e.currentTarget as HTMLElement, "text", tr.dataset.segText ?? "");
      });
      tr.querySelector<HTMLElement>(".seg-cell-speaker")?.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startCellEdit(e.currentTarget as HTMLElement, "speaker_explicit", tr.dataset.segSpk ?? "");
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="acts-text-empty" style="color:var(--danger)">${escapeHtml(e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e))}</div>`;
  }
}

async function loadAndRenderSegmentation(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".seg-table-wrap");
  if (wrap) wrap.innerHTML = `<div class="cons-loading">Chargement…</div>`;
  try {
    const data = await withNoDbRecovery(() => fetchEpisodes());
    _cachedEpisodes = data;
    renderSegmentationPane(container, data.episodes);
    updateHubStats(container);
    // Persistance inter-sous-vues : ré-ouvrir l'épisode actif si on vient d'une autre sous-vue
    const segWrap = container.querySelector<HTMLElement>(".seg-table-wrap");
    if (segWrap) autoSelectSharedEp(segWrap, "tr[data-ep-id]", "active-row");
  } catch (e) {
    if (!wrap) return;
    const main = escapeHtml(formatApiError(e));
    const noDbHint =
      e instanceof ApiError && e.errorCode === "NO_DB"
        ? `<p style="margin-top:10px;font-size:0.76rem;color:var(--text-muted);max-width:42rem;line-height:1.55">
            La création automatique de <code>corpus.db</code> a échoué ou le backend refuse l’écriture. Vérifiez les droits sur le dossier projet,
            que le sidecar Python est à jour, puis réessayez. Sinon : import transcript / normalisation pour indexer le corpus.
          </p>`
        : "";
    wrap.innerHTML = `<div class="cons-loading" style="line-height:1.45"><span style="color:var(--danger)">${main}</span>${noDbHint}</div>`;
  }
}

// ── Segmentation Traduction view (MX-036) ───────────────────────────────────

function parseSrtContent(raw: string): { n: number; time: string; text: string }[] {
  return raw
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.trim().split("\n");
      if (lines.length < 2) return [];
      const n = parseInt(lines[0]);
      if (isNaN(n)) return [];
      const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
      if (timeLineIdx < 0) return [];
      const time = lines[timeLineIdx];
      const text = lines
        .slice(timeLineIdx + 1)
        .join(" ")
        .replace(/<[^>]+>/g, "") // strip HTML tags (e.g. <i>)
        .trim();
      return text ? [{ n, time, text }] : [];
    });
}

let _tradViewMounted = false;

async function loadTradView(container: HTMLElement, episodes: Episode[]) {
  // Only rebuild the UI if it hasn't been mounted yet (episode/lang state persists)
  if (!_tradViewMounted) {
    _tradViewMounted = true;

    const segmented = episodes.filter((ep) =>
      ep.sources.some((s) => s.source_key === "transcript" && s.state !== "unknown"),
    );

    const epOpts = [
      `<option value="">— choisir un épisode —</option>`,
      ...segmented.map((ep) =>
        `<option value="${escapeHtml(ep.episode_id)}">${escapeHtml(ep.episode_id)} — ${escapeHtml(ep.title)}</option>`
      ),
    ].join("");

    container.innerHTML = `
      <div class="seg-trad-toolbar">
        <span class="seg-trad-label">Épisode</span>
        <select class="acts-params-select" id="seg-trad-ep" style="min-width:150px">
          ${epOpts}
        </select>
        <span class="seg-trad-label" style="margin-left:8px">Langue SRT</span>
        <select class="acts-params-select" id="seg-trad-lang" style="min-width:110px" disabled>
          <option value="">— sélectionnez un épisode —</option>
        </select>
        <span id="seg-trad-status" style="font-size:0.72rem;color:var(--text-muted);margin-left:8px"></span>
      </div>
      <div class="seg-trad-columns">
        <div class="seg-trad-col">
          <div class="seg-trad-col-header">Segments — transcript</div>
          <div class="seg-trad-content" id="seg-trad-left">
            <div class="seg-trad-empty">Sélectionnez un épisode pour afficher ses segments.</div>
          </div>
        </div>
        <div class="seg-trad-col">
          <div class="seg-trad-col-header">Sous-titres SRT</div>
          <div class="seg-trad-content" id="seg-trad-right">
            <div class="seg-trad-empty">Sélectionnez un épisode et une langue SRT.</div>
          </div>
        </div>
      </div>`;

    const epSel    = container.querySelector<HTMLSelectElement>("#seg-trad-ep")!;
    const langSel  = container.querySelector<HTMLSelectElement>("#seg-trad-lang")!;
    const leftEl   = container.querySelector<HTMLElement>("#seg-trad-left")!;
    const rightEl  = container.querySelector<HTMLElement>("#seg-trad-right")!;
    const statusEl = container.querySelector<HTMLElement>("#seg-trad-status")!;

    async function loadLeft(epId: string) {
      leftEl.innerHTML = `<div class="seg-trad-empty">Chargement…</div>`;
      try {
        const res = await fetchEpisodeSegments(epId);
        if (res.segments.length === 0) {
          leftEl.innerHTML = `<div class="seg-trad-empty">Aucun segment — lancez la segmentation d'abord.</div>`;
        } else {
          leftEl.innerHTML = res.segments.map((s) =>
            `<div class="seg-trad-row">
              ${s.speaker_explicit ? `<span class="seg-trad-speaker">${escapeHtml(s.speaker_explicit)}</span>` : ""}
              <span class="seg-trad-n">#${s.n}</span>${escapeHtml(s.text ?? "")}
            </div>`
          ).join("");
          statusEl.textContent = `${res.segments.length} segments`;
        }
      } catch (e) {
        leftEl.innerHTML = `<div class="seg-trad-empty" style="color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
      }
    }

    async function loadRight(epId: string, srtKey: string) {
      rightEl.innerHTML = `<div class="seg-trad-empty">Chargement…</div>`;
      try {
        const src = (await fetchEpisodeSource(epId, srtKey)) as SrtSourceContent;
        const cues = parseSrtContent(src.content ?? "");
        if (cues.length === 0) {
          rightEl.innerHTML = `<div class="seg-trad-empty">Aucune cue dans ce fichier SRT.</div>`;
        } else {
          rightEl.innerHTML = cues.map((c) =>
            `<div class="seg-trad-row">
              <span class="seg-trad-time">${escapeHtml(c.time)}</span>
              <span class="seg-trad-n">#${c.n}</span>${escapeHtml(c.text)}
            </div>`
          ).join("");
        }
      } catch (e) {
        rightEl.innerHTML = `<div class="seg-trad-empty" style="color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
      }
    }

    epSel.addEventListener("change", () => {
      const epId = epSel.value;
      const ep   = segmented.find((e) => e.episode_id === epId);
      const srts = ep?.sources.filter((s) => s.source_key.startsWith("srt_")) ?? [];

      // Rebuild lang selector
      if (srts.length > 0) {
        langSel.innerHTML = srts.map((s) =>
          `<option value="${escapeHtml(s.source_key)}">${escapeHtml(s.language ?? s.source_key.replace("srt_", "").toUpperCase())}</option>`
        ).join("");
        langSel.disabled = false;
      } else {
        langSel.innerHTML = `<option value="">— aucun SRT disponible —</option>`;
        langSel.disabled = true;
      }

      if (!epId) return;
      loadLeft(epId);
      if (!langSel.disabled && langSel.value) loadRight(epId, langSel.value);
      else rightEl.innerHTML = `<div class="seg-trad-empty">Sélectionnez une langue SRT.</div>`;
    });

    langSel.addEventListener("change", () => {
      const epId   = epSel.value;
      const srtKey = langSel.value;
      if (epId && srtKey) loadRight(epId, srtKey);
    });
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
    const errNode = document.createElement("div");
    errNode.className = "cons-loading";
    errNode.textContent = e instanceof ApiError ? e.message : String(e);
    container.innerHTML = "";
    container.appendChild(errNode);
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
        <button class="btn btn-ghost btn-sm" id="lt-search-prev" title="Précédent (Shift+Entrée)">▲</button>
        <button class="btn btn-ghost btn-sm" id="lt-search-next" title="Suivant (Entrée)">▼</button>
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

function renderAlignementPane(
  container: HTMLElement,
  episodes: Episode[],
  alignedLangs: Map<string, Set<string>> = new Map(),
) {
  _alignEpisodesAll = episodes;
  _alignRunsLangMap = alignedLangs;
  const wrap = container.querySelector<HTMLElement>(".align-ep-wrap");
  const seasonSel = container.querySelector<HTMLSelectElement>("#align-ep-season");
  const searchInp = container.querySelector<HTMLInputElement>("#align-ep-search");
  if (!wrap) return;

  const prevActive = wrap.querySelector<HTMLTableRowElement>("tr.active-row")?.dataset.epId ?? null;

  if (seasonSel && searchInp) {
    const curSeason = seasonSel.value;
    const curSearch = searchInp.value;
    fillSeasonOptions(seasonSel, episodes, curSeason);
    searchInp.value = curSearch;
  }

  if (episodes.length === 0) {
    wrap.innerHTML = `<div class="cons-loading">Aucun épisode dans le projet.</div>`;
    wireAlignEpListFilters(container);
    return;
  }

  const seasonVal = seasonSel?.value ?? "all";
  const searchVal = searchInp?.value ?? "";
  const filtered = filterEpisodesBySeasonAndSearch(episodes, seasonVal, searchVal);

  if (prevActive && !filtered.some((e) => e.episode_id === prevActive)) {
    const alignTextPanel = container.querySelector<HTMLElement>("#align-text-panel");
    if (alignTextPanel) {
      alignTextPanel.innerHTML = `<div class="acts-text-empty">← Sélectionnez un épisode</div>`;
    }
  }

  const rows = filtered.map((ep) => {
    const t = ep.sources.find((s) => s.source_key === "transcript");
    const srts = ep.sources.filter((s) => s.source_key.startsWith("srt_") && s.available);
    const isSegmented = t?.state === "segmented";
    const epAligned = alignedLangs.get(ep.episode_id) ?? new Set();

    // A-1 : statut par langue SRT (✓ si lang dans un run d'alignement)
    const srtStatus = srts.length > 0
      ? `<div class="acts-ep-lang-stack">${srts.map((s) => {
          const lang = s.source_key.replace("srt_", "");
          const done = epAligned.has(lang);
          return `<span class="align-lang-badge ${done ? "done" : "pending"}">${escapeHtml(lang)} ${done ? "✓" : "✗"}</span>`;
        }).join("")}</div>`
      : `<span style="color:var(--text-muted);font-size:0.78rem">—</span>`;

    const canAlign = isSegmented && srts.length > 0;
    const action = canAlign
      ? `<button class="btn btn-primary btn-sm align-ep-btn" data-ep="${escapeHtml(ep.episode_id)}" data-title="${escapeHtml(ep.title)}" data-srts="${escapeHtml(srts.map((s) => s.source_key).join(","))}">→ Aligner</button>`
      : `<span class="align-ep-blocked" title="${!isSegmented ? "Segmenter d'abord" : "Importer un SRT"}">${!isSegmented ? "seg. manquante" : "SRT manquant"}</span>`;

    return `<tr data-ep-id="${escapeHtml(ep.episode_id)}" data-ep-title="${escapeHtml(ep.title)}" style="cursor:pointer">
      <td class="acts-ep-cell-id">${escapeHtml(ep.episode_id)}</td>
      <td class="acts-ep-cell-title">${escapeHtml(ep.title)}</td>
      <td class="acts-ep-cell-status">${srtStatus}</td>
      <td class="acts-ep-cell-action">${action}</td>
    </tr>`;
  }).join("");
  if (!filtered.length) {
    wrap.innerHTML = `<div class="cons-loading" style="padding:12px 8px;font-size:0.78rem;line-height:1.4">Aucun épisode ne correspond au filtre.</div>`;
    wireAlignEpListFilters(container);
    return;
  }
  wrap.innerHTML = `
    <table class="cons-table">
      <thead><tr><th>ID</th><th>Titre</th><th>Langues SRT</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  if (prevActive && filtered.some((e) => e.episode_id === prevActive)) {
    wrap.querySelector(`tr[data-ep-id="${window.CSS.escape(prevActive)}"]`)?.classList.add("active-row");
  }
  wrap.querySelectorAll<HTMLButtonElement>(".align-ep-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const epId       = btn.dataset.ep!;
      const epTitle    = btn.dataset.title!;
      const srtKeys    = (btn.dataset.srts || "").split(",").filter(Boolean);
      // Read params from hub (batch settings used as defaults for per-episode align)
      const root       = wrap.closest(".cons-root") ?? wrap.getRootNode() as HTMLElement;
      const segKind    = (root.querySelector<HTMLSelectElement>("#hub-align-seg-kind")?.value ?? "utterance") as "utterance" | "sentence";
      const pivotLang  = (root.querySelector<HTMLInputElement>("#hub-align-lang")?.value.trim() ?? "fr") || "fr";
      const minConf    = parseFloat(root.querySelector<HTMLInputElement>("#hub-align-conf")?.value ?? "0.3");
      const useSim     = root.querySelector<HTMLInputElement>("#hub-align-sim")?.checked ?? false;
      const targetLangs = srtKeys.map((k) => k.replace("srt_", ""));
      const handoff = {
        episode_id:              epId,
        episode_title:           epTitle,
        // Legacy fields (alignerModule.ts)
        pivot_key:               "transcript",
        target_keys:             srtKeys,
        mode:                    "transcript_first" as const,
        segment_kind:            segKind,
        // Extended config fields (MX-037)
        pivot_lang:              pivotLang,
        target_langs:            targetLangs,
        min_confidence:          isNaN(minConf) ? 0.3 : minConf,
        use_similarity_for_cues: useSim,
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
        _constituerSharedEpId = epId;
        loadAlignmentRunHistory(alignTextPanel, epId, epTitle);
      });
    });
  }
  wireAlignEpListFilters(container);
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
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <span class="align-run-kind">${escapeHtml(r.segment_kind ?? "utterance")}</span>
            <button class="btn btn-ghost btn-sm align-propagate-btn" data-run-id="${escapeHtml(r.run_id)}" style="font-size:0.68rem;margin-left:2px" title="Propager les noms de personnages dans les segments et les SRTs">🔁 Propager</button>
            <button class="btn btn-ghost btn-sm align-derive-btn" data-ep-id="${escapeHtml(epId)}" style="font-size:0.68rem;margin-left:2px" title="Dériver les tours de parole depuis les phrases groupées par locuteur (après propagation)">↻ Dériver tours</button>
            <span style="margin-left:auto;font-size:0.68rem;color:var(--accent)">Auditer →</span>
          </div>
          <div class="align-propagate-status" data-prop-run="${escapeHtml(r.run_id)}" style="display:none;font-size:0.72rem;margin-top:3px"></div>
          <div class="align-derive-status" data-derive-ep="${escapeHtml(epId)}" style="display:none;font-size:0.72rem;margin-top:3px"></div>
        </div>`;
    }).join("");
    panel.innerHTML = `
      <div class="align-runs-panel">
        <div class="align-runs-title">${escapeHtml(epTitle)} — ${runs.length} run(s) · cliquez pour auditer</div>
        ${cards}
      </div>`;

    // Wire run card clicks → open audit view
    panel.querySelectorAll<HTMLElement>(".align-run-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".align-propagate-btn")) return; // handled below
        panel.querySelectorAll(".align-run-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        openAuditView(panel, epId, epTitle, card.dataset.runId!);
      });
    });

    // A-4 : Wire boutons "Propager personnages"
    panel.querySelectorAll<HTMLButtonElement>(".align-propagate-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const runId   = btn.dataset.runId!;
        const statusEl = panel.querySelector<HTMLElement>(`.align-propagate-status[data-prop-run="${runId}"]`);
        btn.disabled = true;
        btn.textContent = "…";
        if (statusEl) { statusEl.style.display = ""; statusEl.style.color = "var(--text-muted)"; statusEl.textContent = "Propagation en cours…"; }
        try {
          const res: PropagateResult = await propagateCharacters(epId, runId);
          if (statusEl) {
            statusEl.style.color = "var(--success, #16a34a)";
            statusEl.textContent = `✓ ${res.nb_segments_updated} segment(s), ${res.nb_cues_updated} cue(s) mis à jour`;
          }
          btn.textContent = "✓";
          setTimeout(() => { btn.disabled = false; btn.textContent = "🔁 Propager"; }, 3000);
        } catch (err) {
          const msg = err instanceof ApiError ? `${err.errorCode} — ${err.message}` : String(err);
          if (statusEl) { statusEl.style.color = "var(--danger, #dc2626)"; statusEl.textContent = msg; }
          btn.disabled = false;
          btn.textContent = "🔁 Propager";
        }
      });
    });

    // A-5 : Wire boutons "Dériver tours de parole"
    panel.querySelectorAll<HTMLButtonElement>(".align-derive-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const targetEpId = btn.dataset.epId!;
        const statusEl = panel.querySelector<HTMLElement>(`.align-derive-status[data-derive-ep="${targetEpId}"]`);
        btn.disabled = true;
        btn.textContent = "…";
        if (statusEl) { statusEl.style.display = ""; statusEl.style.color = "var(--text-muted)"; statusEl.textContent = "Dérivation en cours…"; }
        try {
          const job = await createJob("derive_utterances", targetEpId);
          // Attendre la fin du job (polling léger)
          let jobResult = job;
          const POLL_MS = 1200;
          const MAX_POLLS = 120;
          for (let i = 0; i < MAX_POLLS; i++) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            jobResult = await fetchJob(jobResult.job_id);
            if (jobResult.status === "done" || jobResult.status === "error") break;
          }
          if (jobResult.status === "done") {
            const { utterances = "?", sentences = "?" } = jobResult.result as Record<string, unknown>;
            if (statusEl) {
              statusEl.style.color = "var(--success, #16a34a)";
              statusEl.textContent = `✓ ${utterances} tours dérivés depuis ${sentences} phrases`;
            }
            btn.textContent = "✓";
            setTimeout(() => { btn.disabled = false; btn.textContent = "↻ Dériver tours"; }, 3000);
          } else {
            const msg = (jobResult.error_msg) || "Erreur inconnue";
            if (statusEl) { statusEl.style.color = "var(--danger, #dc2626)"; statusEl.textContent = msg; }
            btn.disabled = false;
            btn.textContent = "↻ Dériver tours";
          }
        } catch (err) {
          const msg = err instanceof ApiError ? `${err.errorCode} — ${err.message}` : String(err);
          if (statusEl) { statusEl.style.color = "var(--danger, #dc2626)"; statusEl.textContent = msg; }
          btn.disabled = false;
          btn.textContent = "↻ Dériver tours";
        }
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
let _auditKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
let _minimapPositions: LinkPosition[] = [];
let _minimapMaxN = 1;

// Virtual scroll state
const _VS_ROW_H = 40;  // px — estimated row height (single-line cells)
const _VS_BUFFER = 6;  // extra rows rendered above and below viewport
let _vsLinks: AuditLink[] = [];
let _vsFocusIdx = -1;
let _auditLoadToken = 0; // incremented on each load — stale fetches are discarded

const _MINIMAP_STATUS_COLORS: Record<string, string> = {
  accepted: "#22c55e",
  rejected: "#ef4444",
  auto:     "#94a3b8",
  ignored:  "#cbd5e1",
};

async function loadMinimapPositions(panel: HTMLElement, epId: string, runId: string) {
  try {
    const res = await fetchLinkPositions(epId, runId);
    _minimapPositions = res.positions;
    _minimapMaxN = _minimapPositions.reduce((mx, p) => Math.max(mx, p.n), 1) || 1;
  } catch {
    _minimapPositions = [];
    _minimapMaxN = 1;
  }
  updateMinimapViewport(panel);
}

function renderMinimap(
  canvas: HTMLCanvasElement,
  positions: LinkPosition[],
  maxN: number,
  offset: number,
  limit: number,
) {
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const h = wrap.clientHeight || 300;
  canvas.width  = 16;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, 16, h);
  if (positions.length === 0) return;
  const scale = h / Math.max(maxN, 1);
  for (const pos of positions) {
    ctx.fillStyle = _MINIMAP_STATUS_COLORS[pos.status] ?? "#94a3b8";
    ctx.fillRect(2, Math.round(pos.n * scale), 12, Math.max(1, Math.ceil(scale)));
  }
  // Viewport indicator
  if (limit > 0) {
    const vTop    = Math.round(offset * scale);
    const vHeight = Math.max(3, Math.round(limit * scale));
    ctx.fillStyle   = "rgba(15,118,110,0.15)";
    ctx.fillRect(0, vTop, 16, vHeight);
    ctx.strokeStyle = "rgba(15,118,110,0.65)";
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, vTop + 0.5, 15, Math.max(2, vHeight - 1));
  }
}

function updateMinimapViewport(panel: HTMLElement) {
  const canvas = panel.querySelector<HTMLCanvasElement>("#audit-minimap");
  const wrap   = panel.querySelector<HTMLElement>("#audit-table-wrap");
  if (!canvas) return;
  const scrollTop  = wrap ? wrap.scrollTop  : 0;
  const viewH      = wrap ? wrap.clientHeight : 400;
  const visOffset  = Math.floor(scrollTop / _VS_ROW_H);
  const visLimit   = Math.ceil(viewH / _VS_ROW_H);
  renderMinimap(canvas, _minimapPositions, _minimapMaxN, visOffset, visLimit);
}

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
        <button id="audit-export-html-btn" style="
          margin-left:auto;
          padding:3px 10px;
          font-size:0.72rem;
          background:var(--surface);
          border:1px solid var(--border);
          border-radius:4px;
          cursor:pointer;
          color:var(--text);
          display:flex;
          align-items:center;
          gap:4px;
          white-space:nowrap;
        ">⬇ HTML</button>
        <button id="audit-export-btn" style="
          padding:3px 10px;
          font-size:0.72rem;
          background:var(--surface);
          border:1px solid var(--border);
          border-radius:4px;
          cursor:pointer;
          color:var(--text);
          display:flex;
          align-items:center;
          gap:4px;
          white-space:nowrap;
        ">⬇ JSON</button>
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
          <option value="ignored">Ignorés</option>
        </select>
        <input id="audit-search" type="search" placeholder="Rechercher texte…" />
        <span id="audit-count" style="font-size:0.72rem;color:var(--text-muted);margin-left:auto"></span>
      </div>
      <div class="audit-body">
        <div class="audit-pane active" data-tab="links">
          <div class="audit-bulk-bar" id="audit-bulk-bar">
            <span class="audit-bulk-bar-label">Groupé :</span>
            <button class="audit-action-btn accept" id="audit-bulk-accept-auto"
              title="Accepter tous les liens en statut auto">✓ Auto → Acceptés</button>
            <button class="audit-action-btn ignore" id="audit-bulk-ignore-auto"
              title="Marquer tous les liens auto comme ignorés (pas de traduction attendue)">◌ Auto → Ignorés</button>
            <div class="audit-bulk-sep"></div>
            <div class="audit-bulk-conf-wrap">
              <button class="audit-action-btn ignore" id="audit-bulk-ignore-low"
                title="Ignorer tous les liens auto dont la confidence est inférieure au seuil">◌ Ignorer conf. &lt;</button>
              <input type="number" id="audit-bulk-conf-threshold"
                min="5" max="95" step="5" value="30"
                title="Seuil de confiance (en %) — les liens auto inférieurs à ce seuil seront ignorés" />
              <span>%</span>
            </div>
            <div class="audit-bulk-sep"></div>
            <button class="audit-action-btn undo" id="audit-bulk-reset-all"
              title="Remettre tous les liens (acceptés / rejetés / ignorés) en statut auto">↺ Reset tout en auto</button>
          </div>
          <div class="audit-links-layout">
            <div class="audit-links-col">
              <div class="audit-table-wrap" id="audit-table-wrap">
                <div style="padding:12px;font-size:0.78rem;color:var(--text-muted)">Chargement liens…</div>
              </div>
              <div class="audit-pager" id="audit-pager"></div>
            </div>
            <div class="audit-minimap-wrap" id="audit-minimap-wrap">
              <canvas class="audit-minimap" id="audit-minimap"></canvas>
            </div>
          </div>
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

  // Export rapport JSON (MX-038)
  panel.querySelector<HTMLButtonElement>("#audit-export-btn")!.addEventListener("click", async () => {
    const btn = panel.querySelector<HTMLButtonElement>("#audit-export-btn")!;
    const origText = btn.textContent ?? "⬇ JSON";
    btn.disabled = true;
    btn.textContent = "Chargement…";
    try {
      await exportAuditReport(epId, epTitle, runId);
    } catch (e) {
      alert(`Export échoué : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // Export rapport HTML (G-009 / MX-046)
  panel.querySelector<HTMLButtonElement>("#audit-export-html-btn")!.addEventListener("click", async () => {
    const btn = panel.querySelector<HTMLButtonElement>("#audit-export-html-btn")!;
    btn.disabled = true;
    btn.textContent = "Chargement…";
    try {
      await exportAuditReportHtml(epId, epTitle, runId);
    } catch (e) {
      alert(`Export HTML échoué : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "⬇ HTML";
    }
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

  // ── Bulk actions (MX-039) ─────────────────────────────────────────────────

  /**
   * Exécute une action bulk, puis rafraîchit stats + liens courants.
   * Désactive les boutons de la barre pendant l'opération.
   */
  async function doBulkAction(
    params: Parameters<typeof bulkSetAlignLinkStatus>[2],
    confirmMsg?: string,
  ) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const bar = panel.querySelector<HTMLElement>("#audit-bulk-bar");
    const btns = bar?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    btns.forEach((b) => (b.disabled = true));
    try {
      await bulkSetAlignLinkStatus(epId, runId, params);
      // Refresh stats + current page of links in parallel
      await Promise.all([
        loadAuditStats(panel, epId, runId),
        loadAuditLinks(panel, epId, runId),
      ]);
    } catch (e) {
      alert(`Action groupée échouée : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  }

  // ✓ Auto → Acceptés : accepte tous les liens en statut "auto"
  panel.querySelector<HTMLButtonElement>("#audit-bulk-accept-auto")!
    .addEventListener("click", () =>
      doBulkAction({ new_status: "accepted", filter_status: "auto" }),
    );

  // ◌ Auto → Ignorés : ignore tous les liens en statut "auto"
  panel.querySelector<HTMLButtonElement>("#audit-bulk-ignore-auto")!
    .addEventListener("click", () =>
      doBulkAction({ new_status: "ignored", filter_status: "auto" }),
    );

  // ◌ Ignorer conf. < X% : ignore les liens auto dont la confidence < seuil
  panel.querySelector<HTMLButtonElement>("#audit-bulk-ignore-low")!
    .addEventListener("click", () => {
      const rawVal = panel.querySelector<HTMLInputElement>("#audit-bulk-conf-threshold")?.value ?? "30";
      const pct    = parseFloat(rawVal);
      const confLt = isNaN(pct) ? 0.3 : Math.min(1, Math.max(0, pct / 100));
      doBulkAction({
        new_status:    "ignored",
        filter_status: "auto",
        conf_lt:       confLt,
      });
    });

  // ↺ Reset tout en auto : remet tous les liens (acceptés/rejetés/ignorés) en auto
  panel.querySelector<HTMLButtonElement>("#audit-bulk-reset-all")!
    .addEventListener("click", () =>
      doBulkAction(
        { new_status: "auto" },
        "Remettre TOUS les liens en auto ? Les décisions manuelles seront perdues.",
      ),
    );

  // ── Keyboard shortcuts (G-005 / MX-043) ─────────────────────────────────
  // A = accept, R = reject, I = ignore, ↓/↑ = row nav, N/P = page nav

  // Remove any previous handler (guard against multiple openAuditView calls)
  if (_auditKeydownHandler) {
    document.removeEventListener("keydown", _auditKeydownHandler);
    _auditKeydownHandler = null;
  }

  function _auditFocusedRow(): HTMLTableRowElement | null {
    return panel.querySelector<HTMLTableRowElement>(".audit-table tr.audit-focused");
  }

  function _auditRows(): HTMLTableRowElement[] {
    return Array.from(
      panel.querySelectorAll<HTMLTableRowElement>(".audit-table tbody tr[data-link-id]"),
    );
  }

  function _auditClickAction(row: HTMLTableRowElement, action: string) {
    const btn = row.querySelector<HTMLButtonElement>(`.audit-action-btn[data-action="${action}"]`);
    btn?.click();
  }

  function _auditMoveFocus(delta: number) {
    if (_vsLinks.length === 0) return;
    _vsFocusIdx = Math.max(0, Math.min(_vsLinks.length - 1, _vsFocusIdx + delta));
    const wrap = panel.querySelector<HTMLElement>("#audit-table-wrap");
    if (wrap) {
      // Scroll into view if needed (leave 50px gap for sticky thead)
      const rowTop = _vsFocusIdx * _VS_ROW_H;
      const rowBot = rowTop + _VS_ROW_H;
      if (rowTop < wrap.scrollTop + 50)      wrap.scrollTop = Math.max(0, rowTop - 50);
      else if (rowBot > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = rowBot - wrap.clientHeight;
      _vsRender(wrap);
    }
  }

  const _onAuditKeydown = (e: KeyboardEvent) => {
    // Skip if an input, select or textarea has focus
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    // Skip if audit panel is not showing links tab
    if (_auditState.activeTab !== "links") return;
    // Skip if any modifier key is held (except shift)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();

    if (key === "arrowdown" || key === "j") {
      e.preventDefault();
      _auditMoveFocus(+1);
    } else if (key === "arrowup" || key === "k") {
      e.preventDefault();
      _auditMoveFocus(-1);
    } else if (key === "a") {
      const row = _auditFocusedRow();
      if (row) { e.preventDefault(); _auditClickAction(row, "accepted"); }
    } else if (key === "r") {
      const row = _auditFocusedRow();
      if (row) { e.preventDefault(); _auditClickAction(row, "rejected"); }
    } else if (key === "i") {
      const row = _auditFocusedRow();
      if (row) { e.preventDefault(); _auditClickAction(row, "ignored"); }
    } else if (key === "n") {
      e.preventDefault();
      const tw = panel.querySelector<HTMLElement>("#audit-table-wrap");
      if (tw) tw.scrollTop += tw.clientHeight;
    } else if (key === "p") {
      e.preventDefault();
      const tw = panel.querySelector<HTMLElement>("#audit-table-wrap");
      if (tw) tw.scrollTop = Math.max(0, tw.scrollTop - tw.clientHeight);
    }
  };

  _auditKeydownHandler = _onAuditKeydown;
  document.addEventListener("keydown", _onAuditKeydown);

  // Remove the handler when leaving the audit view
  panel.querySelector<HTMLButtonElement>("#audit-back")!.addEventListener(
    "click",
    () => {
      document.removeEventListener("keydown", _onAuditKeydown);
      _auditKeydownHandler = null;
    },
    { once: true },
  );

  // Minimap click → scroll virtual table to the closest segment rank
  panel.querySelector<HTMLElement>("#audit-minimap-wrap")!.addEventListener("click", (e) => {
    const mmWrap = panel.querySelector<HTMLElement>("#audit-minimap-wrap")!;
    const h = mmWrap.clientHeight || 1;
    const ratio = Math.max(0, Math.min(1, (e as MouseEvent).offsetY / h));
    const targetN = Math.round(ratio * _minimapMaxN);
    const sorted = _minimapPositions.slice().sort((a, b) => a.n - b.n);
    let closestIdx = 0, minDist = Infinity;
    sorted.forEach((p, i) => {
      const d = Math.abs(p.n - targetN);
      if (d < minDist) { minDist = d; closestIdx = i; }
    });
    const tableWrap = panel.querySelector<HTMLElement>("#audit-table-wrap");
    if (tableWrap) {
      tableWrap.scrollTop = closestIdx * _VS_ROW_H;
      _vsFocusIdx = closestIdx;
      _vsRender(tableWrap);
    }
  });

  // Load stats + links + collisions + minimap in parallel
  loadAuditStats(panel, epId, runId);
  loadAuditLinks(panel, epId, runId);
  loadAuditCollisions(panel, epId, runId);
  loadMinimapPositions(panel, epId, runId);
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
    const nIgnored  = byStatus.ignored  ?? 0;
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
      ${nIgnored > 0 ? `<div class="audit-stat"><span class="audit-stat-val" style="color:#64748b">${nIgnored}</span><span class="audit-stat-label">Ignorés</span></div>` : ""}
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

    // Quality bar (accepted=vert, auto=jaune, rejected=rouge, ignored=slate)
    const total = nAccepted + nAuto + nRejected + nIgnored;
    const qualRow = panel.querySelector<HTMLElement>("#audit-quality-bar-row");
    const qualBar = panel.querySelector<HTMLElement>("#audit-quality-bar");
    const qualLabel = panel.querySelector<HTMLElement>("#audit-quality-label");
    if (qualRow && qualBar && qualLabel && total > 0) {
      qualBar.innerHTML = `
        <div class="audit-quality-seg accepted" style="flex:${nAccepted}"></div>
        <div class="audit-quality-seg auto"     style="flex:${nAuto}"></div>
        <div class="audit-quality-seg rejected" style="flex:${nRejected}"></div>
        ${nIgnored > 0 ? `<div class="audit-quality-seg ignored" style="flex:${nIgnored}"></div>` : ""}`;
      const parts = [`${nAccepted} acceptés`, `${nAuto} auto`, `${nRejected} rejetés`];
      if (nIgnored > 0) parts.push(`${nIgnored} ignorés`);
      qualLabel.textContent = parts.join(" · ");
      qualRow.style.display = "flex";
    }
  } catch (e) {
    const kpiErr = document.createElement("span");
    kpiErr.style.cssText = "font-size:0.76rem;color:var(--danger)";
    kpiErr.textContent = e instanceof ApiError ? e.message : String(e);
    kpiStrip.innerHTML = "";
    kpiStrip.appendChild(kpiErr);
  }
}

async function loadAuditLinks(panel: HTMLElement, epId: string, runId: string) {
  const wrap    = panel.querySelector<HTMLElement>("#audit-table-wrap");
  const pager   = panel.querySelector<HTMLElement>("#audit-pager");
  const countEl = panel.querySelector<HTMLElement>("#audit-count");
  if (!wrap) return;

  // Guard against race conditions: stale fetches from a previous run are discarded
  const myToken = ++_auditLoadToken;

  wrap.innerHTML = `<div style="padding:12px;font-size:0.78rem;color:var(--text-muted)">Chargement…</div>`;
  if (pager) pager.innerHTML = "";
  try {
    // Fetch first batch to get total
    const BATCH = 200;
    const first = await fetchAuditLinks(epId, runId, {
      status: _auditState.statusFilter || undefined,
      q:      _auditState.q || undefined,
      offset: 0,
      limit:  BATCH,
    });
    if (_auditLoadToken !== myToken) return;

    _auditState.total = first.total;
    if (countEl) countEl.textContent = `${first.total} lien(s)`;

    if (first.total === 0) {
      wrap.innerHTML = `<div style="padding:16px;font-size:0.78rem;color:var(--text-muted)">Aucun lien trouvé.</div>`;
      _vsLinks = [];
      _vsFocusIdx = -1;
      return;
    }

    // Fetch remaining batches in parallel
    let links = [...first.links];
    if (first.total > BATCH) {
      const batches: Promise<{ links: AuditLink[] }>[] = [];
      for (let off = BATCH; off < first.total; off += BATCH) {
        batches.push(fetchAuditLinks(epId, runId, {
          status: _auditState.statusFilter || undefined,
          q:      _auditState.q || undefined,
          offset: off,
          limit:  BATCH,
        }));
      }
      const results = await Promise.all(batches);
      if (_auditLoadToken !== myToken) return;
      for (const r of results) links.push(...r.links);
    }

    _vsLinks = links;
    _vsFocusIdx = -1;
    _vsSetup(wrap, panel, epId, runId);
    updateMinimapViewport(panel);
  } catch (e) {
    if (_auditLoadToken !== myToken) return;
    wrap.innerHTML = `<div style="padding:12px;font-size:0.78rem;color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
  }
}

function _vsSetup(wrap: HTMLElement, panel: HTMLElement, epId: string, runId: string) {
  wrap.innerHTML = `
    <table class="audit-table" style="table-layout:fixed">
      <colgroup>
        <col style="width:36px"><col style="width:180px"><col style="width:140px"><col style="width:140px">
        <col style="width:56px"><col style="width:70px"><col style="width:90px"><col style="width:130px"><col style="width:90px">
      </colgroup>
      <thead>
        <tr>
          <th>#</th><th>Transcript</th><th>Pivot</th><th>Cible</th>
          <th>Lang</th><th style="text-align:center">Conf.</th>
          <th>Statut</th><th>Note</th><th></th>
        </tr>
      </thead>
      <tbody id="audit-vs-tbody"></tbody>
    </table>`;
  _vsRender(wrap);

  wrap.addEventListener("scroll", () => {
    _vsRender(wrap);
    updateMinimapViewport(panel);
  }, { passive: true });

  // Event delegation — action buttons
  wrap.addEventListener("click", async (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".audit-action-btn[data-link-id]");
    if (!btn || btn.disabled) return;
    const linkId = btn.dataset.linkId!;
    const action = btn.dataset.action as "accepted" | "rejected" | "auto" | "ignored";
    btn.disabled = true;
    try {
      await setAlignLinkStatus(linkId, action);
      const idx = _vsLinks.findIndex((l) => l.link_id === linkId);
      if (idx >= 0) {
        _vsLinks[idx] = { ..._vsLinks[idx], status: action };
        const row = wrap.querySelector<HTMLTableRowElement>(`tr[data-link-id="${window.CSS.escape(linkId)}"]`);
        if (row) {
          row.className = action;
          const badge = row.querySelector(".audit-status-badge");
          if (badge) { badge.className = `audit-status-badge ${action}`; badge.textContent = _statusLabel(action); }
          const actionsCell = row.querySelector(".audit-row-actions");
          if (actionsCell) actionsCell.innerHTML = renderAuditActions(linkId, action);
        }
      }
      loadAuditStats(panel, epId, runId);
    } catch { btn.disabled = false; }
  });

  // Event delegation — note inputs
  wrap.addEventListener("focusout", async (e) => {
    const inp = (e.target as Element).closest<HTMLInputElement>(".audit-note-input");
    if (!inp) return;
    const newNote = inp.value.trim();
    if (newNote === inp.dataset.noteOrig) return;
    inp.disabled = true;
    try {
      await setAlignLinkNote(inp.dataset.linkId!, newNote || "");
      inp.dataset.noteOrig = newNote;
      const idx = _vsLinks.findIndex((l) => l.link_id === inp.dataset.linkId);
      if (idx >= 0) _vsLinks[idx] = { ..._vsLinks[idx], note: newNote };
    } catch { inp.value = inp.dataset.noteOrig!; }
    finally { inp.disabled = false; }
  });
}

function _vsRender(wrap: HTMLElement) {
  const tbody = wrap.querySelector<HTMLElement>("#audit-vs-tbody");
  if (!tbody || _vsLinks.length === 0) return;
  const total    = _vsLinks.length;
  const scrollTop = wrap.scrollTop;
  const viewH    = wrap.clientHeight || 400;
  const startIdx = Math.max(0, Math.floor(scrollTop / _VS_ROW_H) - _VS_BUFFER);
  const endIdx   = Math.min(total, Math.ceil((scrollTop + viewH) / _VS_ROW_H) + _VS_BUFFER);
  const topH     = startIdx * _VS_ROW_H;
  const botH     = Math.max(0, (total - endIdx) * _VS_ROW_H);
  const rows: string[] = [
    `<tr class="audit-vs-spacer" style="height:${topH}px"><td colspan="9"></td></tr>`,
  ];
  for (let i = startIdx; i < endIdx; i++) {
    rows.push(renderAuditLinkRow(_vsLinks[i], i === _vsFocusIdx ? " audit-focused" : ""));
  }
  rows.push(`<tr class="audit-vs-spacer" style="height:${botH}px"><td colspan="9"></td></tr>`);
  tbody.innerHTML = rows.join("");
}

function renderAuditLinkRow(lnk: AuditLink, extraClass = ""): string {
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
    <tr class="${lnk.status}${extraClass}" data-link-id="${escapeHtml(lnk.link_id)}">
      <td style="font-family:ui-monospace,monospace;font-size:0.68rem;color:var(--text-muted)">${n}</td>
      <td style="max-width:180px">${speaker}${segText || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="max-width:140px">${pivotText  || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="max-width:140px">${targetText || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td><span class="align-run-lang-badge">${escapeHtml(lnk.lang || "—")}</span></td>
      <td style="text-align:center;white-space:nowrap">${confBar}</td>
      <td><span class="audit-status-badge ${lnk.status}">${_statusLabel(lnk.status)}</span></td>
      <td><input class="audit-note-input" type="text" placeholder="Note…" value="${escapeHtml(lnk.note || "")}" data-link-id="${escapeHtml(lnk.link_id)}" data-note-orig="${escapeHtml(lnk.note || "")}"></td>
      <td class="audit-row-actions">${renderAuditActions(lnk.link_id, lnk.status)}</td>
    </tr>`;
}

/** Libellé court pour un statut de lien. */
function _statusLabel(status: string): string {
  if (status === "accepted") return "✓ accepté";
  if (status === "rejected") return "✗ rejeté";
  if (status === "ignored")  return "◌ ignoré";
  return "auto";
}

function renderAuditActions(linkId: string, currentStatus: string): string {
  const id = escapeHtml(linkId);
  if (currentStatus === "accepted") {
    return `<button class="audit-action-btn reject" data-link-id="${id}" data-action="rejected" title="Rejeter">✗</button>
            <button class="audit-action-btn ignore" data-link-id="${id}" data-action="ignored"  title="Ignorer (pas de traduction attendue)">◌</button>
            <button class="audit-action-btn undo"   data-link-id="${id}" data-action="auto"     title="Réinitialiser">↺</button>`;
  }
  if (currentStatus === "rejected") {
    return `<button class="audit-action-btn accept" data-link-id="${id}" data-action="accepted" title="Accepter">✓</button>
            <button class="audit-action-btn ignore" data-link-id="${id}" data-action="ignored"  title="Ignorer (pas de traduction attendue)">◌</button>
            <button class="audit-action-btn undo"   data-link-id="${id}" data-action="auto"     title="Réinitialiser">↺</button>`;
  }
  if (currentStatus === "ignored") {
    return `<button class="audit-action-btn accept" data-link-id="${id}" data-action="accepted" title="Accepter">✓</button>
            <button class="audit-action-btn reject" data-link-id="${id}" data-action="rejected" title="Rejeter">✗</button>
            <button class="audit-action-btn undo"   data-link-id="${id}" data-action="auto"     title="Réinitialiser">↺</button>`;
  }
  // auto : affiche les 3 actions
  return `<button class="audit-action-btn accept" data-link-id="${id}" data-action="accepted" title="Accepter">✓</button>
          <button class="audit-action-btn reject" data-link-id="${id}" data-action="rejected" title="Rejeter">✗</button>
          <button class="audit-action-btn ignore" data-link-id="${id}" data-action="ignored"  title="Ignorer (pas de traduction attendue)">◌</button>`;
}

function rewireAuditButtons(_wrap: HTMLElement) {
  // No-op: event delegation handles all button interactions (see _vsSetup).
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
            <span class="audit-status-badge ${t.status}">${_statusLabel(t.status)}</span>
            <span class="audit-collision-target-text" title="${escapeHtml(t.target_text || t.cue_id_target)}">${escapeHtml(t.target_text || t.cue_id_target)}</span>
            ${t.confidence != null ? `<span class="audit-collision-target-conf">${Math.round(t.confidence * 100)}%</span>` : ""}
            <div class="audit-collision-target-btns">
              <button class="audit-action-btn accept col-accept" data-link-id="${escapeHtml(t.link_id)}" title="Accepter">✓</button>
              <button class="audit-action-btn reject col-reject" data-link-id="${escapeHtml(t.link_id)}" title="Rejeter">✗</button>
              <button class="audit-action-btn col-retarget"
                data-link-id="${escapeHtml(t.link_id)}"
                data-pivot-text="${escapeHtml(c.pivot_text || c.pivot_cue_id)}"
                data-current-text="${escapeHtml(t.target_text || t.cue_id_target)}"
                data-lang="${escapeHtml(c.lang)}"
                data-around-cue="${escapeHtml(t.cue_id_target)}"
                title="Réassigner à un autre cue SRT"
                style="color:#1d4ed8;border-color:#93c5fd">🔄</button>
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

    // Retarget buttons (MX-040)
    listEl.querySelectorAll<HTMLButtonElement>(".col-retarget").forEach((btn) => {
      btn.addEventListener("click", () => {
        const linkId      = btn.dataset.linkId!;
        const pivotText   = btn.dataset.pivotText  ?? "";
        const currentText = btn.dataset.currentText ?? "";
        const lang        = btn.dataset.lang        ?? "";
        const aroundCue   = btn.dataset.aroundCue   ?? undefined;
        openRetargetModal({
          linkId,
          epId,
          lang,
          pivotText,
          currentTargetText: currentText,
          aroundCueId: aroundCue,
          onConfirm: () => {
            loadAuditCollisions(panel, epId, runId);
            loadAuditStats(panel, epId, runId);
          },
        });
      });
    });

  } catch (e) {
    listEl.innerHTML = `<div style="padding:14px;font-size:0.78rem;color:var(--danger)">${escapeHtml(e instanceof ApiError ? e.message : String(e))}</div>`;
  }
}

// ── Retarget modal (MX-040) ───────────────────────────────────────────────────

/**
 * Ouvre le modal de retarget pour réassigner la cue cible d'un lien d'alignement.
 *
 * Le modal affiche :
 * - Le texte pivot (contexte)
 * - La cue cible courante (barrée)
 * - Une recherche FTS + les N cues voisines (neighbourhood par défaut)
 * - La sélection d'une nouvelle cue → PATCH /alignment_links/{id}/retarget
 */
function openRetargetModal(opts: {
  linkId: string;
  epId: string;
  lang: string;
  pivotText: string;
  currentTargetText: string;
  aroundCueId?: string;
  onConfirm: () => void;
}) {
  const { linkId, epId, lang, pivotText, currentTargetText, aroundCueId, onConfirm } = opts;

  // ── Build modal DOM ────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "retarget-overlay";
  overlay.innerHTML = `
    <div class="retarget-modal" role="dialog" aria-modal="true" aria-label="Retarget cue">
      <div class="retarget-modal-header">
        <span class="retarget-modal-title">🔄 Réassigner la cue cible</span>
        <button class="retarget-modal-close" id="retarget-close" title="Fermer">✕</button>
      </div>
      <div class="retarget-context">
        <div class="retarget-context-pivot">
          <strong>Pivot :</strong> ${escapeHtml(pivotText.slice(0, 160))}
        </div>
        <div class="retarget-context-current">
          <strong>Cible actuelle :</strong> <s>${escapeHtml(currentTargetText.slice(0, 160))}</s>
        </div>
      </div>
      <div class="retarget-search-bar">
        <input id="retarget-search" type="search"
          placeholder="Rechercher une cue ${escapeHtml(lang.toUpperCase())}…"
          autocomplete="off" />
        <span class="retarget-search-hint">±10 voisins par défaut</span>
      </div>
      <div class="retarget-results" id="retarget-results">
        <div class="retarget-empty">Chargement…</div>
      </div>
      <div class="retarget-modal-footer">
        <span id="retarget-selection-label" style="flex:1;font-size:0.72rem;color:var(--text-muted)">Aucune sélection</span>
        <button class="audit-action-btn" id="retarget-cancel">Annuler</button>
        <button class="audit-action-btn accept" id="retarget-confirm" disabled>✓ Confirmer</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  let selectedCueId: string | null = null;
  let selectedCueText: string     = "";
  let _searchTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────

  function fmtMs(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function renderCues(cues: SubtitleCue[]) {
    const resultsEl = overlay.querySelector<HTMLElement>("#retarget-results")!;
    if (cues.length === 0) {
      resultsEl.innerHTML = `<div class="retarget-empty">Aucun cue trouvé.</div>`;
      return;
    }
    resultsEl.innerHTML = cues
      .map(
        (cue) => `
        <div class="retarget-cue-row${cue.cue_id === selectedCueId ? " selected" : ""}"
             data-cue-id="${escapeHtml(cue.cue_id)}"
             data-cue-text="${escapeHtml(cue.text_clean)}"
             title="${escapeHtml(cue.text_clean)}">
          <span class="retarget-cue-n">#${cue.n}</span>
          <span class="retarget-cue-time">${fmtMs(cue.start_ms)}</span>
          <span class="retarget-cue-text">${escapeHtml(cue.text_clean)}</span>
        </div>`,
      )
      .join("");

    // Wire click → select
    resultsEl.querySelectorAll<HTMLElement>(".retarget-cue-row").forEach((row) => {
      row.addEventListener("click", () => {
        resultsEl.querySelectorAll(".retarget-cue-row").forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");
        selectedCueId   = row.dataset.cueId!;
        selectedCueText = row.dataset.cueText ?? "";
        const label = overlay.querySelector<HTMLElement>("#retarget-selection-label")!;
        label.textContent = `Sélectionné : ${selectedCueText.slice(0, 80)}`;
        const confirmBtn = overlay.querySelector<HTMLButtonElement>("#retarget-confirm")!;
        confirmBtn.disabled = false;
      });
    });
  }

  async function loadCues(q?: string) {
    const resultsEl = overlay.querySelector<HTMLElement>("#retarget-results")!;
    resultsEl.innerHTML = `<div class="retarget-empty">Chargement…</div>`;
    try {
      const params: Parameters<typeof fetchSubtitleCues>[1] = { lang, limit: 40 };
      if (q) {
        params.q = q;
      } else if (aroundCueId) {
        params.around_cue_id = aroundCueId;
        params.around_window = 10;
      }
      const res = await fetchSubtitleCues(epId, params);
      renderCues(res.cues);
    } catch (e) {
      resultsEl.innerHTML = `<div class="retarget-empty" style="color:var(--danger)">${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────

  // Keyboard: Escape → close (déclaré avant close() pour que close() puisse l'utiliser)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  function close() {
    document.removeEventListener("keydown", onKey); // retiré dans tous les chemins
    overlay.remove();
  }

  overlay.querySelector<HTMLButtonElement>("#retarget-close")!.addEventListener("click", close);
  overlay.querySelector<HTMLButtonElement>("#retarget-cancel")!.addEventListener("click", close);

  // Click outside modal → close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", onKey);

  // Search input with debounce
  const searchInput = overlay.querySelector<HTMLInputElement>("#retarget-search")!;
  searchInput.addEventListener("input", () => {
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      const q = searchInput.value.trim();
      loadCues(q || undefined);
    }, 300);
  });

  // Confirm button
  overlay.querySelector<HTMLButtonElement>("#retarget-confirm")!.addEventListener("click", async () => {
    if (!selectedCueId) return;
    const confirmBtn = overlay.querySelector<HTMLButtonElement>("#retarget-confirm")!;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "…";
    try {
      await retargetAlignLink(linkId, selectedCueId);
      close();
      onConfirm();
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "✓ Confirmer";
      const label = overlay.querySelector<HTMLElement>("#retarget-selection-label")!;
      label.style.color = "var(--danger)";
      label.textContent = `Erreur : ${e instanceof Error ? e.message : String(e)}`;
    }
  });

  // Focus search + initial load
  requestAnimationFrame(() => searchInput.focus());
  loadCues();
}

// ── Export rapport de run (MX-038) ────────────────────────────────────────────

/**
 * Génère et sauvegarde un rapport JSON complet d'un run d'alignement.
 *
 * Le rapport inclut :
 * - Métadonnées du run (episode_id, episode_title, run_id, timestamp)
 * - Statistiques agrégées (nb_links, nb_pivot, nb_target, by_status, avg_confidence, coverage_pct, n_collisions)
 * - Liste complète des liens d'alignement (tous statuts, sans pagination)
 * - Liste des collisions avec leurs cibles candidates
 *
 * Ouvre un dialog "Enregistrer sous" Tauri pour laisser l'utilisateur choisir
 * l'emplacement. Annule silencieusement si l'utilisateur ferme le dialog.
 */
async function exportAuditReport(
  epId: string,
  epTitle: string,
  runId: string,
): Promise<void> {
  // Fetch toutes les données en parallèle (limit 9999 = pas de pagination pour l'export)
  const [stats, collisionsRes, linksRes] = await Promise.all([
    fetchAlignRunStats(epId, runId),
    fetchAlignCollisions(epId, runId),
    fetchAuditLinks(epId, runId, { limit: 9999, offset: 0 }),
  ]);

  const report = {
    version:       "1.0",
    generated_at:  new Date().toISOString(),
    episode_id:    epId,
    episode_title: epTitle,
    run_id:        runId,
    stats: {
      nb_links:       stats.nb_links,
      nb_pivot:       stats.nb_pivot,
      nb_target:      stats.nb_target,
      by_status:      stats.by_status,
      avg_confidence: stats.avg_confidence,
      coverage_pct:   stats.coverage_pct,
      n_collisions:   stats.n_collisions,
    },
    collisions: collisionsRes.collisions.map((col) => ({
      pivot_cue_id: col.pivot_cue_id,
      pivot_text:   col.pivot_text,
      lang:         col.lang,
      n_targets:    col.n_targets,
      targets:      col.targets.map((t) => ({
        link_id:        t.link_id,
        cue_id_target:  t.cue_id_target,
        target_text:    t.target_text,
        confidence:     t.confidence,
        status:         t.status,
      })),
    })),
    links: linksRes.links.map((lnk) => ({
      link_id:          lnk.link_id,
      role:             lnk.role,
      lang:             lnk.lang,
      confidence:       lnk.confidence,
      status:           lnk.status,
      segment_id:       lnk.segment_id,
      cue_id:           lnk.cue_id,
      cue_id_target:    lnk.cue_id_target,
      segment_n:        lnk.segment_n,
      speaker_explicit: lnk.speaker_explicit,
      text_segment:     lnk.text_segment,
      text_pivot:       lnk.text_pivot,
      text_target:      lnk.text_target,
    })),
  };

  const json = JSON.stringify(report, null, 2);

  // Nom de fichier par défaut : himyc_audit_<ep>_<run8>.json
  const safeEp  = epId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const safeRun = runId.slice(0, 8);
  const defaultPath = `himyc_audit_${safeEp}_${safeRun}.json`;

  const filePath = await save({
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!filePath) return;  // utilisateur a annulé

  await writeTextFile(filePath, json);
}

/**
 * Génère un rapport HTML de l'audit et déclenche un téléchargement (blob URL).
 * G-009 / MX-046 — pas de dialog Tauri, download standard navigateur.
 */
async function exportAuditReportHtml(
  epId: string,
  epTitle: string,
  runId: string,
): Promise<void> {
  const [stats, linksRes] = await Promise.all([
    fetchAlignRunStats(epId, runId),
    fetchAuditLinks(epId, runId, { limit: 9999, offset: 0 }),
  ]);

  const byStatus = stats.by_status ?? {};
  const nAccepted = byStatus.accepted ?? 0;
  const nRejected = byStatus.rejected ?? 0;
  const nIgnored  = byStatus.ignored  ?? 0;
  const nAuto     = byStatus.auto     ?? 0;
  const pct       = stats.coverage_pct != null ? `${Math.round(stats.coverage_pct)}%` : "—";
  const avgConf   = stats.avg_confidence != null ? `${Math.round(stats.avg_confidence * 100)}%` : "—";
  const now       = new Date().toLocaleString("fr-FR");

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      accepted: "#16a34a", rejected: "#dc2626", ignored: "#64748b", auto: "#0ea5e9",
    };
    return `<span style="background:${colors[s] ?? "#888"};color:#fff;border-radius:3px;padding:1px 5px;font-size:0.72em;font-weight:700">${s}</span>`;
  };

  const rowsHtml = linksRes.links.map((lnk) => {
    const conf = lnk.confidence != null ? `${Math.round(lnk.confidence * 100)}%` : "—";
    return `<tr>
      <td style="font-family:monospace;font-size:.7em;color:#888">${lnk.segment_n ?? "—"}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(lnk.text_segment ?? "")}">${escapeHtml((lnk.text_segment ?? "").slice(0, 80))}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(lnk.text_pivot ?? "")}">${escapeHtml((lnk.text_pivot ?? "").slice(0, 60))}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(lnk.text_target ?? "")}">${escapeHtml((lnk.text_target ?? "").slice(0, 60))}</td>
      <td style="text-align:center;white-space:nowrap">${lnk.lang ?? "—"}</td>
      <td style="text-align:center;white-space:nowrap">${conf}</td>
      <td style="text-align:center">${statusBadge(lnk.status)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport audit — ${escapeHtml(epTitle)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 1.5rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: .25rem; }
  .meta { font-size: .8rem; color: #888; margin-bottom: 1.5rem; font-family: monospace; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: .75rem; margin-bottom: 1.5rem; }
  .kpi { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: .75rem; text-align: center; }
  .kpi-val { font-size: 1.4rem; font-weight: 700; color: #1a1a1a; }
  .kpi-lbl { font-size: .72rem; color: #6b7280; margin-top: .15rem; }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; margin-top: .5rem; }
  th { background: #f3f4f6; border-bottom: 2px solid #d1d5db; padding: 5px 8px; text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
  tr:nth-child(even) td { background: #fafafa; }
  .footer { font-size: .72rem; color: #9ca3af; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Rapport d'audit — ${escapeHtml(epTitle)}</h1>
<div class="meta">Run : ${escapeHtml(runId)} · Généré le ${escapeHtml(now)}</div>

<div class="kpi-grid">
  <div class="kpi"><div class="kpi-val">${stats.nb_links}</div><div class="kpi-lbl">Liens total</div></div>
  <div class="kpi"><div class="kpi-val">${nAccepted}</div><div class="kpi-lbl">Acceptés</div></div>
  <div class="kpi"><div class="kpi-val">${nRejected}</div><div class="kpi-lbl">Rejetés</div></div>
  <div class="kpi"><div class="kpi-val">${nIgnored}</div><div class="kpi-lbl">Ignorés</div></div>
  <div class="kpi"><div class="kpi-val">${nAuto}</div><div class="kpi-lbl">Auto</div></div>
  <div class="kpi"><div class="kpi-val">${pct}</div><div class="kpi-lbl">Couverture</div></div>
  <div class="kpi"><div class="kpi-val">${avgConf}</div><div class="kpi-lbl">Conf. moy.</div></div>
  <div class="kpi"><div class="kpi-val">${stats.n_collisions ?? 0}</div><div class="kpi-lbl">Collisions</div></div>
</div>

<table>
  <thead>
    <tr><th>#</th><th>Transcript</th><th>Pivot</th><th>Cible</th><th>Lang</th><th>Conf.</th><th>Statut</th></tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="footer">HIMYC · ${escapeHtml(runId)}</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const safeEp  = epId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  a.href     = url;
  a.download = `himyc_audit_${safeEp}_${runId.slice(0, 8)}.html`;
  a.click();
  URL.revokeObjectURL(url);
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
    const pivotLang = res.pivot_lang || "en";
    // Determine which lang columns are populated
    const langCols: Array<{ lang: "en" | "fr" | "it"; key: keyof ConcordanceRow }> = (
      ["en", "fr", "it"] as const
    )
      .filter((lg) => res.rows.some((r) => r[`text_${lg}` as keyof ConcordanceRow]))
      .map((lg) => ({ lang: lg, key: `text_${lg}` as keyof ConcordanceRow }));

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

    const confBadge = (conf: number | null | undefined) =>
      conf != null ? `<span class="conc-conf">${Math.round(conf * 100)}%</span>` : "";

    const colHeaders = [
      `<th>#</th>`,
      `<th>Personnage</th>`,
      `<th>Transcript</th>`,
      ...langCols.map(({ lang }) =>
        `<th>${lang.toUpperCase()}${lang === pivotLang ? " <small>(pivot)</small>" : ""}</th>`),
    ].join("");

    const rowsHtml = res.rows.map((row: ConcordanceRow, i: number) => {
      const speakerHtml = row.speaker
        ? `<span class="conc-speaker">${escapeHtml(row.speaker)}</span>` : "";
      const langCells = langCols.map(({ lang }) => {
        const text = (row[`text_${lang}` as keyof ConcordanceRow] as string) || "";
        const conf = lang === pivotLang
          ? row.confidence_pivot
          : (row[`confidence_${lang}` as keyof ConcordanceRow] as number | null);
        return `<td style="max-width:180px">${highlight(text)}${confBadge(conf)}</td>`;
      }).join("");
      return `<tr>
        <td style="font-family:ui-monospace,monospace;font-size:0.68rem;color:var(--text-muted);text-align:right">${i + 1}</td>
        <td style="font-size:0.72rem;color:var(--accent);white-space:nowrap">${speakerHtml}</td>
        <td style="max-width:200px">${highlight(row.text_segment)}</td>
        ${langCells}
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
    const [episodesData, runsData] = await Promise.all([
      fetchEpisodes(),
      fetchAllAlignmentRuns().catch(() => ({ runs: [] })),
    ]);
    _cachedEpisodes = episodesData;
    // Build per-episode set of aligned target langs (from the most recent run per lang)
    const alignedLangs = new Map<string, Set<string>>(); // episode_id → Set<lang>
    for (const run of runsData.runs) {
      if (!run.episode_id) continue;
      if (!alignedLangs.has(run.episode_id)) alignedLangs.set(run.episode_id, new Set());
      (run.target_langs ?? []).forEach((l: string) => alignedLangs.get(run.episode_id)!.add(l));
    }
    renderAlignementPane(container, episodesData.episodes, alignedLangs);
    updateHubStats(container);
    // Persistance inter-sous-vues : ré-ouvrir l'épisode actif si on vient d'une autre sous-vue
    const alignWrap = container.querySelector<HTMLElement>(".align-ep-wrap");
    if (alignWrap) autoSelectSharedEp(alignWrap, "tr[data-ep-id]", "active-row");
  } catch (e) {
    if (wrap) {
      const alignErr = document.createElement("div");
      alignErr.className = "cons-loading";
      alignErr.textContent = e instanceof ApiError ? e.message : String(e);
      wrap.innerHTML = "";
      wrap.appendChild(alignErr);
    }
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
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="corpus" data-fmt="jsonl">JSONL</button>
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
              <button class="btn btn-secondary btn-sm exp-export-btn" data-scope="segments" data-fmt="docx">DOCX</button>
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
      <span class="pers-toolbar-title">Personnages — catalogue</span>
      <button class="btn btn-primary" id="pers-add-btn" style="font-size:0.8rem">+ Nouveau</button>
      <button class="btn btn-secondary btn-sm" id="pers-import-speakers-btn" title="Crée une entrée catalogue par locuteur distinct trouvé sur les segments (speaker_explicit), comme sous PyQt">Importer depuis les segments</button>
      <button class="btn btn-secondary btn-sm" id="pers-auto-btn" title="Compare speaker_explicit des segments aux id / noms / alias du catalogue (comme la logique d’appariement Qt)">⚡ Auto-assigner</button>
      <button class="btn btn-ghost btn-sm" id="pers-goto-dist" title="Tableau réplique ↔ personnage (équivalent partie « tours » de l’onglet PyQt)">Distribution →</button>
      <button class="btn btn-ghost btn-sm" id="pers-refresh">↺</button>
    </div>
    <div class="pers-intro" style="margin:0 16px 12px;line-height:1.55;font-size:0.8rem;color:var(--text);max-width:52rem">
      <p style="margin:0 0 8px"><strong>But</strong> : une <em>base de personnages</em> du projet (fichier catalogue + API). Chaque entrée a un <strong>id</strong>, un nom <strong>canonique</strong>, des noms <strong>par langue</strong> et des <strong>alias</strong> (variantes « TED », « Marshall », etc.) pour reconnaître les libellés dans le transcript ou les SRT. <strong>Importer depuis les segments</strong> préremplit le catalogue avec les locuteurs déjà présents sur les segments (équivalent PyQt).</p>
      <p style="margin:0 0 8px"><strong>Assignation d’un nom</strong> : soit <strong>automatique</strong> via ⚡ Auto-assigner (correspondance entre le locuteur déjà présent sur les segments et le catalogue), soit <strong>manuelle</strong> ligne par ligne dans <strong>Actions → Distribution</strong> (choix du personnage par réplique utterance). Vous pouvez tout saisir à la main dans le formulaire ci-dessous.</p>
      <p style="margin:0;font-size:0.76rem;color:var(--text-muted)"><strong>Rappel PyQt</strong> : le même onglet regroupait le catalogue <em>et</em> un tableau par épisode (segments phrases / tours / cues) avec « Suggérer par alias ». Ici le catalogue reste dans cet onglet ; le tableau des tours (utterance) est dans Distribution.</p>
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

  pane.querySelector<HTMLButtonElement>("#pers-import-speakers-btn")?.addEventListener("click", async () => {
    const btn = pane.querySelector<HTMLButtonElement>("#pers-import-speakers-btn")!;
    const resultEl = pane.querySelector<HTMLElement>("#pers-auto-result")!;
    btn.disabled = true;
    resultEl.style.display = "none";
    try {
      const r = await importCharactersFromSegments();
      if (r.added > 0) {
        resultEl.textContent = `✓ ${r.added} entrée(s) ajoutée(s) (${r.total_characters} dans le catalogue).`;
        resultEl.style.cssText =
          "display:block;background:#f0fdf4;color:#166534;margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
      } else if (r.message) {
        resultEl.textContent = `ℹ ${r.message}`;
        resultEl.style.cssText =
          "display:block;background:var(--surface2);color:var(--text-muted);margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
      } else {
        resultEl.textContent = "ℹ Aucune nouvelle entrée.";
        resultEl.style.cssText =
          "display:block;background:var(--surface2);color:var(--text-muted);margin:4px 16px;font-size:0.78rem;padding:6px 10px;border-radius:var(--radius)";
      }
      void loadPersonnages(pane);
    } catch (e) {
      const errEl = pane.querySelector<HTMLElement>("#pers-error");
      if (errEl) {
        errEl.textContent = e instanceof Error ? e.message : String(e);
        errEl.style.display = "block";
      }
    } finally {
      btn.disabled = false;
    }
  });

  pane.querySelector<HTMLButtonElement>("#pers-goto-dist")?.addEventListener("click", () => {
    localStorage.setItem(lsKey(ACTIVE_SECTION_LS_KEY), "actions");
    localStorage.setItem(lsKey(ACTIVE_SUBVIEW_LS_KEY), "distribution");
    _ctx?.navigateTo("constituer");
    document.dispatchEvent(new CustomEvent("himyc:open-distribution"));
  });

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
      const assignCount = _assignments.filter((a) => a.character_id === c.id).length;
      const assignMsg = assignCount > 0 ? ` et ses ${assignCount} assignation(s)` : "";
      if (!confirm(`Supprimer « ${c.canonical} »${assignMsg} ? (irréversible)`)) return;
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
          Aucune assignation. Création via <strong>Auto-assigner</strong> (locuteurs reconnus) ; affinage manuel : <strong>Constituer → Actions → Distribution</strong>.
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
    const raw = localStorage.getItem(lsKey(PRESETS_KEY));
    if (raw) return JSON.parse(raw) as ProjectPreset[];
  } catch { /* */ }
  return [...SEED_PRESETS];
}

function savePresets(list: ProjectPreset[]) {
  localStorage.setItem(lsKey(PRESETS_KEY), JSON.stringify(list));
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
      localStorage.setItem(lsKey(ACTIVE_PRESET_LS_KEY), JSON.stringify(p));
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
  _projectPrefix = ctx.getProjectId();
  _distSourceKind = readDistSourceKind();
  _distCueLang = localStorage.getItem(lsKey(DIST_CUE_LANG_LS_KEY)) ?? "en";
  _navCollapsed = localStorage.getItem(lsKey(NAV_COLLAPSED_LS_KEY)) === "1";
  const _savedSubView = localStorage.getItem(lsKey(ACTIVE_SUBVIEW_LS_KEY));
  if (
    _savedSubView === "hub"
    || _savedSubView === "curation"
    || _savedSubView === "distribution"
    || _savedSubView === "segmentation"
    || _savedSubView === "alignement"
  ) {
    _activeActionsSubView = _savedSubView;
  }
  const _savedSection = localStorage.getItem(lsKey(ACTIVE_SECTION_LS_KEY));
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

        <div class="cons-nav-tree-body">
          <button class="cons-nav-tree-link${_activeSection === "actions" && _activeActionsSubView === "curation"     ? " active" : ""}" data-subview="curation">Curation</button>
          <button class="cons-nav-tree-link${_activeSection === "actions" && _activeActionsSubView === "segmentation" ? " active" : ""}" data-subview="segmentation">Segmentation</button>
          <button class="cons-nav-tree-link${_activeSection === "actions" && _activeActionsSubView === "distribution" ? " active" : ""}" data-subview="distribution">Distribution</button>
          <button class="cons-nav-tree-link${_activeSection === "actions" && _activeActionsSubView === "alignement"   ? " active" : ""}" data-subview="alignement">Alignement</button>
        </div>

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

          <!-- Hub : traitement par lot ─────────────────────────────────── -->
          <div class="cons-actions-pane${_activeActionsSubView === "hub" ? " active" : ""}" data-subview="hub">
            <div class="cons-toolbar">
              <span class="cons-toolbar-title">Traitement par lot</span>
              <button class="btn btn-ghost btn-sm" id="cons-hub-refresh">↺ Statut</button>
              <span class="cons-api-dot ${ctx.getBackendStatus().online ? "online" : "offline"}" id="cons-api-dot"></span>
            </div>
            <div class="cons-error hub-error" style="display:none"></div>
            <div class="acts-hub">

              <!-- Étape 1 : Curation -->
              <div class="acts-hub-step">
                <div class="acts-hub-step-title">1 — Curation<span class="hub-step-stat" id="hub-stat-cur"></span></div>
                <div class="acts-hub-step-body">
                  <div class="acts-params">
                    <div class="acts-params-group">
                      <span class="acts-params-label">Profil</span>
                      <select class="acts-params-select" id="hub-profile">
                        ${NORMALIZE_PROFILES.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("")}
                      </select>
                      <span class="acts-params-feedback" id="hub-profile-fb"></span>
                    </div>
                    <div class="acts-params-sep"></div>
                    <div class="acts-params-group">
                      <span class="acts-params-label">Portée</span>
                      <label class="acts-params-radio"><input type="radio" name="hub-scope" value="pending" checked> Non norm.</label>
                      <label class="acts-params-radio"><input type="radio" name="hub-scope" value="all"> Tous</label>
                    </div>
                    <div class="acts-params-sep"></div>
                    <button class="btn btn-primary btn-sm" id="cons-batch-normalize">⚡ Normaliser tout</button>
                  </div>
                  <div class="acts-hub-status" id="hub-norm-status"></div>
                </div>
              </div>

              <!-- Étape 2 : Segmentation -->
              <div class="acts-hub-step">
                <div class="acts-hub-step-title">2 — Segmentation<span class="hub-step-stat" id="hub-stat-seg"></span></div>
                <div class="acts-hub-step-body">
                  <div class="acts-params">
                    <div class="acts-params-group">
                      <span class="acts-params-label">Type</span>
                      <select class="acts-params-select" id="hub-seg-kind">
                        <option value="utterance">Utterance (locuteur)</option>
                        <option value="sentence">Phrase</option>
                      </select>
                    </div>
                    <div class="acts-params-sep"></div>
                    <div class="acts-params-group">
                      <span class="acts-params-label">Langue</span>
                      <select class="acts-params-select" id="hub-seg-lang">
                        <option value="en">Anglais (en)</option>
                        <option value="fr">Français (fr)</option>
                        <option value="de">Allemand (de)</option>
                        <option value="es">Espagnol (es)</option>
                        <option value="it">Italien (it)</option>
                      </select>
                    </div>
                    <div class="acts-params-sep"></div>
                    <div class="acts-params-group">
                      <span class="acts-params-label">Portée</span>
                      <label class="acts-params-radio"><input type="radio" name="hub-seg-scope" value="normalized" checked> Norm. seulement</label>
                      <label class="acts-params-radio"><input type="radio" name="hub-seg-scope" value="all"> Tous</label>
                    </div>
                    <div class="acts-params-sep"></div>
                    <button class="btn btn-secondary btn-sm" id="cons-batch-segment">🔤 Segmenter tout</button>
                  </div>
                  <div class="acts-hub-status" id="hub-seg-status"></div>
                </div>
              </div>

              <!-- Étape 3 : Alignement -->
              <div class="acts-hub-step">
                <div class="acts-hub-step-title">3 — Alignement<span class="hub-step-stat" id="hub-stat-align"></span></div>
                <div class="acts-hub-step-body">
                  <div class="acts-params">
                    <div class="acts-params-group">
                      <span class="acts-params-label">Pivot lang</span>
                      <input class="acts-params-select" id="hub-align-lang" type="text" value="fr"
                        style="width:44px;padding:3px 6px;font-size:0.8rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"
                        title="Code langue du transcript pivot (fr, en, de…)">
                    </div>
                    <div class="acts-params-sep"></div>
                    <div class="acts-params-group">
                      <span class="acts-params-label">Segments</span>
                      <select class="acts-params-select" id="hub-align-seg-kind">
                        <option value="utterance">Utterance</option>
                        <option value="sentence">Phrase</option>
                      </select>
                    </div>
                    <div class="acts-params-sep"></div>
                    <div class="acts-params-group">
                      <span class="acts-params-label">Conf. min.</span>
                      <input type="range" class="acts-params-range" id="hub-align-conf"
                        min="0.1" max="0.95" step="0.05" value="0.3">
                      <span class="acts-params-range-val" id="hub-align-conf-val">0.30</span>
                    </div>
                    <div class="acts-params-sep"></div>
                    <div class="acts-params-group">
                      <label class="acts-params-check">
                        <input type="checkbox" id="hub-align-sim">
                        Similarité textuelle
                      </label>
                    </div>
                    <div class="acts-params-sep"></div>
                    <button class="btn btn-secondary btn-sm" id="cons-batch-align">⚡ Aligner tout</button>
                  </div>
                  <div id="cons-batch-align-fb" style="font-size:0.75rem;margin-top:3px"></div>
                  <div class="acts-hub-status" id="hub-align-status"></div>
                </div>
              </div>

            </div>
          </div>

          <!-- Curation sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "curation" ? " active" : ""}" data-subview="curation">
            <div class="cons-toolbar">
              <span class="cons-toolbar-title">Curation — épisode</span>
              <button class="btn btn-ghost btn-sm" id="cons-refresh">↺ Actualiser</button>
            </div>
            <div class="cons-error" style="display:none"></div>
            <div class="cur-3col">

              <!-- Params (gauche) -->
              <div class="cur-params-col">
                <div class="cur-col-head">Paramètres</div>

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
                  <div class="cur-param-label" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" id="cur-opts-toggle">
                    Options avancées <span id="cur-opts-caret" style="font-size:0.7rem;color:var(--text-muted)">▼</span>
                  </div>
                  <div id="cur-opts-panel" style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
                    <label class="cur-opt-row" title="Fusionne les coupures de ligne au milieu d'une phrase (style sous-titres). Ex : « I can't↵believe you » → « I can't believe you »"><input type="checkbox" id="cur-opt-merge" checked> Fusionner sauts de ligne (sous-titres)</label>
                    <label class="cur-opt-row"><input type="checkbox" id="cur-opt-double" checked> Supprimer espaces doubles</label>
                    <div class="cur-opt-row" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <span style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap">Ponctuation</span>
                      <select id="cur-punct" title="Une seule règle à la fois : FR ou EN" style="font-size:0.78rem;flex:1;min-width:0;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">
                        <option value="none">— Aucune —</option>
                        <option value="fr">Typographie française (espaces avant : ; ! ?)</option>
                        <option value="en">Ponctuation anglaise (suppr. espaces avant : ; ! ?)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div class="cur-param-section">
                  <div class="cur-param-label">Normaliser</div>
                  <div id="cur-norm-panel" style="margin-top:6px;display:flex;flex-direction:column;gap:4px">
                    <label class="cur-opt-row"><input type="checkbox" id="cur-norm-apos"> Normaliser apostrophes (' → ')</label>
                    <label class="cur-opt-row"><input type="checkbox" id="cur-norm-quotes"> Normaliser guillemets ("" → « »)</label>
                    <label class="cur-opt-row"><input type="checkbox" id="cur-norm-strip" checked> Supprimer espaces bord de ligne</label>
                    <label class="cur-opt-row" title="Supprime les lignes vides avant la fusion, permettant de merger des phrases à travers les paragraphes"><input type="checkbox" id="cur-norm-strip-empty"> Supprimer lignes vides (fusion inter-paragraphe)</label>
                    <div class="cur-opt-row" style="display:flex;align-items:center;gap:6px;margin-top:2px">
                      <span style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap">Casse</span>
                      <select id="cur-norm-case" style="font-size:0.78rem;flex:1;padding:2px 4px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">
                        <option value="none">— inchangée —</option>
                        <option value="lowercase">minuscules</option>
                        <option value="UPPERCASE">MAJUSCULES</option>
                        <option value="Title Case">Title Case</option>
                        <option value="Sentence case">Sentence case</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div class="cur-param-section">
                  <div class="cur-param-label" style="display:flex;justify-content:space-between;align-items:center">
                    Règles actives
                    <span style="font-size:0.68rem;color:var(--text-muted);font-weight:400;font-style:italic">cliquer pour activer/désactiver</span>
                  </div>
                  <div class="cur-rule-chips" id="cur-rule-chips"></div>
                  <div id="cur-preview-feedback" style="font-size:0.68rem;color:var(--text-muted);margin-top:4px;font-style:italic">Sélectionnez un épisode pour voir l'aperçu.</div>
                  <button class="btn btn-primary" id="cur-apply-normalize" disabled style="margin-top:8px;width:100%;font-size:0.85rem">Normaliser et sauvegarder</button>
                </div>

                <div class="cur-param-section">
                  <div class="cur-param-label">Rechercher / Remplacer</div>
                  <input class="cur-fr-input" id="cur-fr-find"    type="text" placeholder="Rechercher…" spellcheck="false">
                  <input class="cur-fr-input" id="cur-fr-replace" type="text" placeholder="Remplacer par…" spellcheck="false">
                  <div class="cur-fr-options">
                    <label><input type="checkbox" id="cur-fr-regex"> <code style="font-size:0.72rem">.*</code> RegEx</label>
                    <label><input type="checkbox" id="cur-fr-nocase"> Aa insensible</label>
                  </div>
                  <div class="cur-fr-count" id="cur-fr-count"></div>
                  <div class="cur-fr-actions">
                    <button type="button" class="btn btn-ghost btn-sm" id="cur-fr-search">🔍 Rechercher</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="cur-fr-apply" title="Applique tous les remplacements et enregistre le transcript">Remplacer et sauvegarder</button>
                  </div>
                </div>

                <div class="cur-param-section" id="cur-srt-section">
                  <div class="cur-param-label">Pistes SRT</div>
                  <select class="acts-params-select" id="cur-srt-lang" style="width:100%;margin-bottom:6px" disabled>
                    <option value="">— Sélectionnez un épisode —</option>
                  </select>
                  <button type="button" class="btn btn-secondary btn-sm" id="cur-srt-normalize" disabled style="width:100%;margin-bottom:4px">🧹 Normaliser SRT</button>
                  <button type="button" class="btn btn-ghost btn-sm" id="cur-srt-view-btn" disabled style="width:100%">📋 Voir / éditer cues</button>
                  <span id="cur-srt-fb" style="font-size:0.72rem;color:var(--text-muted);display:block;margin-top:4px"></span>
                </div>

              </div>

              <!-- Preview (centre) -->
              <div class="cur-preview-col">
                <div class="cur-src-bar" id="cur-src-bar">
                  <span style="font-size:0.72rem;color:var(--text-muted);font-style:italic">← Sélectionnez un épisode</span>
                </div>
                <div class="cur-preview-bar">
                  <button class="cur-preview-tab active" data-mode="side">Côte à côte</button>
                  <button class="cur-preview-tab" data-mode="raw">Brut seul</button>
                  <button class="cur-preview-tab" data-mode="clean">Normalisé seul</button>
                  <button class="cur-preview-tab" data-mode="diff">Diff mot</button>
                  <button class="cur-preview-tab" data-mode="srt">SRT</button>
                  <span class="cur-preview-badge" id="cur-preview-badge"></span>
                  <button class="btn btn-ghost btn-sm" id="cur-edit-btn" style="margin-left:auto;font-size:0.72rem" title="Éditer le texte normalisé">✏ Éditer</button>
                </div>
                <div class="cur-edit-bar" id="cur-edit-bar" style="display:none">
                  <span class="cur-edit-status" id="cur-edit-status">Édition du texte normalisé</span>
                  <button class="btn btn-primary btn-sm" id="cur-save-btn">💾 Sauvegarder</button>
                  <button class="btn btn-ghost btn-sm" id="cur-cancel-btn">✕ Annuler</button>
                </div>
                <div class="cur-speaker-strip" id="cur-speaker-strip" style="display:none">
                  <span class="cur-speaker-strip-label">Locuteur :</span>
                </div>
                <div class="cur-preview-panes" id="cur-preview-panes">
                  <div class="acts-text-empty" style="width:100%">← Sélectionnez un épisode</div>
                </div>
                <div id="cur-srt-cues-pane" style="display:none;flex:1;min-height:0;overflow-y:auto;border-top:1px solid var(--border);padding:8px 0">
                  <div id="cur-srt-cues-list" style="display:flex;flex-direction:column;gap:2px"></div>
                  <div id="cur-srt-cues-more" style="display:none;padding:8px 12px">
                    <button class="btn btn-ghost btn-sm" id="cur-srt-load-more" style="width:100%">Charger plus…</button>
                  </div>
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
              <span class="cons-toolbar-title">Segmentation — épisode</span>
              <button class="btn btn-ghost btn-sm" id="cons-refresh-seg">↺ Actualiser</button>
            </div>
            <details class="seg-help-panel">
              <summary>Segmentation</summary>
              <div class="seg-help-body">
                <p>Le <strong>clean</strong> est découpé en <strong>phrases</strong> et en <strong>tours</strong> (<code>NOM:&nbsp;</code>). L’<strong>aperçu</strong> utilise le même moteur que le job. Après un run, le tableau sert à <strong>vérifier et corriger</strong>.</p>
                <p class="seg-help-muted" style="margin-top:6px">Pour <strong>lancer le job</strong> : bouton sur la ligne de l’épisode (colonne de gauche) ou bouton <strong>Lancer la segmentation</strong> dans le panneau de droite une fois l’épisode sélectionné. Le <strong>Hub</strong> (traitement par lot) propose aussi « Segmenter tout ».</p>
              </div>
            </details>
            <p class="seg-toolbar-hint">Sélectionnez un épisode dans la liste à gauche, puis lancez la segmentation depuis la ligne ou depuis le panneau de droite.</p>
            <!-- Params panel -->
            <div class="acts-params">
              <div class="acts-params-group">
                <span class="acts-params-label" title="Filtre du tableau des segments en base — le job produit toujours phrases et tours">Unités (tableau)</span>
                <select class="acts-params-select" id="seg-kind" title="Quel type de lignes afficher dans le tableau des segments en base — le job produit toujours phrases et tours">
                  <option value="utterance">Tours (utterances)</option>
                  <option value="sentence">Phrases</option>
                </select>
              </div>
              <div class="acts-params-group" title="Langue pour les règles de découpage phrase (segmentation) — alignée sur le Hub">
                <span class="acts-params-label">Langue</span>
                <select class="acts-params-select" id="seg-lang-hint">
                  <option value="en">Anglais (en)</option>
                  <option value="fr">Français (fr)</option>
                  <option value="de">Allemand (de)</option>
                  <option value="es">Espagnol (es)</option>
                  <option value="it">Italien (it)</option>
                </select>
              </div>
            </div>
            <div class="cons-error seg-error" style="display:none"></div>
            <!-- Vue Table -->
            <div id="seg-view-table" class="acts-split" style="flex:1;min-height:0;overflow:hidden">
              <div class="acts-ep-list" id="seg-acts-ep-list">
                <div class="acts-ep-list-title">
                  <span class="acts-ep-list-label">Épisodes</span>
                  <button type="button" class="acts-ep-collapse-btn" data-collapse-target="seg-acts-ep-list" title="Réduire la liste" aria-expanded="true" aria-controls="seg-acts-ep-list">‹</button>
                </div>
                <div class="acts-ep-filters" role="search">
                  <div class="acts-ep-filter-row">
                    <label class="acts-ep-filter-label" for="seg-ep-season">Saison</label>
                    <select id="seg-ep-season" class="acts-ep-filter-select" aria-label="Filtrer par saison">
                      <option value="all">Toutes les saisons</option>
                    </select>
                  </div>
                  <input type="search" id="seg-ep-search" class="acts-ep-filter-search" placeholder="Rechercher (ID, titre)…" autocomplete="off" />
                </div>
                <div class="seg-table-wrap cons-loading">Chargement…</div>
              </div>
              <div class="acts-text-panel" id="seg-text-panel">
                <div class="acts-text-empty">← Sélectionnez un épisode</div>
              </div>
            </div>
          </div>

          <!-- Distribution sub-pane : assignation personnage ↔ segments / cues -->
          <div class="cons-actions-pane${_activeActionsSubView === "distribution" ? " active" : ""}" data-subview="distribution">
            <div class="cons-toolbar">
              <span class="cons-toolbar-title">Distribution</span>
              <button class="btn btn-ghost btn-sm" id="cons-refresh-distribution" title="Recharger">↺ Actualiser</button>
            </div>
            <div class="acts-hub" id="dist-panel-root" style="padding:12px 16px; flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; width:100%">
              <p style="margin:0 0 10px;font-size:0.82rem;color:var(--text);line-height:1.45">
                Personnage par ligne selon la <strong>source</strong> (tours / phrases / cues). Catalogue : <strong>Personnages</strong>.
                Mode <strong>tours</strong> : colonne locuteur (<code>speaker_explicit</code>). Bouton <strong>Alias</strong> : préremplit si le texte commence par un alias.
                <span style="color:var(--text-muted)"> · Enregistrer → assignations, puis alignement.</span>
              </p>
              <div id="dist-corpus-stats" style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">Chargement…</div>
              <div class="dist-toolbar-row">
                <label for="dist-ep-select">Épisode</label>
                <select class="acts-params-select" id="dist-ep-select" style="min-width:min(220px,92vw)">
                  <option value="">— Choisir —</option>
                </select>
                <label for="dist-source-kind">Source</label>
                <select class="acts-params-select" id="dist-source-kind" title="Type de ligne">
                  <option value="utterance" title="utterance">Tours</option>
                  <option value="sentence" title="sentence">Phrases</option>
                  <option value="cue" title="cues SRT">Cues SRT</option>
                </select>
                <span id="dist-cue-lang-wrap" style="display:none;align-items:center;gap:6px">
                  <label for="dist-cue-lang">Langue</label>
                  <select class="acts-params-select" id="dist-cue-lang" style="min-width:4.5rem"></select>
                </span>
                <button type="button" class="btn btn-secondary btn-sm" id="dist-suggest-alias" title="Alias → personnage si le texte commence par un alias">Alias</button>
                <input type="search" class="dist-filter-input" id="dist-filter" placeholder="Filtrer…" autocomplete="off" />
                <button type="button" class="btn btn-primary btn-sm" id="dist-save-btn">Enregistrer</button>
                <span id="dist-save-msg" style="font-size:0.76rem;min-width:80px"></span>
              </div>
              <div id="dist-summary" style="font-size:0.76rem;color:var(--text-muted);margin-bottom:6px"></div>
              <div class="cons-error" id="dist-error" style="display:none;margin-bottom:8px"></div>
              <div class="dist-body-split">
                <div class="dist-main-col">
                  <div id="dist-table-wrap" style="border:1px solid var(--border);border-radius:8px;background:var(--surface)">
                    <div id="dist-table-inner" class="acts-text-empty" style="padding:14px">Chargement…</div>
                  </div>
                </div>
                <aside class="dist-sidebar" aria-label="Personnages dans l'épisode">
                  <div class="dist-sidebar-head">Personnages (épisode)</div>
                  <div id="dist-ep-chars" class="dist-ep-chars dist-ep-chars-sidebar" hidden></div>
                </aside>
              </div>
            </div>
          </div>

          <!-- Alignement sub-pane -->
          <div class="cons-actions-pane${_activeActionsSubView === "alignement" ? " active" : ""}" data-subview="alignement">
            <div class="cons-toolbar">
              <span class="cons-toolbar-title">Alignement — épisode</span>
              <div class="seg-mode-toggle" style="margin-left:8px">
                <button class="seg-mode-btn active" id="align-mode-inspect">Inspection</button>
                <button class="seg-mode-btn" id="align-mode-trad">Traduction</button>
              </div>
              <button class="btn btn-ghost btn-sm" id="cons-refresh-align" style="margin-left:auto">↺ Actualiser</button>
            </div>
            <!-- Vue Inspection -->
            <div id="align-view-inspect" class="acts-split" style="flex:1;min-height:0;overflow:hidden">
              <div class="acts-ep-list" id="align-acts-ep-list">
                <div class="acts-ep-list-title">
                  <span class="acts-ep-list-label">Épisodes</span>
                  <button type="button" class="acts-ep-collapse-btn" data-collapse-target="align-acts-ep-list" title="Réduire la liste" aria-expanded="true" aria-controls="align-acts-ep-list">‹</button>
                </div>
                <div class="acts-ep-filters" role="search">
                  <div class="acts-ep-filter-row">
                    <label class="acts-ep-filter-label" for="align-ep-season">Saison</label>
                    <select id="align-ep-season" class="acts-ep-filter-select" aria-label="Filtrer par saison">
                      <option value="all">Toutes les saisons</option>
                    </select>
                  </div>
                  <input type="search" id="align-ep-search" class="acts-ep-filter-search" placeholder="Rechercher (ID, titre)…" autocomplete="off" />
                </div>
                <div class="align-ep-wrap cons-loading">Chargement…</div>
              </div>
              <div class="acts-text-panel" id="align-text-panel">
                <div class="acts-text-empty">← Sélectionnez un épisode</div>
              </div>
            </div>
            <!-- Vue Traduction (déplacée depuis Segmentation — S-5/A-3) -->
            <div id="align-view-trad" style="display:none;flex:1;min-height:0;flex-direction:column;overflow:hidden"></div>
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
    localStorage.setItem(lsKey(ACTIVE_SECTION_LS_KEY), sec);
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
    // Clicking the "Actions" tab always returns to the batch hub
    if (sec === "actions") activateSubView("hub");
  }

  // ── Helper: switch Actions sub-view ──────────────────────────────────────
  function activateSubView(subview: "hub" | "curation" | "distribution" | "segmentation" | "alignement") {
    _activeActionsSubView = subview;
    localStorage.setItem(lsKey(ACTIVE_SUBVIEW_LS_KEY), subview);
    container.querySelectorAll<HTMLElement>(".cons-actions-pane")
      .forEach((p) => p.classList.toggle("active", p.dataset.subview === subview));
    container.querySelectorAll<HTMLButtonElement>(".cons-nav-tree-link")
      .forEach((b) => b.classList.toggle("active", b.dataset.subview === subview));
    // Lazy-load episode data for dynamic sub-views
    if (subview === "segmentation") {
      const wrap = container.querySelector<HTMLElement>(".seg-table-wrap");
      if (wrap?.classList.contains("cons-loading")) {
        loadAndRenderSegmentation(container); // auto-select géré en fin de chargement
      } else if (wrap) {
        autoSelectSharedEp(wrap, "tr[data-ep-id]", "active-row");
      }
    }
    if (subview === "alignement") {
      const wrap = container.querySelector<HTMLElement>(".align-ep-wrap");
      if (wrap?.classList.contains("cons-loading")) {
        loadAndRenderAlignement(container); // auto-select géré en fin de chargement
      } else if (wrap) {
        autoSelectSharedEp(wrap, "tr[data-ep-id]", "active-row");
      }
    }
    if (subview === "curation") {
      initCurationParams(container);
      // Vue déjà chargée : ré-ouvrir l'épisode actif si différent de l'actuel
      const listEl = container.querySelector<HTMLElement>("#cur-ep-list");
      if (listEl) autoSelectSharedEp(listEl, ".cur-ep-item", "active");
    }
    if (subview === "distribution") void loadDistributionPanel(container);
    // Init params panels on first show
    if (subview === "hub") { initHubParams(container); updateHubStats(container); }
  }

  _openDistributionNavListener = () => {
    activateSection("actions");
    activateSubView("distribution");
    void loadDistributionPanel(container);
  };
  document.addEventListener("himyc:open-distribution", _openDistributionNavListener);

  // ── Hub params : initialisation au premier affichage ────────────────────
  async function initHubParams(cnt: HTMLElement) {
    const profileSel = cnt.querySelector<HTMLSelectElement>("#hub-profile");
    if (!profileSel || profileSel.dataset.wired) return;
    profileSel.dataset.wired = "1";

    if (!_cachedConfig) {
      try { _cachedConfig = await fetchConfig(); } catch { return; }
    }
    profileSel.value = _cachedConfig.normalize_profile;

    // Save profile to config when changed from hub
    const fb = cnt.querySelector<HTMLElement>("#hub-profile-fb")!;
    profileSel.addEventListener("change", async () => {
      fb.textContent = "…";
      fb.style.color = "var(--text-muted)";
      try {
        _cachedConfig = await saveConfig({ normalize_profile: profileSel.value });
        fb.textContent = "✓";
        fb.style.color = "var(--success, #16a34a)";
        setTimeout(() => { fb.textContent = ""; }, 1500);
      } catch (e) {
        fb.textContent = e instanceof ApiError ? e.message : "Erreur";
        fb.style.color = "var(--danger, #dc2626)";
      }
    });

    // Pre-fill pivot lang from project languages
    const alignLang = cnt.querySelector<HTMLInputElement>("#hub-align-lang");
    if (alignLang) {
      const lang = _cachedConfig.languages?.[0] ?? "";
      if (lang) alignLang.value = lang;
    }
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
    renderCurationRuleChips(cnt);
    // Populate checkboxes from current profile defaults
    const initProfile = NORMALIZE_PROFILES.find((p) => p.id === sel.value);
    if (initProfile) applyNormalizeOptsToPanel(cnt, initProfile.options);

    sel.addEventListener("change", async () => {
      const fb = cnt.querySelector<HTMLElement>("#cur-profile-fb")!;
      fb.textContent = "Enregistrement…";
      fb.style.color = "var(--text-muted)";
      // Auto-populate checkboxes when profile changes
      const prof = NORMALIZE_PROFILES.find((p) => p.id === sel.value);
      if (prof) applyNormalizeOptsToPanel(cnt, prof.options);
      try {
        _cachedConfig = await saveConfig({ normalize_profile: sel.value });
        renderCurationRuleChips(cnt);
        fb.textContent = "✓";
        fb.style.color = "var(--success, #16a34a)";
        setTimeout(() => { fb.textContent = ""; }, 1500);
      } catch (e) {
        fb.textContent = e instanceof ApiError ? e.message : "Erreur";
        fb.style.color = "var(--danger, #dc2626)";
      }
    });

    // Wire options toggle (repliable)
    const toggle = cnt.querySelector<HTMLElement>("#cur-opts-toggle");
    const panel  = cnt.querySelector<HTMLElement>("#cur-opts-panel");
    const caret  = cnt.querySelector<HTMLElement>("#cur-opts-caret");
    if (toggle && panel && caret) {
      toggle.addEventListener("click", () => {
        const open = panel.style.display === "none";
        panel.style.display = open ? "" : "none";
        caret.textContent = open ? "▼" : "▶";
        if (open) renderCurationRuleChips(cnt);
      });
    }

    // Sélecteur ponctuation (exclusif FR / EN)
    cnt.querySelector<HTMLSelectElement>("#cur-punct")?.addEventListener("change", () => {
      renderCurationRuleChips(cnt);
      scheduleCurationPreview(cnt);
    });

    // Wire option checkboxes → re-render chips + aperçu live (bidirectionnel avec C-4)
    OPTION_CHIP_MAP.forEach(({ checkboxId }) => {
      cnt.querySelector<HTMLInputElement>(checkboxId)
        ?.addEventListener("change", () => { renderCurationRuleChips(cnt); scheduleCurationPreview(cnt); });
    });
    // Casse (bloc Normaliser)
    cnt.querySelector<HTMLSelectElement>("#cur-norm-case")
      ?.addEventListener("change", () => scheduleCurationPreview(cnt));
    renderCurationRuleChips(cnt); // état initial

    // Bouton "Normaliser et sauvegarder" principal
    cnt.querySelector<HTMLButtonElement>("#cur-apply-normalize")?.addEventListener("click", async () => {
      const btn = cnt.querySelector<HTMLButtonElement>("#cur-apply-normalize")!;
      if (!_curPreviewEpId) return;
      const profile = cnt.querySelector<HTMLSelectElement>("#cur-profile")?.value ?? "default_en_v1";
      const normalizeOpts = collectNormalizeOpts(cnt);
      btn.disabled = true;
      btn.textContent = "Normalisation en cours…";
      try {
        await createJob("normalize_transcript", _curPreviewEpId, "transcript", {
          normalize_profile: profile,
          normalize_options: normalizeOpts,
        });
        startJobPoll(cnt);
        btn.textContent = "✓ Lancé — actualisation en cours…";
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "⚠ Erreur — réessayer";
        const fb = cnt.querySelector<HTMLElement>("#cur-preview-feedback");
        if (fb) { fb.style.color = "var(--danger,#dc2626)"; fb.textContent = e instanceof Error ? e.message : String(e); }
      }
    });

    // Wire C-3: édition manuelle (edit / save / cancel)
    cnt.querySelector<HTMLButtonElement>("#cur-edit-btn")?.addEventListener("click", () => enterEditMode(cnt));
    cnt.querySelector<HTMLButtonElement>("#cur-cancel-btn")?.addEventListener("click", () => exitEditMode(cnt));
    cnt.querySelector<HTMLButtonElement>("#cur-save-btn")?.addEventListener("click", async () => {
      const textarea = cnt.querySelector<HTMLTextAreaElement>("#cur-edit-textarea");
      if (!textarea || !_curPreviewEpId) return;
      const newClean = textarea.value;
      const saveBtn  = cnt.querySelector<HTMLButtonElement>("#cur-save-btn")!;
      const status   = cnt.querySelector<HTMLElement>("#cur-edit-status")!;
      saveBtn.disabled = true;
      saveBtn.textContent = "…";
      try {
        await patchTranscript(_curPreviewEpId, newClean);
        if (_curPreviewData) _curPreviewData.clean = newClean;
        exitEditMode(cnt);
        // Avertissement : segments invalidés
        const panes = cnt.querySelector<HTMLElement>("#cur-preview-panes")!;
        const warn = document.createElement("div");
        warn.className = "acts-text-empty";
        warn.style.cssText = "width:100%;background:color-mix(in srgb,var(--warning,#f59e0b) 12%,transparent);color:var(--warning,#b45309);padding:8px 12px;border-radius:4px;font-size:0.8rem;";
        warn.innerHTML = `⚠ Texte sauvegardé — les segments ont été invalidés. Pensez à relancer la <strong>segmentation</strong>.`;
        panes.prepend(warn);
        // Rafraîchir la liste des épisodes pour mettre à jour le statut
        await loadAndRender(cnt);
      } catch (err) {
        status.textContent = err instanceof ApiError ? `${err.errorCode} — ${err.message}` : String(err);
        status.style.color = "var(--danger, #dc2626)";
        saveBtn.disabled = false;
        saveBtn.textContent = "💾 Sauvegarder";
      }
    });

    // ── Helper : construit une regex depuis les champs find/replace ───────────
    function buildFRRegex(pattern: string): RegExp | null {
      const useRegex = cnt.querySelector<HTMLInputElement>("#cur-fr-regex")!.checked;
      const noCase   = cnt.querySelector<HTMLInputElement>("#cur-fr-nocase")!.checked;
      const flags    = "g" + (noCase ? "i" : "");
      try {
        return useRegex
          ? new RegExp(pattern, flags)
          : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      } catch { return null; }
    }

    // ── Bouton Rechercher : surlignage dans le preview sans remplacer ─────────
    cnt.querySelector<HTMLButtonElement>("#cur-fr-search")?.addEventListener("click", () => {
      const findInput = cnt.querySelector<HTMLInputElement>("#cur-fr-find")!;
      const countEl   = cnt.querySelector<HTMLElement>("#cur-fr-count")!;
      const pattern   = findInput.value.trim();
      if (!pattern) {
        // Effacer le surlignage si vide
        _curSearchRegex = null;
        countEl.textContent = "";
        if (_curPreviewData && _curPreviewEpId) {
          const mode = cnt.querySelector<HTMLElement>(".cur-preview-tab.active")?.dataset.mode ?? "side";
          const epTitle = cnt.querySelector<HTMLElement>(".cur-ep-item.active")?.dataset.epTitle ?? _curPreviewEpId;
          const dd0 = _clientPreviewClean !== null ? { raw: _curPreviewData.raw, clean: _clientPreviewClean } : _curPreviewData;
          renderCurationPreviewMode(cnt.querySelector<HTMLElement>("#cur-preview-panes")!, dd0, mode, epTitle, null, mergeSubtitleBreaksEnabled(cnt));
        }
        return;
      }
      const regex = buildFRRegex(pattern);
      if (!regex) {
        countEl.style.color = "var(--danger,#dc2626)";
        countEl.textContent = "RegEx invalide.";
        return;
      }
      if (!_curPreviewData || !_curPreviewEpId) {
        countEl.style.color = "var(--danger,#dc2626)";
        countEl.textContent = "Aucun épisode sélectionné.";
        return;
      }
      const displayData = _clientPreviewClean !== null ? { raw: _curPreviewData.raw, clean: _clientPreviewClean } : _curPreviewData;
      const text = displayData.clean || displayData.raw;
      const matches = text.match(new RegExp(regex.source, regex.flags));
      const count = matches ? matches.length : 0;
      _curSearchRegex = count > 0 ? regex : null;
      if (count === 0) {
        countEl.style.color = "var(--text-muted)";
        countEl.textContent = "Aucune occurrence.";
      } else {
        countEl.style.color = "var(--accent,#6366f1)";
        countEl.textContent = `${count} occurrence${count > 1 ? "s" : ""} trouvée${count > 1 ? "s" : ""}.`;
      }
      const mode = cnt.querySelector<HTMLElement>(".cur-preview-tab.active")?.dataset.mode ?? "side";
      const epTitle = cnt.querySelector<HTMLElement>(".cur-ep-item.active")?.dataset.epTitle ?? _curPreviewEpId;
      renderCurationPreviewMode(cnt.querySelector<HTMLElement>("#cur-preview-panes")!, displayData, mode, epTitle, _curSearchRegex, mergeSubtitleBreaksEnabled(cnt));
    });

    // ── Bouton Remplacer et sauvegarder ────────────────────────────────────────
    // Wire Rechercher / Remplacer (find/replace avec RegEx optionnel)
    cnt.querySelector<HTMLButtonElement>("#cur-fr-apply")?.addEventListener("click", async () => {
      const findInput    = cnt.querySelector<HTMLInputElement>("#cur-fr-find")!;
      const replaceInput = cnt.querySelector<HTMLInputElement>("#cur-fr-replace")!;
      const countEl      = cnt.querySelector<HTMLElement>("#cur-fr-count")!;
      const applyBtn     = cnt.querySelector<HTMLButtonElement>("#cur-fr-apply")!;
      const pattern      = findInput.value;
      if (!pattern) { countEl.style.color = "var(--danger,#dc2626)"; countEl.textContent = "Saisissez un terme à rechercher."; return; }
      if (!_curPreviewData || !_curPreviewEpId) { countEl.style.color = "var(--danger,#dc2626)"; countEl.textContent = "Aucun épisode sélectionné."; return; }
      const regex = buildFRRegex(pattern);
      if (!regex) {
        countEl.style.color = "var(--danger,#dc2626)"; countEl.textContent = `RegEx invalide.`; return;
      }
      const before = _curPreviewData.clean || _curPreviewData.raw;
      const matches = before.match(new RegExp(regex.source, regex.flags));
      const count = matches ? matches.length : 0;
      if (count === 0) { countEl.style.color = "var(--text-muted)"; countEl.textContent = "Aucune occurrence trouvée."; return; }
      const after = before.replace(regex, replaceInput.value);
      applyBtn.disabled = true; applyBtn.textContent = "…";
      try {
        await patchTranscript(_curPreviewEpId, after);
        _curPreviewData.clean = after;
        countEl.style.color = "var(--success,#16a34a)";
        countEl.textContent = `✓ ${count} remplacement${count > 1 ? "s" : ""} effectué${count > 1 ? "s" : ""}.`;
        // Rafraîchir la prévisualisation
        _curSearchRegex = null; // effacer le surlignage recherche après remplacement
        const activeMode = cnt.querySelector<HTMLButtonElement>(".cur-preview-tab.active")?.dataset.mode ?? "side";
        const epTitle = cnt.querySelector<HTMLElement>(".cur-ep-item.active")?.dataset.epTitle ?? _curPreviewEpId;
        renderCurationPreviewMode(cnt.querySelector<HTMLElement>("#cur-preview-panes")!, _curPreviewData, activeMode, epTitle, null, mergeSubtitleBreaksEnabled(cnt));
        setTimeout(() => { countEl.textContent = ""; }, 4000);
      } catch (err) {
        countEl.style.color = "var(--danger,#dc2626)";
        countEl.textContent = err instanceof ApiError ? `${err.errorCode} — ${err.message}` : String(err);
      } finally {
        applyBtn.disabled = false; applyBtn.textContent = "Remplacer et sauvegarder";
      }
    });

    // Wire preview mode tabs (dont "srt")
    cnt.querySelectorAll<HTMLButtonElement>(".cur-preview-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        cnt.querySelectorAll(".cur-preview-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const mode = tab.dataset.mode!;
        const srtPane    = cnt.querySelector<HTMLElement>("#cur-srt-cues-pane");
        const previewEl  = cnt.querySelector<HTMLElement>("#cur-preview-panes")!;
        const editBar    = cnt.querySelector<HTMLElement>("#cur-edit-bar");
        const editBtn    = cnt.querySelector<HTMLButtonElement>("#cur-edit-btn");

        if (mode === "srt") {
          // Mode SRT : cacher le preview transcript, montrer le panneau cues
          previewEl.style.display  = "none";
          if (editBar) editBar.style.display = "none";
          if (editBtn) editBtn.style.display = "none";
          if (srtPane) srtPane.style.display = "";
          const lang = cnt.querySelector<HTMLSelectElement>("#cur-srt-lang")?.value;
          if (_curPreviewEpId && lang) renderSrtCues(cnt, _curPreviewEpId, lang);
        } else {
          // Mode transcript classique
          if (srtPane) srtPane.style.display = "none";
          previewEl.style.display = "";
          if (editBtn) editBtn.style.display = "";
          if (_curPreviewData && _curPreviewEpId) {
            const activeItem = cnt.querySelector<HTMLElement>(".cur-ep-item.active");
            const epTitle = activeItem?.dataset.epTitle ?? _curPreviewEpId;
            const tabDisplayData = _clientPreviewClean !== null ? { raw: _curPreviewData.raw, clean: _clientPreviewClean } : _curPreviewData;
            renderCurationPreviewMode(
              previewEl,
              tabDisplayData,
              mode,
              epTitle,
              _curSearchRegex,
              mergeSubtitleBreaksEnabled(cnt),
            );
          }
        }
      });
    });

    // ── Bouton "Normaliser SRT" ────────────────────────────────────────────────
    cnt.querySelector<HTMLButtonElement>("#cur-srt-normalize")?.addEventListener("click", async () => {
      const btn  = cnt.querySelector<HTMLButtonElement>("#cur-srt-normalize")!;
      const fb   = cnt.querySelector<HTMLElement>("#cur-srt-fb")!;
      const lang = cnt.querySelector<HTMLSelectElement>("#cur-srt-lang")?.value;
      if (!_curPreviewEpId || !lang) return;
      const profile = cnt.querySelector<HTMLSelectElement>("#cur-profile")?.value ?? "default_en_v1";
      btn.disabled = true; btn.textContent = "Normalisation…";
      fb.style.color = "var(--text-muted)"; fb.textContent = "";
      try {
        await createJob("normalize_srt", _curPreviewEpId, `srt_${lang}`, { normalize_profile: profile });
        startJobPoll(cnt.closest<HTMLElement>(".cons-container") ?? cnt);
        fb.style.color = "var(--success,#16a34a)";
        fb.textContent = "✓ Job lancé";
        btn.textContent = "🧹 Normaliser SRT";
        setTimeout(() => { fb.textContent = ""; }, 3000);
      } catch (e) {
        fb.style.color = "var(--danger,#dc2626)";
        fb.textContent = e instanceof Error ? e.message : String(e);
        btn.textContent = "🧹 Normaliser SRT";
      } finally {
        btn.disabled = false;
      }
    });

    // ── Bouton "Voir / éditer cues" ────────────────────────────────────────────
    cnt.querySelector<HTMLButtonElement>("#cur-srt-view-btn")?.addEventListener("click", () => {
      const srtTab = cnt.querySelector<HTMLButtonElement>('.cur-preview-tab[data-mode="srt"]');
      srtTab?.click();
    });

    // ── Bouton "Charger plus" dans le panneau SRT ──────────────────────────────
    cnt.querySelector<HTMLButtonElement>("#cur-srt-load-more")?.addEventListener("click", () => {
      const lang = cnt.querySelector<HTMLSelectElement>("#cur-srt-lang")?.value;
      if (_curPreviewEpId && lang) renderSrtCues(cnt, _curPreviewEpId, lang, true);
    });

    // ── Rechargement cues si langue SRT change ─────────────────────────────────
    cnt.querySelector<HTMLSelectElement>("#cur-srt-lang")?.addEventListener("change", () => {
      const activeTab = cnt.querySelector<HTMLElement>(".cur-preview-tab.active");
      if (activeTab?.dataset.mode === "srt") {
        const lang = cnt.querySelector<HTMLSelectElement>("#cur-srt-lang")?.value;
        if (_curPreviewEpId && lang) renderSrtCues(cnt, _curPreviewEpId, lang);
      }
    });
  }

  // ── Sidebar nav tab clicks ────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".cons-nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => activateSection(btn.dataset.section!));
  });

  // ── Actions tree link clicks ──────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".cons-nav-tree-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Activer la section "actions" sans déclencher le reset vers le hub
      // (activateSection("actions") appelle activateSubView("hub") ce qui est voulu
      // quand l'utilisateur clique l'onglet "Actions", mais pas depuis un lien d'arborescence)
      if (_activeSection !== "actions") {
        _activeSection = "actions";
        localStorage.setItem(lsKey(ACTIVE_SECTION_LS_KEY), "actions");
        container.querySelectorAll<HTMLButtonElement>(".cons-nav-tab")
          .forEach((b) => b.classList.toggle("active", b.dataset.section === "actions"));
        container.querySelectorAll<HTMLElement>(".cons-section-pane")
          .forEach((p) => p.classList.toggle("active", p.dataset.section === "actions"));
      }
      activateSubView(btn.dataset.subview as "curation" | "distribution" | "segmentation" | "alignement");
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
  // ── Segmentation pane wiring ───────────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#cons-batch-segment")
    ?.addEventListener("click", async () => {
      const episodes = _cachedEpisodes?.episodes ?? [];
      const scopeAll = (container.querySelector<HTMLInputElement>("input[name='hub-seg-scope'][value='all']")?.checked) ?? false;
      const segKind  = (container.querySelector<HTMLSelectElement>("#hub-seg-kind")?.value ?? "utterance");
      const langHint = (container.querySelector<HTMLSelectElement>("#hub-seg-lang")?.value ?? "en");
      const toSegment = episodes.filter((ep) => {
        const t = ep.sources.find((s) => s.source_key === "transcript");
        if (!t?.available) return false;
        return scopeAll ? (t.state !== "segmented") : (t.state === "normalized");
      });
      if (toSegment.length === 0) return;
      for (const ep of toSegment) {
        try { await createJob("segment_transcript", ep.episode_id, "transcript", { segment_kind: segKind, lang_hint: langHint }); } catch { /* skip */ }
      }
      startJobPoll(container);
      await loadAndRenderSegmentation(container);
    });

  container.querySelector<HTMLButtonElement>("#cons-refresh-seg")
    ?.addEventListener("click", () => loadAndRenderSegmentation(container));

  container.querySelector<HTMLButtonElement>("#cons-refresh-distribution")
    ?.addEventListener("click", () => void loadDistributionPanel(container, { force: true }));

  // ── Seg mode toggle (Table / Texte) ─────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#seg-mode-table")
    ?.addEventListener("click", () => {
      container.querySelectorAll(".seg-mode-btn").forEach((b) => b.classList.remove("active"));
      container.querySelector("#seg-mode-table")?.classList.add("active");
      const tv   = container.querySelector<HTMLElement>("#seg-view-table");
      const trdv = container.querySelector<HTMLElement>("#seg-view-trad");
      if (tv)   tv.style.display   = "";
      if (trdv) trdv.style.display = "none";
    });

  // ── Alignement pane wiring ─────────────────────────────────────────────────

  // Mode toggle Inspection / Traduction dans Alignement
  container.querySelector<HTMLButtonElement>("#align-mode-inspect")
    ?.addEventListener("click", () => {
      const alignPane = container.querySelector<HTMLElement>('.cons-actions-pane[data-subview="alignement"]');
      if (!alignPane) return;
      alignPane.querySelectorAll(".seg-mode-btn").forEach((b) => b.classList.remove("active"));
      alignPane.querySelector("#align-mode-inspect")?.classList.add("active");
      const inspectV = alignPane.querySelector<HTMLElement>("#align-view-inspect");
      const tradV    = alignPane.querySelector<HTMLElement>("#align-view-trad");
      if (inspectV) inspectV.style.display = "";
      if (tradV)    tradV.style.display    = "none";
    });

  container.querySelector<HTMLButtonElement>("#align-mode-trad")
    ?.addEventListener("click", () => {
      const alignPane = container.querySelector<HTMLElement>('.cons-actions-pane[data-subview="alignement"]');
      if (!alignPane) return;
      alignPane.querySelectorAll(".seg-mode-btn").forEach((b) => b.classList.remove("active"));
      alignPane.querySelector("#align-mode-trad")?.classList.add("active");
      const inspectV = alignPane.querySelector<HTMLElement>("#align-view-inspect");
      const tradV    = alignPane.querySelector<HTMLElement>("#align-view-trad");
      if (inspectV) inspectV.style.display = "none";
      if (tradV) {
        tradV.style.display = "flex";
        const episodes = _cachedEpisodes?.episodes ?? [];
        loadTradView(tradV, episodes);
      }
    });

  // Confidence slider live display (hub)
  container.querySelector<HTMLInputElement>("#hub-align-conf")
    ?.addEventListener("input", (e) => {
      const val = (e.target as HTMLInputElement).value;
      const display = container.querySelector<HTMLElement>("#hub-align-conf-val");
      if (display) display.textContent = parseFloat(val).toFixed(2);
    });

  container.querySelector<HTMLButtonElement>("#cons-refresh-align")
    ?.addEventListener("click", () => loadAndRenderAlignement(container));

  container.querySelector<HTMLButtonElement>("#cons-batch-align")
    ?.addEventListener("click", async () => {
      const episodes   = _cachedEpisodes?.episodes ?? [];
      const segKind    = (container.querySelector<HTMLSelectElement>("#hub-align-seg-kind")?.value ?? "utterance") as "utterance" | "sentence";
      const pivotLang  = (container.querySelector<HTMLInputElement>("#hub-align-lang")?.value.trim() ?? "fr") || "fr";
      const minConf    = parseFloat(container.querySelector<HTMLInputElement>("#hub-align-conf")?.value ?? "0.3");
      const useSim     = container.querySelector<HTMLInputElement>("#hub-align-sim")?.checked ?? false;

      const toAlign = episodes.filter((ep) => {
        const t = ep.sources.find((s) => s.source_key === "transcript");
        const srts = ep.sources.filter((s) => s.source_key.startsWith("srt_") && s.available);
        return t?.state === "segmented" && srts.length > 0;
      });
      if (toAlign.length === 0) return;
      const btn = container.querySelector<HTMLButtonElement>("#cons-batch-align")!;
      btn.disabled = true; btn.textContent = "…";
      // Réinitialiser le feedback du run précédent
      const fbElInit = container.querySelector<HTMLElement>("#cons-batch-align-fb");
      if (fbElInit) { fbElInit.textContent = ""; fbElInit.style.color = ""; }
      const batchErrors: string[] = [];
      for (const ep of toAlign) {
        const targetLangs = ep.sources
          .filter((s) => s.source_key.startsWith("srt_") && s.available)
          .map((s) => s.source_key.replace("srt_", ""));
        try {
          await createJob("align", ep.episode_id, "", {
            pivot_lang:              pivotLang,
            target_langs:            targetLangs,
            segment_kind:            segKind,
            min_confidence:          isNaN(minConf) ? 0.3 : minConf,
            use_similarity_for_cues: useSim,
          });
        } catch (err) {
          const msg = err instanceof ApiError ? `${ep.episode_id}: ${err.errorCode}` : `${ep.episode_id}: ${String(err)}`;
          batchErrors.push(msg);
        }
      }
      btn.disabled = false; btn.textContent = "⚡ Aligner tout";
      if (batchErrors.length > 0) {
        const fbEl = container.querySelector<HTMLElement>("#cons-batch-align-fb");
        if (fbEl) {
          fbEl.style.color = "var(--danger, #dc2626)";
          fbEl.textContent = `${batchErrors.length} job(s) en erreur : ${batchErrors.join(" · ")}`;
        }
      }
      startJobPoll(container);
      await loadAndRenderAlignement(container);
    });

  // ── Collapse / expand ─────────────────────────────────────────────────────
  function setNavCollapsed(collapsed: boolean) {
    _navCollapsed = collapsed;
    localStorage.setItem(lsKey(NAV_COLLAPSED_LS_KEY), collapsed ? "1" : "0");
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
      if (_activeActionsSubView === "hub")           initHubParams(container);
      if (_activeActionsSubView === "curation")      initCurationParams(container);
      if (_activeActionsSubView === "distribution")  void loadDistributionPanel(container);
      if (_activeActionsSubView === "segmentation")  loadAndRenderSegmentation(container);
      if (_activeActionsSubView === "alignement")    loadAndRenderAlignement(container);
    }
  }

  // ── Refresh buttons ───────────────────────────────────────────────────────
  container
    .querySelector<HTMLButtonElement>("#cons-refresh")!
    .addEventListener("click", () => loadAndRender(container));

  container
    .querySelector<HTMLButtonElement>("#cons-hub-refresh")
    ?.addEventListener("click", () => loadAndRender(container));

  // ── Batch normalize button ────────────────────────────────────────────────
  container
    .querySelector<HTMLButtonElement>("#cons-batch-normalize")!
    .addEventListener("click", async () => {
      try {
        const { episodes } = await fetchEpisodes();
        await queueBatchNormalize(episodes, container);
      } catch (e) {
        const errEl = container.querySelector<HTMLElement>(".hub-error");
        if (errEl) { errEl.textContent = formatApiError(e); errEl.style.display = "block"; }
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
    _unsub2 = ctx.onStatusChange((s) => {
      if (s.online) {
        const u = _unsub2;
        _unsub2 = null;
        if (u) u();
        loadAndRender(container);
        refreshJobs(container).then(() => startJobPoll(container));
      }
    });
  }
}

export function disposeConstituer() {
  _constituerMountId++; // invalide tous les refreshJobs en vol
  // Désabonner d'abord pour éviter qu'un callback de statut ne redémarre le poll
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  if (_unsub2)      { _unsub2();      _unsub2      = null; }
  stopJobPoll();
  if (_openDistributionNavListener) {
    document.removeEventListener("himyc:open-distribution", _openDistributionNavListener);
    _openDistributionNavListener = null;
  }
  if (_auditKeydownHandler) {
    document.removeEventListener("keydown", _auditKeydownHandler);
    _auditKeydownHandler = null;
  }
  if (_segSegPreviewTimer)  { clearTimeout(_segSegPreviewTimer);  _segSegPreviewTimer = null; }
  if (_distFilterTimer)     { clearTimeout(_distFilterTimer);     _distFilterTimer    = null; }
  if (_clientPreviewTimer)  { clearTimeout(_clientPreviewTimer);  _clientPreviewTimer = null; }

  _container              = null;
  _ctx                    = null;
  _projectPrefix          = "";
  _cachedEpisodes         = null;
  _cachedConfig           = null;
  _tradViewMounted        = false;
  _constituerSharedEpId   = null;

  // Navigation / sections
  _jobsExpanded           = true;
  _activeSection          = "actions";
  _activeActionsSubView   = "hub";
  _navCollapsed           = false;
  _page                   = 0;

  // Docs / curation
  _docsPanelEpId          = null;
  _docsSeasonFilter       = null;
  _pendingCurationEpisodeId = null;
  _curPreviewEpId         = null;
  _curPreviewData         = null;
  _curPreviewSourceKey    = "transcript";
  _curPreviewEpSources    = [];
  _curEditMode            = false;
  _curSearchRegex         = null;
  _clientPreviewClean     = null;
  _curSrtCuesOffset       = 0;

  // Segmentation / alignement
  _segEpisodesAll         = [];
  _alignEpisodesAll       = [];
  _alignRunsLangMap       = new Map();

  // Distribution
  _distSourceKind         = "utterance";
  _distCueLang            = "en";
  _distLoadedSegments     = [];
  _distLoadedCues         = [];
  _distLoadedEpId         = null;
  _distLoadedSourceKind   = null;
  _distLoadedCueLangSnap  = null;
  _distCharPick           = new Map();

  // Audit / concordance
  _concordanceLoaded      = false;
  _auditLoadToken++;
  _minimapPositions       = [];
  _minimapMaxN            = 1;
  _vsLinks                = [];
  _vsFocusIdx             = -1;

  // Personnages
  _characters             = [];
  _assignments            = [];
  _selectedCharIdx        = null;
}
