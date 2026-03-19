/**
 * concordancierModule.ts — Concordancier KWIC v3 (MX-034)
 *
 * Parity AGRAFES :
 *   - Mode tabs (Segments / Sous-titres / Documents)
 *   - Aligned toggle (vue cartes enrichies) + Parallel toggle (groupé épisode)
 *   - Query builder panel (5 modes : simple / phrase / and / or / near + near-N)
 *   - FTS preview bar (query transformée en temps réel)
 *   - Help popover (exemples FTS5 + copy buttons)
 *   - History localStorage (10 entrées)
 *   - Export 4 formats : CSV plat, CSV long, JSONL simple, JSONL parallèle
 *   - Filtre drawer (type / langue / épisode / locuteur)
 *   - Chips bar (filtres actifs)
 *   - Analytics bar (total hits · épisodes · langues · top-épisodes cliquables)
 *   - Reset button (efface tout)
 *   - Pagination client-side avec bannière has_more
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { apiPost, apiGet, ApiError } from "../api";

// ── Types ────────────────────────────────────────────────────────────────────

type BuilderMode = "simple" | "phrase" | "and" | "or" | "near";

interface KwicHit {
  episode_id: string;
  title: string;
  left: string;
  match: string;
  right: string;
  position: number;
  score: number;
  segment_id: string | null;
  kind: string | null;
  cue_id: string | null;
  lang: string | null;
  speaker: string | null;
}

interface QueryRequest {
  term: string;
  scope: "episodes" | "segments" | "cues";
  kind?: string | null;
  lang?: string | null;
  episode_id?: string | null;
  speaker?: string | null;
  window?: number;
  limit?: number;
  case_sensitive?: boolean;
}

interface QueryResponse {
  term: string;
  scope: string;
  total: number;
  has_more?: boolean;
  hits: KwicHit[];
}

interface FacetsTopEpisode {
  episode_id: string;
  title: string;
  count: number;
}

interface FacetsResponse {
  term: string;
  scope: string;
  total_hits: number;
  distinct_episodes: number;
  distinct_langs: number;
  top_episodes: FacetsTopEpisode[];
}

interface HistoryEntry {
  term: string;
  scope: string;
  kind: string;
  lang: string;
  episode_id: string;
  speaker: string;
  ts: number;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
.kwic-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
}

/* ── Toolbar ─────────────────────────────────────────────────── */
.kwic-toolbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.kwic-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 6px;
  flex-wrap: wrap;
}
.kwic-search-input {
  flex: 1;
  min-width: 180px;
  font-size: 0.9rem;
  padding: 6px 12px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.kwic-search-input:focus { border-color: var(--accent); }
.kwic-search-btn {
  font-size: 0.85rem;
  padding: 6px 14px;
  white-space: nowrap;
}

/* Mode tabs */
.kwic-mode-tabs {
  display: flex;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px;
  background: var(--surface2);
}
.kwic-mode-tab {
  padding: 4px 11px;
  font-size: 0.77rem;
  font-weight: 600;
  border: none;
  border-radius: calc(var(--radius) - 2px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s, color .12s;
  font-family: inherit;
}
.kwic-mode-tab:hover { background: var(--surface); color: var(--text); }
.kwic-mode-tab.active {
  background: var(--surface);
  color: var(--accent);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
}

/* Controls row */
.kwic-controls-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px 9px;
  flex-wrap: wrap;
}
.kwic-window-ctrl {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.73rem;
  color: var(--text-muted);
}
.kwic-window-ctrl input[type=range] {
  width: 80px;
  accent-color: var(--accent);
}
.kwic-window-val {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  color: var(--accent);
  font-weight: 700;
  min-width: 26px;
}
.kwic-ctrl-spacer { flex: 1; }

/* Toolbar buttons */
.kwic-toolbar-btn {
  padding: 4px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s, border-color .12s, color .12s;
  font-family: inherit;
}
.kwic-toolbar-btn:hover { background: var(--surface); color: var(--text); }
.kwic-toolbar-btn:disabled { opacity: 0.4; cursor: default; }
.kwic-toolbar-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.kwic-toolbar-btn.danger:hover {
  border-color: #dc2626;
  color: #dc2626;
  background: color-mix(in srgb, #dc2626 8%, var(--surface));
}
.kwic-case-btn {
  font-family: ui-serif, Georgia, serif;
  font-weight: 700;
  letter-spacing: -0.03em;
  padding: 4px 8px;
}

/* Dropdown menus */
.kwic-dd-wrap { position: relative; }
.kwic-dd-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 190px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 18px rgba(0,0,0,.13);
  z-index: 200;
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.kwic-dd-menu.open { display: flex; }
.kwic-dd-item {
  padding: 7px 14px;
  font-size: 0.8rem;
  color: var(--text);
  cursor: pointer;
  border: none;
  background: transparent;
  text-align: left;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.kwic-dd-item:hover { background: var(--surface2); }
.kwic-dd-item.muted { color: var(--text-muted); font-style: italic; font-size: 0.74rem; }
.kwic-dd-sep { height: 1px; background: var(--border); margin: 2px 0; flex-shrink: 0; }
.kwic-dd-scope-tag { font-size: 0.68rem; color: var(--text-muted); }

/* ── Builder panel ───────────────────────────────────────────── */
.kwic-builder-panel {
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.kwic-builder-panel.hidden { display: none; }
.kwic-builder-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kwic-builder-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .05em;
  white-space: nowrap;
}
.kwic-builder-radio {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.kwic-builder-radio label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.78rem;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.kwic-near-ctrl {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.kwic-near-ctrl.hidden { display: none; }
.kwic-near-input {
  width: 50px;
  font-size: 0.78rem;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  text-align: center;
}
.kwic-builder-warn {
  font-size: 0.73rem;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: var(--radius);
  padding: 2px 10px;
}
.kwic-builder-warn.hidden { display: none; }

/* ── Help popover ────────────────────────────────────────────── */
.kwic-help-wrap { position: relative; }
.kwic-help-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 400px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 2);
  box-shadow: 0 8px 32px rgba(0,0,0,.16);
  z-index: 350;
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.kwic-help-popover.open { display: flex; }
.kwic-help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text);
  flex-shrink: 0;
}
.kwic-help-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text-muted);
  padding: 0 2px;
  line-height: 1;
}
.kwic-help-body {
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 400px;
  overflow-y: auto;
}
.kwic-help-section-title {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.kwic-help-ex {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.kwic-help-ex-code {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 7px;
  color: var(--accent);
  white-space: nowrap;
  min-width: 140px;
}
.kwic-help-ex-desc {
  font-size: 0.74rem;
  color: var(--text-muted);
  flex: 1;
}
.kwic-help-ex-copy {
  font-size: 0.7rem;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: background .1s, color .1s;
  flex-shrink: 0;
}
.kwic-help-ex-copy:hover { background: var(--surface2); color: var(--text); }
.kwic-help-note {
  font-size: 0.71rem;
  color: var(--text-muted);
  line-height: 1.45;
  background: var(--surface2);
  border-radius: var(--radius);
  padding: 6px 9px;
}

/* ── FTS preview bar ─────────────────────────────────────────── */
.kwic-fts-preview {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 3px 14px;
  background: color-mix(in srgb, var(--accent) 5%, var(--surface));
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
  font-size: 0.72rem;
  color: var(--text-muted);
  flex-shrink: 0;
}
.kwic-fts-preview.visible { display: flex; }
.kwic-fts-preview-label {
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}
.kwic-fts-preview-code {
  font-family: ui-monospace, monospace;
  font-size: 0.74rem;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 540px;
}

/* ── Filter drawer ───────────────────────────────────────────── */
.kwic-filter-drawer {
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.kwic-filter-drawer.hidden { display: none; }
.kwic-filter-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.kwic-filter-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 700;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.kwic-filter-select, .kwic-filter-input {
  font-size: 0.78rem;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
}
.kwic-filter-input { width: 110px; }
.kwic-filter-clear {
  margin-left: auto;
  font-size: 0.72rem;
  padding: 2px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background .1s, color .1s;
}
.kwic-filter-clear:hover {
  background: var(--surface);
  color: var(--danger, #dc2626);
  border-color: var(--danger, #dc2626);
}

/* ── Chips bar ───────────────────────────────────────────────── */
.kwic-chips-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 14px;
  flex-wrap: wrap;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.kwic-chips-bar:empty { display: none; }
.kwic-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--accent);
  border-radius: 20px;
  padding: 2px 8px;
  font-size: 0.72rem;
  font-weight: 600;
}
.kwic-chip-rm {
  cursor: pointer;
  opacity: 0.6;
  font-size: 0.8rem;
  line-height: 1;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
}
.kwic-chip-rm:hover { opacity: 1; }

/* ── Analytics bar ───────────────────────────────────────────── */
.kwic-analytics {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
  font-size: 0.74rem;
  color: var(--text-muted);
}
.kwic-analytics.hidden { display: none; }
.kwic-analytics-total { font-weight: 700; color: var(--text); font-size: 0.8rem; }
.kwic-analytics-sep { opacity: 0.35; }
.kwic-facet-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 2px 8px;
  font-size: 0.7rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: background .1s, border-color .1s, color .1s;
}
.kwic-facet-chip:hover {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface2));
  border-color: var(--accent);
  color: var(--accent);
}
.kwic-facet-count { font-weight: 700; color: var(--accent); }
.kwic-has-more-note { font-size: 0.71rem; font-style: italic; }

/* ── Error ───────────────────────────────────────────────────── */
.kwic-error {
  margin: 6px 14px 0;
  padding: 7px 12px;
  background: color-mix(in srgb, #dc2626 10%, transparent);
  border: 1px solid #dc2626;
  border-radius: var(--radius);
  color: #dc2626;
  font-size: 0.8rem;
  display: none;
  flex-shrink: 0;
}

/* ── Results table ───────────────────────────────────────────── */
.kwic-table-wrap {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
.kwic-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 2rem;
}
.kwic-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.kwic-table th {
  position: sticky;
  top: 0;
  background: var(--surface);
  border-bottom: 2px solid var(--border);
  padding: 5px 8px;
  font-size: 0.69rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  z-index: 1;
}
.kwic-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 0.81rem;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kwic-table tr:hover td { background: var(--surface2); }
.kwic-col-ep    { width: 86px; }
.kwic-col-left  { width: 26%; text-align: right; color: var(--text-muted); }
.kwic-col-match { width: 14%; text-align: center; }
.kwic-col-right { width: 26%; color: var(--text-muted); }
.kwic-col-meta  { width: 120px; }
.kwic-col-copy  { width: 30px; }
.kwic-ep-id {
  font-family: ui-monospace, monospace;
  font-size: 0.68rem;
  color: var(--text-muted);
  display: block;
}
.kwic-ep-title {
  font-size: 0.67rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  max-width: 84px;
}
.kwic-match-pill {
  display: inline-block;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  font-weight: 700;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 0.82rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kwic-meta-badges { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; }
.kwic-speaker-badge {
  font-size: 0.67rem;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 4px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 105px;
  display: inline-block;
}
.kwic-kind-badge {
  font-size: 0.64rem;
  padding: 1px 4px;
  border-radius: 3px;
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #86efac;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
}
.kwic-lang-badge {
  font-size: 0.64rem;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface2);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
}
.kwic-copy-btn {
  padding: 2px 4px;
  font-size: 0.65rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  opacity: 0;
  transition: opacity .1s;
}
.kwic-table tr:hover .kwic-copy-btn { opacity: 1; }
.kwic-copy-btn:hover { background: var(--surface2); color: var(--text); }

/* ── Aligned cards view ──────────────────────────────────────── */
.kwic-cards-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kwic-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 1.5);
  padding: 9px 13px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color .12s;
}
.kwic-card:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.kwic-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.kwic-card-ep {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  color: var(--text-muted);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
}
.kwic-card-title {
  font-size: 0.73rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.kwic-card-context {
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}
.kwic-card-left  { color: var(--text-muted); }
.kwic-card-match {
  display: inline;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-weight: 700;
  border-radius: 3px;
  padding: 0 4px;
}
.kwic-card-right { color: var(--text-muted); }
.kwic-card-footer {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.kwic-card-copy {
  margin-left: auto;
  padding: 2px 6px;
  font-size: 0.65rem;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  opacity: 0;
  transition: opacity .1s;
}
.kwic-card:hover .kwic-card-copy { opacity: 1; }
.kwic-card-copy:hover { background: var(--surface2); color: var(--text); }

/* Episode separator (parallel view) */
.kwic-ep-sep {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .06em;
  margin: 4px 0 2px;
  flex-shrink: 0;
}
.kwic-ep-sep::before,
.kwic-ep-sep::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

/* ── Pagination ──────────────────────────────────────────────── */
.kwic-pagination {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  font-size: 0.77rem;
  color: var(--text-muted);
}
.kwic-pagination.visible { display: flex; }
.kwic-pag-gap { flex: 1; }
`;

// ── Constants & State ────────────────────────────────────────────────────────

const HIST_KEY  = "himyc_kwic_history";
const PAGE_SIZE = 50;

let _styleInjected = false;
let _hits: KwicHit[]               = [];
let _page                          = 0;
let _hasMore                       = false;
let _facets: FacetsResponse | null = null;
let _filterOpen                    = false;
let _histOpen                      = false;
let _expOpen                       = false;
let _builderOpen                   = false;
let _helpOpen                      = false;
let _scope: "segments" | "cues" | "episodes" = "segments";
let _builderMode: BuilderMode      = "simple";
let _nearN                         = 5;
let _showAligned                   = false;
let _showParallel                  = false;
let _caseSensitive                 = false;
let _unsubscribe: (() => void) | null = null;
let _closeDropdownsRef: ((e: MouseEvent) => void) | null = null;

// ── History ──────────────────────────────────────────────────────────────────

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]") as HistoryEntry[]; }
  catch { return []; }
}

function saveHistory(entry: HistoryEntry) {
  const hist = loadHistory().filter((h) => !(h.term === entry.term && h.scope === entry.scope));
  hist.unshift(entry);
  localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 10)));
}

// ── FTS query builder ─────────────────────────────────────────────────────────

function buildFtsQuery(raw: string, mode: BuilderMode, nearN: number): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Pass-through si la requête contient déjà des opérateurs FTS5
  if (/\b(AND|OR|NOT|NEAR)\b|"/.test(trimmed)) return trimmed;
  switch (mode) {
    case "phrase":
      return `"${trimmed.replace(/"/g, "'")}"`;
    case "and": {
      const words = trimmed.split(/\s+/).filter(Boolean);
      return words.length > 1 ? words.join(" AND ") : trimmed;
    }
    case "or": {
      const words = trimmed.split(/\s+/).filter(Boolean);
      return words.length > 1 ? words.join(" OR ") : trimmed;
    }
    case "near": {
      const words = trimmed.split(/\s+/).filter(Boolean);
      return words.length >= 2 ? `NEAR(${words.join(" ")}, ${nearN})` : trimmed;
    }
    default:
      return trimmed;
  }
}

function getFtsWarning(raw: string, mode: BuilderMode): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/\b(AND|OR|NOT|NEAR)\b|"/.test(trimmed)) {
    return "Mode pass-through : la requête contient déjà des opérateurs FTS5.";
  }
  if (mode === "near" && trimmed.split(/\s+/).filter(Boolean).length < 2) {
    return "NEAR requiert au moins 2 mots — requête envoyée sans transformation.";
  }
  return "";
}

// ── Export ───────────────────────────────────────────────────────────────────

function dlBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvQ(v: string) { return `"${String(v).replace(/"/g, '""')}"`; }

function exportCsvFlat() {
  if (!_hits.length) return;
  const hdr  = "episode_id,title,match,speaker,lang,kind\n";
  const rows = _hits.map((h) =>
    [h.episode_id, h.title, h.match, h.speaker ?? "", h.lang ?? "", h.kind ?? ""].map(csvQ).join(",")
  ).join("\n");
  dlBlob(new Blob([hdr + rows], { type: "text/csv;charset=utf-8;" }), `kwic_${Date.now()}.csv`);
}

function exportCsvLong() {
  if (!_hits.length) return;
  const hdr  = "episode_id,title,left,match,right,speaker,lang,kind,position\n";
  const rows = _hits.map((h) =>
    [h.episode_id, h.title, h.left, h.match, h.right, h.speaker ?? "", h.lang ?? "", h.kind ?? "", String(h.position)]
      .map(csvQ).join(",")
  ).join("\n");
  dlBlob(new Blob([hdr + rows], { type: "text/csv;charset=utf-8;" }), `kwic_long_${Date.now()}.csv`);
}

function exportJsonlSimple() {
  if (!_hits.length) return;
  const lines = _hits.map((h) => JSON.stringify(h)).join("\n");
  dlBlob(new Blob([lines], { type: "application/json;charset=utf-8;" }), `kwic_${Date.now()}.jsonl`);
}

function exportJsonlParallel() {
  if (!_hits.length) return;
  // Grouper par épisode : { episode_id, title, hits: [...] }
  const groups: Record<string, { episode_id: string; title: string; hits: KwicHit[] }> = {};
  for (const h of _hits) {
    if (!groups[h.episode_id]) groups[h.episode_id] = { episode_id: h.episode_id, title: h.title, hits: [] };
    groups[h.episode_id].hits.push(h);
  }
  const lines = Object.values(groups).map((g) => JSON.stringify(g)).join("\n");
  dlBlob(new Blob([lines], { type: "application/json;charset=utf-8;" }), `kwic_parallel_${Date.now()}.jsonl`);
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderAnalytics(container: HTMLElement) {
  const bar = container.querySelector<HTMLElement>(".kwic-analytics");
  if (!bar || !_facets) { bar?.classList.add("hidden"); return; }

  const f = _facets;
  const chips = f.top_episodes.slice(0, 6).map((ep) =>
    `<button class="kwic-facet-chip" data-ep="${escapeHtml(ep.episode_id)}"
      title="${escapeHtml(ep.title || ep.episode_id)}">${escapeHtml(ep.episode_id)} <span class="kwic-facet-count">${ep.count}</span></button>`
  ).join("");
  const moreNote = _hasMore
    ? `<span class="kwic-has-more-note kwic-analytics-sep">≥${_hits.length} résultats (limite atteinte, affinez)</span>`
    : "";

  bar.innerHTML = `
    <span class="kwic-analytics-total">${f.total_hits} résultat${f.total_hits !== 1 ? "s" : ""}</span>
    <span class="kwic-analytics-sep">·</span>
    <span>${f.distinct_episodes} épisode${f.distinct_episodes !== 1 ? "s" : ""}</span>
    ${f.distinct_langs > 0 ? `<span class="kwic-analytics-sep">·</span><span>${f.distinct_langs} langue${f.distinct_langs !== 1 ? "s" : ""}</span>` : ""}
    ${chips ? `<span class="kwic-analytics-sep">—</span>${chips}` : ""}
    ${moreNote}`;
  bar.classList.remove("hidden");

  bar.querySelectorAll<HTMLButtonElement>(".kwic-facet-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const epInput = container.querySelector<HTMLInputElement>("#kwic-episode-id");
      if (epInput) {
        epInput.value = chip.dataset.ep!;
        updateChips(container);
        container.querySelector<HTMLButtonElement>("#kwic-search-btn")?.click();
      }
    });
  });
}

function renderResults(container: HTMLElement) {
  if (_showAligned) {
    renderAlignedCards(container);
    return;
  }
  renderTableResults(container);
}

function renderTableResults(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
  const pag  = container.querySelector<HTMLElement>(".kwic-pagination")!;
  const exportBtn = container.querySelector<HTMLButtonElement>("#kwic-export-btn");

  const pageCount = Math.ceil(_hits.length / PAGE_SIZE);
  _page = Math.min(_page, Math.max(0, pageCount - 1));
  const slice = _hits.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

  if (exportBtn) exportBtn.disabled = _hits.length === 0;

  if (_hits.length === 0) {
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:1.8rem">🔍</span><span>Aucun résultat.</span></div>`;
    pag.classList.remove("visible");
    return;
  }

  const rows = slice.map((h) => {
    const badges: string[] = [];
    if (h.speaker) badges.push(`<span class="kwic-speaker-badge" title="${escapeHtml(h.speaker)}">${escapeHtml(h.speaker.slice(0, 14))}</span>`);
    if (h.kind)    badges.push(`<span class="kwic-kind-badge">${h.kind === "utterance" ? "tour" : "phrase"}</span>`);
    if (h.lang)    badges.push(`<span class="kwic-lang-badge">${escapeHtml(h.lang)}</span>`);
    const citation = `${h.left}${h.match}${h.right}`.replace(/\n/g, " ");
    return `
      <tr>
        <td class="kwic-col-ep">
          <span class="kwic-ep-id">${escapeHtml(h.episode_id)}</span>
          <span class="kwic-ep-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
        </td>
        <td class="kwic-col-left">${escapeHtml(h.left)}</td>
        <td class="kwic-col-match"><span class="kwic-match-pill">${escapeHtml(h.match)}</span></td>
        <td class="kwic-col-right">${escapeHtml(h.right)}</td>
        <td class="kwic-col-meta"><div class="kwic-meta-badges">${badges.join("")}</div></td>
        <td class="kwic-col-copy">
          <button class="kwic-copy-btn" data-text="${escapeHtml(citation)}" title="Copier">⎘</button>
        </td>
      </tr>`;
  }).join("");

  wrap.innerHTML = `
    <table class="kwic-table">
      <thead>
        <tr>
          <th class="kwic-col-ep">Épisode</th>
          <th class="kwic-col-left">Contexte gauche</th>
          <th class="kwic-col-match">Concordance</th>
          <th class="kwic-col-right">Contexte droit</th>
          <th class="kwic-col-meta">Info</th>
          <th class="kwic-col-copy"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll<HTMLButtonElement>(".kwic-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.text ?? "").then(() => {
        const prev = btn.textContent;
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = prev; }, 1200);
      });
    });
  });

  if (pageCount <= 1) {
    pag.classList.remove("visible");
  } else {
    pag.classList.add("visible");
    pag.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="kwic-prev" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>Page ${_page + 1} / ${pageCount} &nbsp;(${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, _hits.length)})</span>
      <span class="kwic-pag-gap"></span>
      <button class="btn btn-ghost btn-sm" id="kwic-next" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>`;
    pag.querySelector("#kwic-prev")?.addEventListener("click", () => { _page--; renderTableResults(container); });
    pag.querySelector("#kwic-next")?.addEventListener("click", () => { _page++; renderTableResults(container); });
  }
}

function renderAlignedCards(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
  const pag  = container.querySelector<HTMLElement>(".kwic-pagination")!;
  const exportBtn = container.querySelector<HTMLButtonElement>("#kwic-export-btn");

  if (exportBtn) exportBtn.disabled = _hits.length === 0;
  pag.classList.remove("visible");

  if (_hits.length === 0) {
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:1.8rem">🔍</span><span>Aucun résultat.</span></div>`;
    return;
  }

  const pageCount = Math.ceil(_hits.length / PAGE_SIZE);
  _page = Math.min(_page, Math.max(0, pageCount - 1));
  const slice = _hits.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

  function cardHtml(h: KwicHit): string {
    const badges: string[] = [];
    if (h.speaker) badges.push(`<span class="kwic-speaker-badge" title="${escapeHtml(h.speaker)}">${escapeHtml(h.speaker.slice(0, 18))}</span>`);
    if (h.kind)    badges.push(`<span class="kwic-kind-badge">${h.kind === "utterance" ? "tour" : "phrase"}</span>`);
    if (h.lang)    badges.push(`<span class="kwic-lang-badge">${escapeHtml(h.lang)}</span>`);
    const citation = `${h.left}${h.match}${h.right}`.replace(/\n/g, " ");
    return `
      <div class="kwic-card">
        <div class="kwic-card-head">
          <span class="kwic-card-ep">${escapeHtml(h.episode_id)}</span>
          <span class="kwic-card-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
          <div class="kwic-meta-badges">${badges.join("")}</div>
        </div>
        <div class="kwic-card-context">
          <span class="kwic-card-left">${escapeHtml(h.left)}</span><span class="kwic-card-match">${escapeHtml(h.match)}</span><span class="kwic-card-right">${escapeHtml(h.right)}</span>
        </div>
        <div class="kwic-card-footer">
          <button class="kwic-card-copy" data-text="${escapeHtml(citation)}" title="Copier">⎘ Copier</button>
        </div>
      </div>`;
  }

  let html = `<div class="kwic-cards-wrap">`;

  if (_showParallel) {
    // Grouper par épisode avec séparateurs
    const groups: { epId: string; title: string; hits: KwicHit[] }[] = [];
    const seen = new Map<string, number>();
    for (const h of slice) {
      if (!seen.has(h.episode_id)) {
        seen.set(h.episode_id, groups.length);
        groups.push({ epId: h.episode_id, title: h.title, hits: [] });
      }
      groups[seen.get(h.episode_id)!].hits.push(h);
    }
    for (const g of groups) {
      html += `<div class="kwic-ep-sep">${escapeHtml(g.epId)} — ${escapeHtml(g.title.slice(0, 40))}</div>`;
      html += g.hits.map(cardHtml).join("");
    }
  } else {
    html += slice.map(cardHtml).join("");
  }

  html += `</div>`;
  wrap.innerHTML = html;

  // Copy buttons
  wrap.querySelectorAll<HTMLButtonElement>(".kwic-card-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.text ?? "").then(() => {
        const prev = btn.textContent;
        btn.textContent = "✓";
        setTimeout(() => { btn.textContent = prev; }, 1200);
      });
    });
  });

  if (pageCount > 1) {
    pag.classList.add("visible");
    pag.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="kwic-prev" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>Page ${_page + 1} / ${pageCount} &nbsp;(${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, _hits.length)})</span>
      <span class="kwic-pag-gap"></span>
      <button class="btn btn-ghost btn-sm" id="kwic-next" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>`;
    pag.querySelector("#kwic-prev")?.addEventListener("click", () => { _page--; renderAlignedCards(container); });
    pag.querySelector("#kwic-next")?.addEventListener("click", () => { _page++; renderAlignedCards(container); });
  }
}

// ── Chips ────────────────────────────────────────────────────────────────────

function updateChips(container: HTMLElement) {
  const bar = container.querySelector<HTMLElement>("#kwic-chips-bar");
  if (!bar) return;

  const kind = (container.querySelector<HTMLSelectElement>("#kwic-kind")?.value ?? "");
  const lang = (container.querySelector<HTMLInputElement>("#kwic-lang")?.value.trim() ?? "");
  const ep   = (container.querySelector<HTMLInputElement>("#kwic-episode-id")?.value.trim() ?? "");
  const sp   = (container.querySelector<HTMLInputElement>("#kwic-speaker")?.value.trim() ?? "");

  const chips: string[] = [];
  if (kind) chips.push(`<span class="kwic-chip">Type : ${escapeHtml(kind)} <button class="kwic-chip-rm" data-clear="kind">✕</button></span>`);
  if (lang) chips.push(`<span class="kwic-chip">Langue : ${escapeHtml(lang)} <button class="kwic-chip-rm" data-clear="lang">✕</button></span>`);
  if (ep)   chips.push(`<span class="kwic-chip">Épisode : ${escapeHtml(ep)} <button class="kwic-chip-rm" data-clear="ep">✕</button></span>`);
  if (sp)   chips.push(`<span class="kwic-chip">Locuteur : ${escapeHtml(sp)} <button class="kwic-chip-rm" data-clear="sp">✕</button></span>`);
  bar.innerHTML = chips.join("");

  bar.querySelectorAll<HTMLButtonElement>(".kwic-chip-rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.clear!;
      if (key === "kind") { const el = container.querySelector<HTMLSelectElement>("#kwic-kind");     if (el) el.value = ""; }
      if (key === "lang") { const el = container.querySelector<HTMLInputElement>("#kwic-lang");      if (el) el.value = ""; }
      if (key === "ep")   { const el = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (el) el.value = ""; }
      if (key === "sp")   { const el = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (el) el.value = ""; }
      updateChips(container);
    });
  });
}

// ── Mount ────────────────────────────────────────────────────────────────────

export function mountConcordancier(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  _hits        = [];
  _page        = 0;
  _hasMore     = false;
  _facets      = null;
  _filterOpen  = false;
  _histOpen    = false;
  _expOpen     = false;
  _builderOpen = false;
  _helpOpen    = false;
  _scope       = "segments";
  _builderMode = "simple";
  _nearN       = 5;
  _showAligned = false;
  _showParallel = false;

  container.innerHTML = `
    <div class="kwic-root">

      <!-- Toolbar -->
      <div class="kwic-toolbar">
        <div class="kwic-search-row">
          <input class="kwic-search-input" id="kwic-input" type="search"
            placeholder="Rechercher dans le corpus (FTS5)…" autocomplete="off" spellcheck="false">
          <button class="btn btn-primary btn-sm kwic-search-btn" id="kwic-search-btn">Rechercher</button>
          <div class="kwic-mode-tabs">
            <button class="kwic-mode-tab active" data-scope="segments">Segments</button>
            <button class="kwic-mode-tab" data-scope="cues">Sous-titres</button>
            <button class="kwic-mode-tab" data-scope="episodes">Documents</button>
          </div>
        </div>
        <div class="kwic-controls-row">
          <div class="kwic-window-ctrl">
            <span>Fenêtre</span>
            <input type="range" id="kwic-window" min="20" max="120" value="60" step="10">
            <span class="kwic-window-val" id="kwic-window-val">60</span>
          </div>
          <span class="kwic-ctrl-spacer"></span>
          <button class="kwic-toolbar-btn" id="kwic-aligned-btn">Alignés : off</button>
          <button class="kwic-toolbar-btn" id="kwic-parallel-btn" style="display:none">Parallèle : off</button>
          <button class="kwic-toolbar-btn" id="kwic-builder-btn">✏ Requête</button>
          <div class="kwic-help-wrap">
            <button class="kwic-toolbar-btn" id="kwic-help-btn" title="Aide syntaxe FTS5" style="font-weight:700">?</button>
            <div class="kwic-help-popover" id="kwic-help-popover">
              <div class="kwic-help-head">
                Aide — Syntaxe FTS5
                <button class="kwic-help-close" id="kwic-help-close">✕</button>
              </div>
              <div class="kwic-help-body">
                <div>
                  <div class="kwic-help-section-title">Exemples de requêtes</div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">liberté</span>
                    <span class="kwic-help-ex-desc">Mot simple</span>
                    <button class="kwic-help-ex-copy" data-q="liberté">Copier</button>
                  </div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">"liberté égalité"</span>
                    <span class="kwic-help-ex-desc">Expression exacte</span>
                    <button class="kwic-help-ex-copy" data-q='"liberté égalité"'>Copier</button>
                  </div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">liberté AND fraternité</span>
                    <span class="kwic-help-ex-desc">Les deux mots</span>
                    <button class="kwic-help-ex-copy" data-q="liberté AND fraternité">Copier</button>
                  </div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">liberté OR égalité</span>
                    <span class="kwic-help-ex-desc">Au moins un des mots</span>
                    <button class="kwic-help-ex-copy" data-q="liberté OR égalité">Copier</button>
                  </div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">libr*</span>
                    <span class="kwic-help-ex-desc">Préfixe (wildcard)</span>
                    <button class="kwic-help-ex-copy" data-q="libr*">Copier</button>
                  </div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">NEAR(liberté fraternité, 10)</span>
                    <span class="kwic-help-ex-desc">Deux mots proches (≤ 10 tokens)</span>
                    <button class="kwic-help-ex-copy" data-q="NEAR(liberté fraternité, 10)">Copier</button>
                  </div>
                  <div class="kwic-help-ex">
                    <span class="kwic-help-ex-code">NOT liberté</span>
                    <span class="kwic-help-ex-desc">Exclusion</span>
                    <button class="kwic-help-ex-copy" data-q="NOT liberté">Copier</button>
                  </div>
                </div>
                <div>
                  <div class="kwic-help-section-title">Mode pass-through</div>
                  <div class="kwic-help-note">Si votre requête contient déjà <code>AND</code>, <code>OR</code>, <code>NOT</code>, <code>NEAR</code> ou des guillemets, le builder ne la transforme pas — elle est envoyée telle quelle au moteur FTS5.</div>
                  <div class="kwic-help-note" style="margin-top:4px"><strong>NEAR</strong> requiert au moins 2 mots. Avec 1 seul mot, la requête est passée sans transformation.</div>
                  <div class="kwic-help-note" style="margin-top:4px"><strong>Guillemets internes :</strong> en mode Expression exacte, les guillemets sont convertis en apostrophes.</div>
                </div>
              </div>
            </div>
          </div>
          <button class="kwic-toolbar-btn" id="kwic-filter-btn">⚙ Filtres</button>
          <button class="kwic-toolbar-btn kwic-case-btn" id="kwic-case-btn" title="Respecter la casse">Aa</button>
          <div class="kwic-dd-wrap">
            <button class="kwic-toolbar-btn" id="kwic-hist-btn">⏱ Historique ▾</button>
            <div class="kwic-dd-menu" id="kwic-hist-menu"></div>
          </div>
          <div class="kwic-dd-wrap">
            <button class="kwic-toolbar-btn" id="kwic-export-btn" disabled>⬇ Exporter ▾</button>
            <div class="kwic-dd-menu" id="kwic-export-menu">
              <button class="kwic-dd-item" data-fmt="csv-flat">CSV plat (match + méta)</button>
              <button class="kwic-dd-item" data-fmt="csv-long">CSV long (avec contexte)</button>
              <div class="kwic-dd-sep"></div>
              <button class="kwic-dd-item" data-fmt="jsonl-simple">JSONL — simple</button>
              <button class="kwic-dd-item" data-fmt="jsonl-parallel">JSONL — parallèle (groupé épisode) ★</button>
            </div>
          </div>
          <button class="kwic-toolbar-btn danger" id="kwic-reset-btn" title="Réinitialiser la recherche et tous les filtres">✕ Réinit.</button>
        </div>
      </div>

      <!-- Query builder panel -->
      <div class="kwic-builder-panel hidden" id="kwic-builder-panel">
        <div class="kwic-builder-group">
          <span class="kwic-builder-label">Mode</span>
          <div class="kwic-builder-radio" id="kwic-builder-radio">
            <label><input type="radio" name="kwic-bmode" value="simple" checked> Simple</label>
            <label><input type="radio" name="kwic-bmode" value="phrase"> Expression exacte</label>
            <label><input type="radio" name="kwic-bmode" value="and"> ET (AND)</label>
            <label><input type="radio" name="kwic-bmode" value="or"> OU (OR)</label>
            <label><input type="radio" name="kwic-bmode" value="near"> NEAR</label>
          </div>
        </div>
        <div class="kwic-near-ctrl hidden" id="kwic-near-ctrl">
          <span>N =</span>
          <input type="number" class="kwic-near-input" id="kwic-near-n" min="1" max="50" value="5">
        </div>
        <div class="kwic-builder-warn hidden" id="kwic-builder-warn"></div>
      </div>

      <!-- FTS preview bar -->
      <div class="kwic-fts-preview" id="kwic-fts-preview">
        <span class="kwic-fts-preview-label">FTS :</span>
        <code class="kwic-fts-preview-code" id="kwic-fts-preview-code"></code>
      </div>

      <!-- Filter drawer -->
      <div class="kwic-filter-drawer hidden" id="kwic-filter-drawer">
        <div class="kwic-filter-group" id="kwic-kind-group">
          <span class="kwic-filter-label">Type</span>
          <select class="kwic-filter-select" id="kwic-kind">
            <option value="">Tous</option>
            <option value="utterance">Tours de parole</option>
            <option value="sentence">Phrases</option>
          </select>
        </div>
        <div class="kwic-filter-group" id="kwic-lang-group" style="display:none">
          <span class="kwic-filter-label">Langue</span>
          <input class="kwic-filter-input" id="kwic-lang" placeholder="en, fr, it…" style="width:70px">
        </div>
        <div class="kwic-filter-group">
          <span class="kwic-filter-label">Épisode</span>
          <input class="kwic-filter-input" id="kwic-episode-id" placeholder="S01E01…" list="kwic-ep-datalist" autocomplete="off">
          <datalist id="kwic-ep-datalist"></datalist>
        </div>
        <div class="kwic-filter-group">
          <span class="kwic-filter-label">Locuteur</span>
          <input class="kwic-filter-input" id="kwic-speaker" placeholder="Nom…">
        </div>
        <button class="kwic-filter-clear" id="kwic-clear-filters">✕ Effacer</button>
      </div>

      <!-- Chips bar -->
      <div class="kwic-chips-bar" id="kwic-chips-bar"></div>

      <!-- Analytics bar -->
      <div class="kwic-analytics hidden" id="kwic-analytics"></div>

      <!-- Error -->
      <div class="kwic-error" id="kwic-error"></div>

      <!-- Results -->
      <div class="kwic-table-wrap">
        <div class="kwic-empty">
          <span style="font-size:2.2rem">🔍</span>
          <span>Entrez un terme et lancez la recherche.</span>
        </div>
      </div>

      <!-- Pagination -->
      <div class="kwic-pagination"></div>
    </div>`;

  // ── Refs ────────────────────────────────────────────────────────────────────
  const input          = container.querySelector<HTMLInputElement>("#kwic-input")!;
  const searchBtn      = container.querySelector<HTMLButtonElement>("#kwic-search-btn")!;
  const windowRange    = container.querySelector<HTMLInputElement>("#kwic-window")!;
  const windowVal      = container.querySelector<HTMLElement>("#kwic-window-val")!;
  const filterBtn      = container.querySelector<HTMLButtonElement>("#kwic-filter-btn")!;
  const filterDrawer   = container.querySelector<HTMLElement>("#kwic-filter-drawer")!;
  const histBtn        = container.querySelector<HTMLButtonElement>("#kwic-hist-btn")!;
  const histMenu       = container.querySelector<HTMLElement>("#kwic-hist-menu")!;
  const exportBtn      = container.querySelector<HTMLButtonElement>("#kwic-export-btn")!;
  const exportMenu     = container.querySelector<HTMLElement>("#kwic-export-menu")!;
  const errEl          = container.querySelector<HTMLElement>("#kwic-error")!;
  const kindGroup      = container.querySelector<HTMLElement>("#kwic-kind-group")!;
  const langGroup      = container.querySelector<HTMLElement>("#kwic-lang-group")!;
  const alignedBtn     = container.querySelector<HTMLButtonElement>("#kwic-aligned-btn")!;
  const parallelBtn    = container.querySelector<HTMLButtonElement>("#kwic-parallel-btn")!;
  const builderBtn     = container.querySelector<HTMLButtonElement>("#kwic-builder-btn")!;
  const builderPanel   = container.querySelector<HTMLElement>("#kwic-builder-panel")!;
  const nearCtrl       = container.querySelector<HTMLElement>("#kwic-near-ctrl")!;
  const nearNInput     = container.querySelector<HTMLInputElement>("#kwic-near-n")!;
  const builderWarn    = container.querySelector<HTMLElement>("#kwic-builder-warn")!;
  const helpBtn        = container.querySelector<HTMLButtonElement>("#kwic-help-btn")!;
  const helpPopover    = container.querySelector<HTMLElement>("#kwic-help-popover")!;
  const ftsPreview     = container.querySelector<HTMLElement>("#kwic-fts-preview")!;
  const ftsPreviewCode = container.querySelector<HTMLElement>("#kwic-fts-preview-code")!;
  const resetBtn       = container.querySelector<HTMLButtonElement>("#kwic-reset-btn")!;
  const caseBtn        = container.querySelector<HTMLButtonElement>("#kwic-case-btn")!;

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function refreshAlignedBtn() {
    alignedBtn.textContent = _showAligned ? "Alignés : on" : "Alignés : off";
    alignedBtn.classList.toggle("active", _showAligned);
    parallelBtn.style.display = _showAligned ? "" : "none";
  }

  function refreshParallelBtn() {
    parallelBtn.textContent = _showParallel ? "Parallèle : on" : "Parallèle : off";
    parallelBtn.classList.toggle("active", _showParallel);
  }

  function updateFtsPreview() {
    const raw = input.value.trim();
    if (!raw) { ftsPreview.classList.remove("visible"); return; }
    const transformed = buildFtsQuery(raw, _builderMode, _nearN);
    ftsPreviewCode.textContent = transformed;
    ftsPreview.classList.add("visible");
    // Builder warning
    const warn = getFtsWarning(raw, _builderMode);
    if (warn) { builderWarn.textContent = warn; builderWarn.classList.remove("hidden"); }
    else        { builderWarn.classList.add("hidden"); }
  }

  function closeAllPanels() {
    _histOpen = false;  histMenu.classList.remove("open");  histBtn.classList.remove("active");
    _expOpen  = false;  exportMenu.classList.remove("open"); exportBtn.classList.remove("active");
    _helpOpen = false;  helpPopover.classList.remove("open"); helpBtn.classList.remove("active");
  }

  // ── Mode tabs ───────────────────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".kwic-mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".kwic-mode-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      _scope = tab.dataset.scope as typeof _scope;
      kindGroup.style.display = _scope === "segments" ? "flex" : "none";
      langGroup.style.display = _scope === "cues"     ? "flex" : "none";
    });
  });

  // ── Window slider ───────────────────────────────────────────────────────────
  windowRange.addEventListener("input", () => { windowVal.textContent = windowRange.value; });

  // ── Aligned toggle ──────────────────────────────────────────────────────────
  alignedBtn.addEventListener("click", () => {
    _showAligned = !_showAligned;
    if (!_showAligned) _showParallel = false;
    refreshAlignedBtn();
    refreshParallelBtn();
    if (_hits.length) renderResults(container);
  });

  parallelBtn.addEventListener("click", () => {
    _showParallel = !_showParallel;
    refreshParallelBtn();
    if (_hits.length) renderResults(container);
  });

  refreshAlignedBtn();
  refreshParallelBtn();

  // ── Query builder ───────────────────────────────────────────────────────────
  builderBtn.addEventListener("click", () => {
    _builderOpen = !_builderOpen;
    builderPanel.classList.toggle("hidden", !_builderOpen);
    builderBtn.classList.toggle("active", _builderOpen);
  });

  container.querySelectorAll<HTMLInputElement>("input[name='kwic-bmode']").forEach((radio) => {
    radio.addEventListener("change", () => {
      _builderMode = radio.value as BuilderMode;
      nearCtrl.classList.toggle("hidden", _builderMode !== "near");
      updateFtsPreview();
    });
  });

  nearNInput.addEventListener("input", () => {
    _nearN = Math.max(1, Math.min(50, parseInt(nearNInput.value, 10) || 5));
    updateFtsPreview();
  });

  // ── Help popover ────────────────────────────────────────────────────────────
  helpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _histOpen = false; histMenu.classList.remove("open"); histBtn.classList.remove("active");
    _expOpen  = false; exportMenu.classList.remove("open"); exportBtn.classList.remove("active");
    _helpOpen = !_helpOpen;
    helpPopover.classList.toggle("open", _helpOpen);
    helpBtn.classList.toggle("active", _helpOpen);
  });

  helpPopover.querySelector<HTMLButtonElement>("#kwic-help-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    _helpOpen = false;
    helpPopover.classList.remove("open");
    helpBtn.classList.remove("active");
  });

  helpPopover.querySelectorAll<HTMLButtonElement>(".kwic-help-ex-copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const q = btn.dataset.q ?? "";
      input.value = q;
      updateFtsPreview();
      _helpOpen = false;
      helpPopover.classList.remove("open");
      helpBtn.classList.remove("active");
      input.focus();
    });
  });

  // ── Filter drawer ───────────────────────────────────────────────────────────
  let _episodesLoaded = false;

  async function _populateEpDatalist() {
    if (_episodesLoaded) return;
    try {
      const data = await apiGet<{ episodes: { episode_id: string; title: string }[] }>("/episodes");
      const dl = container.querySelector<HTMLDataListElement>("#kwic-ep-datalist");
      if (!dl) return;
      dl.innerHTML = data.episodes
        .map((ep) => `<option value="${escapeHtml(ep.episode_id)}" label="${escapeHtml(ep.title)}">`)
        .join("");
      _episodesLoaded = true;
    } catch { /* silently ignore — user can still type manually */ }
  }

  filterBtn.addEventListener("click", () => {
    _filterOpen = !_filterOpen;
    filterDrawer.classList.toggle("hidden", !_filterOpen);
    filterBtn.classList.toggle("active", _filterOpen);
    if (_filterOpen) _populateEpDatalist();
  });

  caseBtn.addEventListener("click", () => {
    _caseSensitive = !_caseSensitive;
    caseBtn.classList.toggle("active", _caseSensitive);
    caseBtn.title = _caseSensitive ? "Casse respectée — cliquer pour désactiver" : "Respecter la casse";
    if (_hits.length > 0) runSearch();
  });
  container.querySelector<HTMLButtonElement>("#kwic-clear-filters")?.addEventListener("click", () => {
    (container.querySelector<HTMLSelectElement>("#kwic-kind")!).value = "";
    (container.querySelector<HTMLInputElement>("#kwic-lang")!).value = "";
    (container.querySelector<HTMLInputElement>("#kwic-episode-id")!).value = "";
    (container.querySelector<HTMLInputElement>("#kwic-speaker")!).value = "";
    updateChips(container);
  });
  ["#kwic-kind", "#kwic-lang", "#kwic-episode-id", "#kwic-speaker"].forEach((sel) => {
    container.querySelector(sel)?.addEventListener("change", () => updateChips(container));
    container.querySelector(sel)?.addEventListener("input",  () => updateChips(container));
  });

  // ── History menu ────────────────────────────────────────────────────────────
  function renderHistMenu() {
    const hist = loadHistory();
    if (!hist.length) {
      histMenu.innerHTML = `<span class="kwic-dd-item muted">Historique vide</span>`;
      return;
    }
    histMenu.innerHTML = hist.map((h, i) =>
      `<button class="kwic-dd-item" data-idx="${i}">
        <span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.term.slice(0, 28))}</span>
        <span class="kwic-dd-scope-tag">${h.scope}</span>
       </button>`
    ).join("") +
      `<div class="kwic-dd-sep"></div>
       <button class="kwic-dd-item muted" id="kwic-hist-clear">Effacer l'historique</button>`;

    histMenu.querySelectorAll<HTMLButtonElement>("[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = hist[Number(btn.dataset.idx)];
        input.value = entry.term;
        container.querySelectorAll<HTMLButtonElement>(".kwic-mode-tab").forEach((t) => {
          t.classList.toggle("active", t.dataset.scope === entry.scope);
        });
        _scope = entry.scope as typeof _scope;
        kindGroup.style.display = _scope === "segments" ? "flex" : "none";
        langGroup.style.display = _scope === "cues"     ? "flex" : "none";
        const kEl = container.querySelector<HTMLSelectElement>("#kwic-kind");     if (kEl) kEl.value = entry.kind;
        const lEl = container.querySelector<HTMLInputElement>("#kwic-lang");      if (lEl) lEl.value = entry.lang;
        const eEl = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (eEl) eEl.value = entry.episode_id;
        const sEl = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (sEl) sEl.value = entry.speaker;
        updateChips(container);
        updateFtsPreview();
        closeAllPanels();
        runSearch();
      });
    });
    histMenu.querySelector<HTMLButtonElement>("#kwic-hist-clear")?.addEventListener("click", () => {
      localStorage.removeItem(HIST_KEY);
      closeAllPanels();
    });
  }

  histBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _expOpen  = false; exportMenu.classList.remove("open"); exportBtn.classList.remove("active");
    _helpOpen = false; helpPopover.classList.remove("open"); helpBtn.classList.remove("active");
    _histOpen = !_histOpen;
    if (_histOpen) renderHistMenu();
    histMenu.classList.toggle("open", _histOpen);
    histBtn.classList.toggle("active", _histOpen);
  });

  // ── Export menu ─────────────────────────────────────────────────────────────
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _histOpen = false; histMenu.classList.remove("open"); histBtn.classList.remove("active");
    _helpOpen = false; helpPopover.classList.remove("open"); helpBtn.classList.remove("active");
    _expOpen  = !_expOpen;
    exportMenu.classList.toggle("open", _expOpen);
    exportBtn.classList.toggle("active", _expOpen);
  });
  exportMenu.querySelectorAll<HTMLButtonElement>("[data-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fmt = btn.dataset.fmt!;
      if (fmt === "csv-flat")       exportCsvFlat();
      else if (fmt === "csv-long")  exportCsvLong();
      else if (fmt === "jsonl-simple")   exportJsonlSimple();
      else if (fmt === "jsonl-parallel") exportJsonlParallel();
      closeAllPanels();
    });
  });

  // ── Reset button ────────────────────────────────────────────────────────────
  resetBtn.addEventListener("click", () => {
    input.value = "";
    _hits        = [];
    _page        = 0;
    _hasMore     = false;
    _facets      = null;
    _showAligned = false;
    _showParallel = false;
    _builderMode   = "simple";
    _nearN         = 5;
    _caseSensitive = false;
    caseBtn.classList.remove("active");
    caseBtn.title = "Respecter la casse";
    refreshAlignedBtn();
    refreshParallelBtn();
    ftsPreview.classList.remove("visible");
    builderWarn.classList.add("hidden");
    // Reset builder radio
    const simpleRadio = container.querySelector<HTMLInputElement>("input[name='kwic-bmode'][value='simple']");
    if (simpleRadio) simpleRadio.checked = true;
    nearCtrl.classList.add("hidden");
    nearNInput.value = "5";
    // Reset filters
    const kEl = container.querySelector<HTMLSelectElement>("#kwic-kind");     if (kEl) kEl.value = "";
    const lEl = container.querySelector<HTMLInputElement>("#kwic-lang");      if (lEl) lEl.value = "";
    const eEl = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (eEl) eEl.value = "";
    const sEl = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (sEl) sEl.value = "";
    updateChips(container);
    container.querySelector<HTMLElement>("#kwic-analytics")!.classList.add("hidden");
    errEl.style.display = "none";
    const wrap = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:2.2rem">🔍</span><span>Entrez un terme et lancez la recherche.</span></div>`;
    container.querySelector<HTMLElement>(".kwic-pagination")!.classList.remove("visible");
    exportBtn.disabled = true;
  });

  // Close dropdowns on outside click
  _closeDropdownsRef = (e: MouseEvent) => {
    if (!histBtn.contains(e.target as Node) && !histMenu.contains(e.target as Node))
      { _histOpen = false; histMenu.classList.remove("open"); histBtn.classList.remove("active"); }
    if (!exportBtn.contains(e.target as Node) && !exportMenu.contains(e.target as Node))
      { _expOpen = false; exportMenu.classList.remove("open"); exportBtn.classList.remove("active"); }
    if (!helpBtn.contains(e.target as Node) && !helpPopover.contains(e.target as Node))
      { _helpOpen = false; helpPopover.classList.remove("open"); helpBtn.classList.remove("active"); }
  };
  document.addEventListener("click", _closeDropdownsRef);

  // ── FTS preview on input ─────────────────────────────────────────────────────
  input.addEventListener("input", updateFtsPreview);

  // ── Facets (client-side fallback) ────────────────────────────────────────────
  function buildFacetsFromHits(term: string): FacetsResponse {
    const epMap: Record<string, { title: string; count: number }> = {};
    const langs = new Set<string>();
    for (const h of _hits) {
      if (!epMap[h.episode_id]) epMap[h.episode_id] = { title: h.title, count: 0 };
      epMap[h.episode_id].count++;
      if (h.lang) langs.add(h.lang);
    }
    return {
      term, scope: _scope,
      total_hits: _hits.length,
      distinct_episodes: Object.keys(epMap).length,
      distinct_langs: langs.size,
      top_episodes: Object.entries(epMap)
        .map(([id, v]) => ({ episode_id: id, title: v.title, count: v.count }))
        .sort((a, b) => b.count - a.count).slice(0, 8),
    };
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  async function runSearch() {
    const raw = input.value.trim();
    if (!raw) return;

    const term = buildFtsQuery(raw, _builderMode, _nearN);
    updateFtsPreview();

    searchBtn.disabled = true;
    searchBtn.textContent = "…";
    errEl.style.display = "none";
    container.querySelector<HTMLElement>("#kwic-analytics")!.classList.add("hidden");

    const req: QueryRequest = {
      term, scope: _scope,
      kind:           _scope === "segments" ? (container.querySelector<HTMLSelectElement>("#kwic-kind")!.value || null) : null,
      lang:           _scope === "cues"     ? (container.querySelector<HTMLInputElement>("#kwic-lang")!.value.trim() || null) : null,
      episode_id:     container.querySelector<HTMLInputElement>("#kwic-episode-id")!.value.trim() || null,
      speaker:        container.querySelector<HTMLInputElement>("#kwic-speaker")!.value.trim() || null,
      window:         Number(windowRange.value),
      limit:          500,
      case_sensitive: _caseSensitive || undefined,
    };

    try {
      const res = await apiPost<QueryResponse>("/query", req);
      _hits    = res.hits;
      _hasMore = res.has_more ?? false;
      _page    = 0;

      saveHistory({ term: raw, scope: _scope, kind: req.kind ?? "", lang: req.lang ?? "",
        episode_id: req.episode_id ?? "", speaker: req.speaker ?? "", ts: Date.now() });

      renderResults(container);
      updateChips(container);

      // Facets — backend first, client fallback
      _facets = null;
      apiPost<FacetsResponse>("/query/facets", {
        term, scope: _scope, kind: req.kind, lang: req.lang,
        episode_id: req.episode_id, speaker: req.speaker,
      }).then((f) => {
        _facets = f;
        renderAnalytics(container);
      }).catch(() => {
        _facets = buildFacetsFromHits(raw);
        renderAnalytics(container);
      });

    } catch (e) {
      const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
      errEl.textContent = msg;
      errEl.style.display = "block";
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "Rechercher";
    }
  }

  searchBtn.addEventListener("click", runSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  _unsubscribe = ctx.onStatusChange(() => {});
}

// ── Dispose ───────────────────────────────────────────────────────────────────

export function disposeConcordancier() {
  if (_unsubscribe)       { _unsubscribe(); _unsubscribe = null; }
  if (_closeDropdownsRef) { document.removeEventListener("click", _closeDropdownsRef); _closeDropdownsRef = null; }
  _hits         = [];
  _facets       = null;
  _showAligned  = false;
  _showParallel = false;
  _builderMode  = "simple";
  _nearN        = 5;
}
