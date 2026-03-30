/**
 * concordancierModule.ts — Concordancier KWIC v3 (MX-034)
 *
 * Portée : recherche **uniquement sur les segments** indexés (`scope=segments` / FTS `segments_fts`).
 * Les textes bruts, documents normalisés seuls ou sous-titres sans segmentation ne sont pas interrogés ici.
 *
 * Parity AGRAFES (résultats / toolbar) :
 *   - Aligned toggle (vue cartes enrichies) + Parallel toggle (groupé épisode)
 *   - Query builder panel (5 modes : simple / phrase / and / or / near + near-N)
 *   - FTS preview bar (query transformée en temps réel)
 *   - Help popover (exemples FTS5 + copy buttons)
 *   - History localStorage (10 entrées)
 *   - Export 4 formats : CSV plat, CSV long, JSONL simple, JSONL parallèle
 *   - Filtre drawer (type / langue / épisode / locuteur)
 *   - Chips bar (filtres actifs)
 *   - Analytics bar (total hits · épisodes · langues · top-épisodes cliquables)
 *   - Barre résultats : tri client (épisode / position), affichage compact, Charger plus (offset + append jusqu’à 2000)
  *   - Raccourcis / (focus recherche), Esc (ferme popovers)
  *   - Bouton ℹ par résultat → panneau méta épisode/source (`features/metaPanel.ts`)
  *   - Reset button (efface tout)
  *   - Pagination client-side avec bannière has_more
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import {
  apiPost, apiGet, ApiError, formatApiError, withNoDbRecovery, fetchQaReport, rebuildSegmentsFts,
  type KwicHit, type QueryRequest, type QueryResponse,
  type FacetsTopEpisode, type FacetsResponse, type KwicHistoryEntry,
  type StatsWord, type StatsResult, type StatsCompareWord, type StatsCompareResult,
} from "../api";
import { openMetaPanel, type EpisodeSourceInfo } from "../features/metaPanel.ts";

// ── Types ────────────────────────────────────────────
// Les types KwicHit, QueryRequest, QueryResponse, FacetsTopEpisode, FacetsResponse,
// KwicHistoryEntry, StatsWord, StatsResult, StatsCompareWord, StatsCompareResult
// sont centralisés dans api.ts et importés ci-dessus.

type BuilderMode = "simple" | "phrase" | "and" | "or" | "near";

/** Toujours `segments` — le concordancier ne cible que l’index FTS des segments. */
const KWIC_SCOPE = "segments" as const;

// Alias local pour raccourcir les usages internes
type HistoryEntry = KwicHistoryEntry;

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
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 80%, transparent);
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

/* Portée fixe : segments uniquement */
.kwic-scope-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface2));
}
.kwic-scope-badge {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
.kwic-scope-sub {
  font-size: 0.72rem;
  color: var(--text-muted);
  max-width: 200px;
  line-height: 1.25;
}
.kwic-empty-qa {
  font-size: 0.76rem;
  color: var(--text-muted);
  max-width: 32rem;
  margin-top: 10px;
  line-height: 1.45;
  text-align: center;
  min-height: 0;
}
.kwic-empty-qa strong { color: var(--text); }

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
.kwic-feedback {
  margin: 6px 14px 0;
  padding: 7px 12px;
  border-radius: var(--radius);
  font-size: 0.78rem;
  display: none;
  flex-shrink: 0;
}
.kwic-feedback.visible { display: block; }
.kwic-feedback.success {
  background: color-mix(in srgb, #15803d 12%, transparent);
  border: 1px solid #15803d;
  color: #166534;
}
.kwic-feedback.err {
  background: color-mix(in srgb, #dc2626 10%, transparent);
  border: 1px solid #dc2626;
  color: #dc2626;
}

/* ── Results table ───────────────────────────────────────────── */
.kwic-table-wrap {
  flex: 1;
  min-height: 0;
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
.kwic-meta-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius, 6px);
  padding: 2px 7px;
  font-size: 0.72rem;
  cursor: pointer;
  color: var(--text-muted);
  margin-left: 6px;
  vertical-align: middle;
}
.kwic-meta-btn:hover {
  background: var(--surface2);
  color: var(--text);
}
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
  min-height: 0;
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

/* ── Barre résultats (tri / compact / charger +) — style type atelier AGRAFES ─ */
.kwic-results-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface2) 85%, var(--surface));
  flex-shrink: 0;
}
.kwic-results-toolbar.hidden { display: none; }
.kwic-results-left, .kwic-results-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.kwic-results-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted);
}
.kwic-results-select {
  font-size: 0.78rem;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-family: inherit;
  min-width: 200px;
}
.kwic-results-count {
  font-size: 0.74rem;
  color: var(--text-muted);
}
.kwic-compact-toggle.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface2));
}

/* Mode compact : densité type liste KWIC studio */
.kwic-root.kwic-compact .kwic-table th { padding: 3px 6px; font-size: 0.65rem; }
.kwic-root.kwic-compact .kwic-table td { padding: 2px 6px; font-size: 0.76rem; }
.kwic-root.kwic-compact .kwic-match-pill { font-size: 0.78rem; }
.kwic-root.kwic-compact .kwic-card { padding: 6px 10px; }
.kwic-root.kwic-compact .kwic-card-context { font-size: 0.8rem; line-height: 1.45; }

/* ── Stats panel ────────────────────────────────────────────────────────────── */
.kwic-stats-toggle.active { background: var(--accent,#6366f1); color: #fff; border-color: var(--accent,#6366f1); }
/* Même logique que .kwic-table-wrap : occupe la zone centrale et défile si besoin */
.kwic-stats-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 12px;
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
}
.kwic-stats-panel.hidden { display: none; }
#kwic-stats-results {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  flex: 1 1 auto;
}
.kwic-stats-filter-block { background: var(--bg-card,#f8f9fb); border: 1px solid var(--border,#e0e0e6); border-radius: 8px; padding: 14px 16px; min-width: 0; }
.kwic-stats-filter-block-b { border-color: #f97316; }
.kwic-stats-filter-block-b.hidden { display: none; }
.kwic-stats-filter-hd { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 600; margin-bottom: 10px; color: var(--text,#1a1a2e); }
.kwic-stats-filters { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; row-gap: 10px; }
.kwic-stats-filter-group { display: flex; flex-direction: column; gap: 4px; flex: 1 1 120px; min-width: 0; max-width: 100%; }
.kwic-stats-filter-group label { font-size: 0.67rem; font-weight: 600; color: var(--text-muted,#888); text-transform: uppercase; letter-spacing: 0.05em; }
.kwic-stats-filter-group input, .kwic-stats-filter-group select {
  font-size: 0.82rem;
  padding: 5px 8px;
  border: 1px solid var(--border,#e0e0e6);
  border-radius: 4px;
  background: var(--bg,#fff);
  color: var(--text,#1a1a2e);
  min-width: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}
.kwic-stats-filters > .btn,
.kwic-stats-filters > .kwic-toolbar-btn { flex-shrink: 0; align-self: flex-end; }
.kwic-stats-badge { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; font-size: 0.65rem; font-weight: 700; flex-shrink: 0; }
.kwic-stats-badge-a { background: #3b82f6; color: #fff; }
.kwic-stats-badge-b { background: #f97316; color: #fff; }
.kwic-stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7.25rem), 1fr));
  gap: 10px;
}
.kwic-stats-card {
  background: var(--bg-card,#f8f9fb);
  border: 1px solid var(--border,#e0e0e6);
  border-radius: 8px;
  padding: 12px 14px;
  min-width: 0;
  text-align: center;
}
.kwic-stats-card-val { font-size: 1.45rem; font-weight: 700; color: var(--accent,#6366f1); font-variant-numeric: tabular-nums; line-height: 1.15; }
.kwic-stats-card-lbl { font-size: 0.67rem; color: var(--text-muted,#888); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
.kwic-stats-section { background: var(--bg-card,#f8f9fb); border: 1px solid var(--border,#e0e0e6); border-radius: 8px; padding: 14px 16px; min-width: 0; }
.kwic-stats-section-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  row-gap: 6px;
}
.kwic-stats-section-hd .kwic-toolbar-btn { flex-shrink: 0; }
.kwic-stats-section-title { font-size: 0.85rem; font-weight: 600; flex: 1 1 12rem; min-width: 0; line-height: 1.35; }
.kwic-stats-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  min-width: 0;
}
.kwic-stats-split .kwic-stats-section-hd span { min-width: 0; word-break: break-word; }
@media (max-width: 960px) { .kwic-stats-split { grid-template-columns: 1fr; } }
.kwic-stats-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; table-layout: fixed; }
.kwic-stats-table th { text-align: left; padding: 5px 10px; font-size: 0.67rem; font-weight: 600; color: var(--text-muted,#888); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--border,#e0e0e6); }
.kwic-stats-table:not(.kwic-stats-table-rare) th:nth-child(1) { width: 2.75rem; }
.kwic-stats-table:not(.kwic-stats-table-rare) th:nth-child(3),
.kwic-stats-table:not(.kwic-stats-table-rare) th:nth-child(4) { width: 6.5rem; }
.kwic-stats-table:not(.kwic-stats-table-rare) th:nth-child(5) { width: 120px; }
.kwic-stats-table-rare th:nth-child(2),
.kwic-stats-table-rare th:nth-child(3) { width: 6.5rem; }
.kwic-stats-table td { padding: 5px 10px; border-bottom: 1px solid rgba(0,0,0,0.04); vertical-align: middle; }
.kwic-stats-table:not(.kwic-stats-table-rare) td:nth-child(1),
.kwic-stats-table:not(.kwic-stats-table-rare) td:nth-child(3),
.kwic-stats-table:not(.kwic-stats-table-rare) td:nth-child(4),
.kwic-stats-table:not(.kwic-stats-table-rare) td:nth-child(5) { white-space: nowrap; }
.kwic-stats-table:not(.kwic-stats-table-rare) td:nth-child(2) {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.kwic-stats-table-rare td:nth-child(1) {
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.kwic-stats-table-rare td:nth-child(2),
.kwic-stats-table-rare td:nth-child(3) { white-space: nowrap; }
.kwic-stats-table tr:last-child td { border-bottom: none; }
.kwic-stats-table-wrap {
  max-height: min(360px, 50vh);
  overflow-y: auto;
  overflow-x: auto;
  border: 1px solid var(--border,#e0e0e6);
  border-radius: 4px;
  min-width: 0;
  -webkit-overflow-scrolling: touch;
}
.kwic-stats-cmp-table-wrap {
  max-height: min(480px, 55vh);
  overflow-y: auto;
  overflow-x: auto;
  border: 1px solid var(--border,#e0e0e6);
  border-radius: 4px;
  min-width: 0;
  -webkit-overflow-scrolling: touch;
}
.kwic-stats-bar { display: inline-block; height: 6px; border-radius: 3px; background: var(--accent,#6366f1); opacity: 0.65; vertical-align: middle; max-width: 100%; }
.kwic-stats-bar-b { background: #f97316; }
.kwic-stats-cmp-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; table-layout: fixed; }
.kwic-stats-cmp-table th { text-align: right; padding: 4px 8px; font-size: 0.65rem; font-weight: 600; color: var(--text-muted,#888); text-transform: uppercase; border-bottom: 1px solid var(--border,#e0e0e6); }
.kwic-stats-cmp-table th:first-child { text-align: left; width: 26%; }
.kwic-stats-cmp-table th:nth-child(2),
.kwic-stats-cmp-table th:nth-child(3),
.kwic-stats-cmp-table th:nth-child(4) { width: 12%; }
.kwic-stats-cmp-table th:last-child { width: 140px; text-align: left; }
.kwic-stats-cmp-table td { padding: 4px 8px; text-align: right; border-bottom: 1px solid rgba(0,0,0,0.04); font-variant-numeric: tabular-nums; vertical-align: middle; }
.kwic-stats-cmp-table td:first-child { text-align: left; font-weight: 500; overflow-wrap: anywhere; word-break: break-word; }
.kwic-stats-cmp-table td:last-child { text-align: left; white-space: nowrap; }
.kwic-stats-cmp-table tr:last-child td { border-bottom: none; }
.kwic-stats-more-a { color: #3b82f6; }
.kwic-stats-more-b { color: #f97316; }
.kwic-stats-loading { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted,#888); font-size: 0.85rem; padding: 32px; min-height: 0; flex: 1; }
`;

// ── Constants & State ────────────────────────────────────────────────────────

const HIST_KEY       = "himyc_kwic_history";
const SORT_LS_KEY    = "himyc_kwic_sort";
const COMPACT_LS_KEY = "himyc_kwic_compact";

let _projectPrefix = "";
/** Préfixe toutes les clés localStorage avec l'identifiant du projet courant. */
function lsKey(k: string): string {
  return _projectPrefix ? `${_projectPrefix}:${k}` : k;
}
const PAGE_SIZE = 50;
const QUERY_LIMIT_INITIAL = 500;
const QUERY_LIMIT_MAX = 2000;
/** Taille d’une requête « Charger plus » (append avec offset). */
const QUERY_CHUNK = 500;

type SortMode = "relevance" | "ep_asc" | "ep_desc" | "position";

function readSortMode(): SortMode {
  const v = localStorage.getItem(lsKey(SORT_LS_KEY));
  if (v === "ep_asc" || v === "ep_desc" || v === "position" || v === "relevance") return v;
  return "relevance";
}

/** Ordre d’affichage (tri client, comme un tri par document dans AGRAFES). */
function getDisplayHits(): KwicHit[] {
  if (_sortMode === "relevance") return _hits;
  const h = [..._hits];
  switch (_sortMode) {
    case "ep_asc":
      return h.sort((a, b) => {
        const c = a.episode_id.localeCompare(b.episode_id, undefined, { numeric: true, sensitivity: "base" });
        return c !== 0 ? c : a.position - b.position;
      });
    case "ep_desc":
      return h.sort((a, b) => {
        const c = b.episode_id.localeCompare(a.episode_id, undefined, { numeric: true, sensitivity: "base" });
        return c !== 0 ? c : a.position - b.position;
      });
    case "position":
      return h.sort((a, b) => a.position - b.position || a.episode_id.localeCompare(b.episode_id));
    default:
      return _hits;
  }
}

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
let _shellCtx: ShellContext | null = null;
let _builderMode: BuilderMode      = "simple";
let _nearN                         = 5;
let _showAligned                   = false;
let _showParallel                  = false;
let _caseSensitive                 = false;
let _unsubscribe: (() => void) | null = null;
let _closeDropdownsRef: ((e: MouseEvent) => void) | null = null;
let _searchToken                   = 0; // token anti-race pour les requêtes de recherche
let _statsToken                    = 0; // token anti-race pour les requêtes de stats
let _concordancierMountId          = 0; // incrémenté au dispose pour invalider les async en vol (reindex FTS…)
let _sortMode: SortMode            = "relevance";
let _compactView                   = false;
let _kbdHandler: ((e: KeyboardEvent) => void) | null = null;
let _statsMode              = false;
let _statsResults: StatsResult | null = null;
let _statsCompareMode       = false;
let _statsCompareResults: StatsCompareResult | null = null;

// ── History ──────────────────────────────────────────────────────────────────

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(lsKey(HIST_KEY)) ?? "[]") as HistoryEntry[]; }
  catch { return []; }
}

function saveHistory(entry: HistoryEntry) {
  const hist = loadHistory().filter((h) => h.term !== entry.term);
  hist.unshift(entry);
  localStorage.setItem(lsKey(HIST_KEY), JSON.stringify(hist.slice(0, 10)));
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
  const rowsSrc = getDisplayHits();
  if (!rowsSrc.length) return;
  const hdr  = "episode_id,title,match,speaker,lang,kind\n";
  const rows = rowsSrc.map((h) =>
    [h.episode_id, h.title, h.match, h.speaker ?? "", h.lang ?? "", h.kind ?? ""].map(csvQ).join(",")
  ).join("\n");
  dlBlob(new Blob([hdr + rows], { type: "text/csv;charset=utf-8;" }), `kwic_${Date.now()}.csv`);
}

function exportCsvLong() {
  const rowsSrc = getDisplayHits();
  if (!rowsSrc.length) return;
  const hdr  = "episode_id,title,left,match,right,speaker,lang,kind,position\n";
  const rows = rowsSrc.map((h) =>
    [h.episode_id, h.title, h.left, h.match, h.right, h.speaker ?? "", h.lang ?? "", h.kind ?? "", String(h.position)]
      .map(csvQ).join(",")
  ).join("\n");
  dlBlob(new Blob([hdr + rows], { type: "text/csv;charset=utf-8;" }), `kwic_long_${Date.now()}.csv`);
}

function exportJsonlSimple() {
  const rowsSrc = getDisplayHits();
  if (!rowsSrc.length) return;
  const lines = rowsSrc.map((h) => JSON.stringify(h)).join("\n");
  dlBlob(new Blob([lines], { type: "application/json;charset=utf-8;" }), `kwic_${Date.now()}.jsonl`);
}

function exportJsonlParallel() {
  const rowsSrc = getDisplayHits();
  if (!rowsSrc.length) return;
  // Grouper par épisode : { episode_id, title, hits: [...] }
  const groups: Record<string, { episode_id: string; title: string; hits: KwicHit[] }> = {};
  for (const h of rowsSrc) {
    if (!groups[h.episode_id]) groups[h.episode_id] = { episode_id: h.episode_id, title: h.title, hits: [] };
    groups[h.episode_id].hits.push(h);
  }
  const lines = Object.values(groups).map((g) => JSON.stringify(g)).join("\n");
  dlBlob(new Blob([lines], { type: "application/json;charset=utf-8;" }), `kwic_parallel_${Date.now()}.jsonl`);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function exportStatsCsv(words: StatsWord[], filename: string) {
  const hdr  = "mot,occurrences,freq_pct\n";
  const rows = words.map((w) => [csvQ(w.word), String(w.count), String(w.freq_pct)].join(",")).join("\n");
  dlBlob(new Blob([hdr + rows], { type: "text/csv;charset=utf-8;" }), filename);
}

function exportCompareCsv(d: StatsCompareResult) {
  const hdr  = `mot,${csvQ(d.label_a)}_count,${csvQ(d.label_a)}_pct,${csvQ(d.label_b)}_count,${csvQ(d.label_b)}_pct,ratio\n`;
  const rows = d.comparison
    .map((w) => [csvQ(w.word), String(w.count_a), String(w.freq_a), String(w.count_b), String(w.freq_b), String(w.ratio)].join(","))
    .join("\n");
  dlBlob(new Blob([hdr + rows], { type: "text/csv;charset=utf-8;" }), `stats_compare_${Date.now()}.csv`);
}

function _renderSingleStats(d: StatsResult): string {
  const fmt = (n: number) => n.toLocaleString("fr-FR");
  const maxCount = d.top_words[0]?.count ?? 1;
  if (!d.total_tokens) {
    return `<div class="kwic-stats-loading" style="color:var(--text-muted)">Aucun segment trouvé pour ces filtres.</div>`;
  }
  return `
    <div class="kwic-stats-cards">
      <div class="kwic-stats-card"><div class="kwic-stats-card-val">${fmt(d.total_tokens)}</div><div class="kwic-stats-card-lbl">Tokens</div></div>
      <div class="kwic-stats-card"><div class="kwic-stats-card-val">${fmt(d.vocabulary_size)}</div><div class="kwic-stats-card-lbl">Vocabulaire</div></div>
      <div class="kwic-stats-card"><div class="kwic-stats-card-val">${fmt(d.total_segments)}</div><div class="kwic-stats-card-lbl">Segments</div></div>
      <div class="kwic-stats-card"><div class="kwic-stats-card-val">${fmt(d.total_episodes)}</div><div class="kwic-stats-card-lbl">Épisodes</div></div>
      <div class="kwic-stats-card"><div class="kwic-stats-card-val">${d.avg_tokens_per_segment}</div><div class="kwic-stats-card-lbl">Moy.&nbsp;mots/seg</div></div>
    </div>
    <div class="kwic-stats-section">
      <div class="kwic-stats-section-hd">
        <span class="kwic-stats-section-title">Mots les plus fréquents — top ${d.top_words.length}</span>
        <button class="kwic-toolbar-btn kwic-stats-csv-btn" data-type="top" style="font-size:0.75rem">⬇ CSV</button>
      </div>
      <div class="kwic-stats-table-wrap">
        <table class="kwic-stats-table">
          <thead><tr><th>#</th><th>Mot</th><th>Occurrences</th><th>% corpus</th><th style="width:110px"></th></tr></thead>
          <tbody>${d.top_words.map((w, i) => `
            <tr>
              <td style="color:var(--text-muted);font-variant-numeric:tabular-nums">${i + 1}</td>
              <td><strong>${escapeHtml(w.word)}</strong></td>
              <td style="font-variant-numeric:tabular-nums">${fmt(w.count)}</td>
              <td style="font-variant-numeric:tabular-nums">${w.freq_pct.toFixed(2)}&nbsp;%</td>
              <td><span class="kwic-stats-bar" style="width:${Math.round(w.count / maxCount * 100)}px"></span></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
    ${d.rare_words.length ? `
    <div class="kwic-stats-section">
      <div class="kwic-stats-section-hd">
        <span class="kwic-stats-section-title">Mots les moins fréquents (hapax &amp; rares)</span>
        <button class="kwic-toolbar-btn kwic-stats-csv-btn" data-type="rare" style="font-size:0.75rem">⬇ CSV</button>
      </div>
      <div class="kwic-stats-table-wrap">
        <table class="kwic-stats-table kwic-stats-table-rare">
          <thead><tr><th>Mot</th><th>Occurrences</th><th>% corpus</th></tr></thead>
          <tbody>${d.rare_words.map((w) => `
            <tr>
              <td><strong>${escapeHtml(w.word)}</strong></td>
              <td style="font-variant-numeric:tabular-nums">${fmt(w.count)}</td>
              <td style="font-variant-numeric:tabular-nums">${w.freq_pct.toFixed(3)}&nbsp;%</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>` : ""}
  `;
}

function _renderCompareStats(d: StatsCompareResult): string {
  const fmt     = (n: number) => n.toLocaleString("fr-FR");
  const maxFreq = Math.max(...d.comparison.map((w) => Math.max(w.freq_a, w.freq_b)), 0.001);
  const summaryRow = (lbl: string, val: string) =>
    `<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:3px 0"><span style="color:var(--text-muted)">${lbl}</span><strong>${val}</strong></div>`;

  return `
    <div class="kwic-stats-split">
      <div class="kwic-stats-section">
        <div class="kwic-stats-section-hd">
          <span><span class="kwic-stats-badge kwic-stats-badge-a">A</span>&nbsp;${escapeHtml(d.label_a)}</span>
        </div>
        ${summaryRow("Tokens", fmt(d.a.total_tokens))}
        ${summaryRow("Vocabulaire", fmt(d.a.vocabulary_size))}
        ${summaryRow("Segments", fmt(d.a.total_segments))}
        ${summaryRow("Épisodes", fmt(d.a.total_episodes))}
        ${summaryRow("Moy. mots/seg", String(d.a.avg_tokens_per_segment))}
      </div>
      <div class="kwic-stats-section">
        <div class="kwic-stats-section-hd">
          <span><span class="kwic-stats-badge kwic-stats-badge-b">B</span>&nbsp;${escapeHtml(d.label_b)}</span>
        </div>
        ${summaryRow("Tokens", fmt(d.b.total_tokens))}
        ${summaryRow("Vocabulaire", fmt(d.b.vocabulary_size))}
        ${summaryRow("Segments", fmt(d.b.total_segments))}
        ${summaryRow("Épisodes", fmt(d.b.total_episodes))}
        ${summaryRow("Moy. mots/seg", String(d.b.avg_tokens_per_segment))}
      </div>
    </div>
    <div class="kwic-stats-section">
      <div class="kwic-stats-section-hd">
        <span class="kwic-stats-section-title">Comparaison de fréquences</span>
        <button class="kwic-toolbar-btn" id="kwic-stats-cmp-csv" style="font-size:0.75rem">⬇ CSV</button>
      </div>
      <div class="kwic-stats-cmp-table-wrap">
        <table class="kwic-stats-cmp-table">
          <thead><tr>
            <th style="text-align:left">Mot</th>
            <th><span class="kwic-stats-badge kwic-stats-badge-a" style="width:14px;height:14px;font-size:0.55rem;line-height:14px">A</span>&nbsp;%</th>
            <th><span class="kwic-stats-badge kwic-stats-badge-b" style="width:14px;height:14px;font-size:0.55rem;line-height:14px">B</span>&nbsp;%</th>
            <th>Ratio A/B</th>
            <th>Visualisation</th>
          </tr></thead>
          <tbody>${d.comparison.map((w) => {
            const moreA    = w.freq_a > w.freq_b;
            const moreB    = w.freq_b > w.freq_a;
            const ratioTxt = w.ratio >= 999 ? "∞" : w.ratio.toFixed(2);
            const barA     = Math.max(2, Math.round(w.freq_a / maxFreq * 90));
            const barB     = Math.max(2, Math.round(w.freq_b / maxFreq * 90));
            return `<tr>
              <td class="${moreA ? "kwic-stats-more-a" : moreB ? "kwic-stats-more-b" : ""}"><strong>${escapeHtml(w.word)}</strong></td>
              <td class="${moreA ? "kwic-stats-more-a" : ""}">${w.freq_a.toFixed(2)}</td>
              <td class="${moreB ? "kwic-stats-more-b" : ""}">${w.freq_b.toFixed(2)}</td>
              <td class="${moreA ? "kwic-stats-more-a" : moreB ? "kwic-stats-more-b" : ""}">${ratioTxt}</td>
              <td>
                <span class="kwic-stats-bar" style="width:${barA}px"></span>&nbsp;<span class="kwic-stats-bar kwic-stats-bar-b" style="width:${barB}px"></span>
              </td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderStatsResults(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>("#kwic-stats-results")!;
  if (_statsCompareMode && _statsCompareResults) {
    el.innerHTML = _renderCompareStats(_statsCompareResults);
    el.querySelector<HTMLButtonElement>("#kwic-stats-cmp-csv")?.addEventListener("click", () => {
      if (_statsCompareResults) exportCompareCsv(_statsCompareResults);
    });
  } else if (_statsResults) {
    el.innerHTML = _renderSingleStats(_statsResults);
    el.querySelectorAll<HTMLButtonElement>(".kwic-stats-csv-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!_statsResults) return;
        if (btn.dataset["type"] === "rare") exportStatsCsv(_statsResults.rare_words, `stats_rares_${Date.now()}.csv`);
        else exportStatsCsv(_statsResults.top_words, `stats_top_${Date.now()}.csv`);
      });
    });
  }
}

async function runStats(container: HTMLElement) {
  const resultsEl = container.querySelector<HTMLElement>("#kwic-stats-results")!;
  const runBtn    = container.querySelector<HTMLButtonElement>("#kwic-stats-run-btn")!;
  const epA       = (container.querySelector<HTMLInputElement>("#kwic-stats-ep-a")?.value ?? "").trim();
  const kindA     = container.querySelector<HTMLSelectElement>("#kwic-stats-kind-a")?.value ?? "";
  const speakerA  = (container.querySelector<HTMLInputElement>("#kwic-stats-speaker-a")?.value ?? "").trim();
  const topN      = Math.min(200, Math.max(10, parseInt(container.querySelector<HTMLInputElement>("#kwic-stats-topn")?.value ?? "50", 10) || 50));
  const slotA     = { episode_ids: epA ? [epA] : null, kind: kindA || null, speaker: speakerA || null, top_n: topN, min_length: 2 };
  const labelA    = epA || kindA || speakerA || "Corpus complet";

  const myToken = ++_statsToken;

  runBtn.disabled     = true;
  runBtn.textContent  = "Analyse…";
  resultsEl.innerHTML = `<div class="kwic-stats-loading">⏳ Analyse en cours…</div>`;

  try {
    if (_statsCompareMode) {
      const epB      = (container.querySelector<HTMLInputElement>("#kwic-stats-ep-b")?.value ?? "").trim();
      const kindB    = container.querySelector<HTMLSelectElement>("#kwic-stats-kind-b")?.value ?? "";
      const speakerB = (container.querySelector<HTMLInputElement>("#kwic-stats-speaker-b")?.value ?? "").trim();
      const slotB    = { episode_ids: epB ? [epB] : null, kind: kindB || null, speaker: speakerB || null, top_n: topN, min_length: 2 };
      const labelB   = epB || kindB || speakerB || "Corpus complet";
      _statsCompareResults = await apiPost<StatsCompareResult>("/stats/compare", {
        a: slotA, b: slotB, label_a: labelA, label_b: labelB,
      });
    } else {
      _statsResults = await apiPost<StatsResult>("/stats/lexical", { slot: slotA, label: labelA });
    }
    if (_statsToken !== myToken) return;
    renderStatsResults(container);
  } catch (e) {
    if (_statsToken !== myToken) return;
    resultsEl.innerHTML = `<div class="kwic-stats-loading" style="color:var(--danger,#e53e3e)">Erreur : ${escapeHtml(formatApiError(e))}</div>`;
  } finally {
    if (_statsToken !== myToken) return;
    runBtn.disabled    = false;
    runBtn.textContent = "Analyser";
  }
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

/** Après « Aucun résultat », enrichit avec le rapport QA (épisodes segmentés ou non). */
function attachKwicEmptyQaLine(wrap: HTMLElement) {
  const qaSlot = wrap.querySelector<HTMLElement>("#kwic-empty-qa");
  if (!qaSlot) return;
  void withNoDbRecovery(() => fetchQaReport("lenient"))
    .then((qa) => {
      if (!wrap.querySelector("#kwic-empty-qa")) return;
      if (qa.n_segmented === 0) {
        qaSlot.innerHTML =
          `<strong>Aucun épisode segmenté</strong> pour l’instant` +
          (qa.total_episodes > 0
            ? ` (${qa.total_episodes} épisode(s) dans le projet). Sans lignes dans la table <code>segments</code>, le concordancier ne peut rien trouver.`
            : ". Importez ou créez des épisodes, puis lancez la <strong>segmentation</strong> dans Préparer.");
      } else {
        qaSlot.textContent =
          `Le projet compte ${qa.n_segmented} épisode(s) avec des segments — essayez un autre terme, retirez les filtres épisode / locuteur, ou passez le type sur « Tous ».`;
      }
    })
    .catch(() => {
      if (wrap.querySelector("#kwic-empty-qa")) qaSlot.textContent = "";
    });
}

function renderResults(container: HTMLElement) {
  if (_showAligned) {
    renderAlignedCards(container);
    return;
  }
  renderTableResults(container);
}

function updateResultsToolbar(container: HTMLElement): void {
  const tb = container.querySelector<HTMLElement>("#kwic-results-toolbar");
  const cnt = container.querySelector<HTMLElement>("#kwic-results-count");
  const loadMore = container.querySelector<HTMLButtonElement>("#kwic-load-more");
  const disp = getDisplayHits();
  if (cnt) {
    let t = `${disp.length} ligne(s) affichée(s)`;
    if (_hasMore && _hits.length < QUERY_LIMIT_MAX) t += " — d’autres occurrences peuvent exister (Charger plus)";
    else if (_hasMore) t += " — limite max atteinte";
    cnt.textContent = t;
  }
  if (tb) tb.classList.toggle("hidden", disp.length === 0);
  if (loadMore) {
    loadMore.style.display = _hasMore && _hits.length < QUERY_LIMIT_MAX ? "inline-flex" : "none";
  }
}

function renderTableResults(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
  const pag  = container.querySelector<HTMLElement>(".kwic-pagination")!;
  const exportBtn = container.querySelector<HTMLButtonElement>("#kwic-export-btn");

  const display = getDisplayHits();
  const pageCount = Math.ceil(display.length / PAGE_SIZE);
  _page = Math.min(_page, Math.max(0, pageCount - 1));
  const slice = display.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

  if (exportBtn) exportBtn.disabled = display.length === 0;

  if (display.length === 0) {
    const q = container.querySelector<HTMLInputElement>("#kwic-input")?.value?.trim() ?? "";
    const hint =
      q.length > 0
        ? `<div class="kwic-empty-hint" style="font-size:0.78rem;color:var(--text-muted);max-width:30rem;margin-top:10px;line-height:1.5;text-align:center">
            <strong>Aucun segment ne correspond</strong> à cette requête avec les filtres actuels.
            <span style="display:block;margin-top:8px">Le concordancier ne lit que le <strong>texte segmenté</strong> indexé en base (pas le brut ni un document non découpé).</span>
            <span style="display:block;margin-top:6px">Pistes : assouplir épisode / locuteur / type, ou chercher un mot vraiment présent dans les segments.</span>
          </div>
          <div class="kwic-empty-qa" id="kwic-empty-qa" aria-live="polite"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="kwic-goto-const" style="margin-top:12px">Ouvrir Préparer (segmentation)…</button>`
        : "";
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:1.8rem">🔍</span><span>Aucun résultat.</span>${hint}</div>`;
    wrap.querySelector("#kwic-goto-const")?.addEventListener("click", () => {
      _shellCtx?.navigateTo("constituer");
    });
    if (q.length > 0) attachKwicEmptyQaLine(wrap);
    pag.classList.remove("visible");
    updateResultsToolbar(container);
    return;
  }

  const base = _page * PAGE_SIZE;
  const rows = slice.map((h, i) => {
    const badges: string[] = [];
    if (h.speaker) badges.push(`<span class="kwic-speaker-badge" title="${escapeHtml(h.speaker)}">${escapeHtml(h.speaker.slice(0, 14))}</span>`);
    if (h.kind)    badges.push(`<span class="kwic-kind-badge">${h.kind === "utterance" ? "tour" : "phrase"}</span>`);
    if (h.lang)    badges.push(`<span class="kwic-lang-badge">${escapeHtml(h.lang)}</span>`);
    const citation = `${h.left}${h.match}${h.right}`.replace(/\n/g, " ");
    const origIdx = _hits.indexOf(h);
    const gidx = origIdx >= 0 ? origIdx : base + i;
    return `
      <tr>
        <td class="kwic-col-ep">
          <span class="kwic-ep-id">${escapeHtml(h.episode_id)}</span>
          <span class="kwic-ep-title" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
        </td>
        <td class="kwic-col-left">${escapeHtml(h.left)}</td>
        <td class="kwic-col-match"><span class="kwic-match-pill">${escapeHtml(h.match)}</span></td>
        <td class="kwic-col-right">${escapeHtml(h.right)}</td>
        <td class="kwic-col-meta"><div class="kwic-meta-badges">${badges.join("")}</div><button type="button" class="kwic-meta-btn" data-kwic-idx="${gidx}" title="Épisode / source">ℹ</button></td>
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
      }).catch(() => { /* permission refusée ou API non disponible */ });
    });
  });

  const root = container.querySelector<HTMLElement>(".kwic-root");
  if (root) wireKwicMetaButtons(root);

  if (pageCount <= 1) {
    pag.classList.remove("visible");
  } else {
    pag.classList.add("visible");
    pag.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="kwic-prev" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>Page ${_page + 1} / ${pageCount} &nbsp;(${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, display.length)})</span>
      <span class="kwic-pag-gap"></span>
      <button class="btn btn-ghost btn-sm" id="kwic-next" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>`;
    pag.querySelector("#kwic-prev")?.addEventListener("click", () => { _page--; renderTableResults(container); });
    pag.querySelector("#kwic-next")?.addEventListener("click", () => { _page++; renderTableResults(container); });
  }
  updateResultsToolbar(container);
}

function renderAlignedCards(container: HTMLElement) {
  const wrap = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
  const pag  = container.querySelector<HTMLElement>(".kwic-pagination")!;
  const exportBtn = container.querySelector<HTMLButtonElement>("#kwic-export-btn");

  const display = getDisplayHits();
  if (exportBtn) exportBtn.disabled = display.length === 0;
  pag.classList.remove("visible");

  if (display.length === 0) {
    const q = container.querySelector<HTMLInputElement>("#kwic-input")?.value?.trim() ?? "";
    const extra =
      q.length > 0
        ? `<div class="kwic-empty-hint" style="font-size:0.78rem;color:var(--text-muted);max-width:30rem;margin-top:10px;line-height:1.5;text-align:center">
            <strong>Aucun segment ne correspond</strong> — même aide qu’en vue tableau (filtres, texte segmenté uniquement).
          </div>
          <div class="kwic-empty-qa" id="kwic-empty-qa" aria-live="polite"></div>
          <button type="button" class="btn btn-secondary btn-sm" id="kwic-goto-const" style="margin-top:12px">Ouvrir Préparer (segmentation)…</button>`
        : "";
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:1.8rem">🔍</span><span>Aucun résultat.</span>${extra}</div>`;
    wrap.querySelector("#kwic-goto-const")?.addEventListener("click", () => {
      _shellCtx?.navigateTo("constituer");
    });
    if (q.length > 0) attachKwicEmptyQaLine(wrap);
    updateResultsToolbar(container);
    return;
  }

  const pageCount = Math.ceil(display.length / PAGE_SIZE);
  _page = Math.min(_page, Math.max(0, pageCount - 1));
  const slice = display.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);
  const base = _page * PAGE_SIZE;

  function cardHtml(h: KwicHit, globalIdx: number): string {
    const badges: string[] = [];
    if (h.speaker) badges.push(`<span class="kwic-speaker-badge" title="${escapeHtml(h.speaker)}">${escapeHtml(h.speaker.slice(0, 18))}</span>`);
    if (h.kind)    badges.push(`<span class="kwic-kind-badge">${h.kind === "utterance" ? "tour" : "phrase"}</span>`);
    if (h.lang)    badges.push(`<span class="kwic-lang-badge">${escapeHtml(h.lang)}</span>`);
    const citation = `${h.left}${h.match}${h.right}`.replace(/\n/g, " ");
    const oi = _hits.indexOf(h);
    const idxMeta = oi >= 0 ? oi : globalIdx;
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
          <button type="button" class="kwic-meta-btn" data-kwic-idx="${idxMeta}" title="Épisode / source">ℹ</button>
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
      html += g.hits.map((h) => cardHtml(h, base + slice.indexOf(h))).join("");
    }
  } else {
    html += slice.map((h, i) => cardHtml(h, base + i)).join("");
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
      }).catch(() => { /* permission refusée ou API non disponible */ });
    });
  });

  const rootAligned = container.querySelector<HTMLElement>(".kwic-root");
  if (rootAligned) wireKwicMetaButtons(rootAligned);

  if (pageCount > 1) {
    pag.classList.add("visible");
    pag.innerHTML = `
      <button class="btn btn-ghost btn-sm" id="kwic-prev" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>Page ${_page + 1} / ${pageCount} &nbsp;(${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, display.length)})</span>
      <span class="kwic-pag-gap"></span>
      <button class="btn btn-ghost btn-sm" id="kwic-next" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>`;
    pag.querySelector("#kwic-prev")?.addEventListener("click", () => { _page--; renderAlignedCards(container); });
    pag.querySelector("#kwic-next")?.addEventListener("click", () => { _page++; renderAlignedCards(container); });
  }
  updateResultsToolbar(container);
}

// ── Chips ────────────────────────────────────────────────────────────────────

function updateChips(container: HTMLElement) {
  const bar = container.querySelector<HTMLElement>("#kwic-chips-bar");
  if (!bar) return;

  const kind = (container.querySelector<HTMLSelectElement>("#kwic-kind")?.value ?? "");
  const ep   = (container.querySelector<HTMLInputElement>("#kwic-episode-id")?.value.trim() ?? "");
  const sp   = (container.querySelector<HTMLInputElement>("#kwic-speaker")?.value.trim() ?? "");

  const chips: string[] = [];
  if (kind) chips.push(`<span class="kwic-chip">Type : ${escapeHtml(kind)} <button class="kwic-chip-rm" data-clear="kind">✕</button></span>`);
  if (ep)   chips.push(`<span class="kwic-chip">Épisode : ${escapeHtml(ep)} <button class="kwic-chip-rm" data-clear="ep">✕</button></span>`);
  if (sp)   chips.push(`<span class="kwic-chip">Locuteur : ${escapeHtml(sp)} <button class="kwic-chip-rm" data-clear="sp">✕</button></span>`);
  bar.innerHTML = chips.join("");

  bar.querySelectorAll<HTMLButtonElement>(".kwic-chip-rm").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.clear!;
      if (key === "kind") { const el = container.querySelector<HTMLSelectElement>("#kwic-kind");     if (el) el.value = ""; }
      if (key === "ep")   { const el = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (el) el.value = ""; }
      if (key === "sp")   { const el = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (el) el.value = ""; }
      updateChips(container);
    });
  });
}

/** Panneau méta (épisode / source / ids) depuis un hit KWIC — voir `features/metaPanel.ts`. */
function episodeSourceFromKwicHit(h: KwicHit): EpisodeSourceInfo {
  return {
    episode_id: h.episode_id,
    title: h.title,
    source_key: "transcript",
    language: h.lang ?? undefined,
    segment_id: h.segment_id,
    cue_id: h.cue_id,
  };
}

function wireKwicMetaButtons(container: HTMLElement) {
  container.querySelectorAll<HTMLButtonElement>(".kwic-meta-btn[data-kwic-idx]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.kwicIdx);
      const h = _hits[idx];
      if (h) openMetaPanel(episodeSourceFromKwicHit(h));
    });
  });
}

// ── Mount ────────────────────────────────────────────────────────────────────

export function mountConcordancier(container: HTMLElement, ctx: ShellContext) {
  _shellCtx = ctx;
  _projectPrefix = ctx.getProjectId();
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  _hits                = [];
  _page                = 0;
  _hasMore             = false;
  _facets              = null;
  _filterOpen          = false;
  _histOpen            = false;
  _expOpen             = false;
  _builderOpen         = false;
  _helpOpen            = false;
  _builderMode         = "simple";
  _nearN               = 5;
  _showAligned         = false;
  _showParallel        = false;
  _caseSensitive       = false;
  _statsMode           = false;
  _statsResults        = null;
  _statsCompareMode    = false;
  _statsCompareResults = null;

  container.innerHTML = `
    <div class="kwic-root">

      <!-- Toolbar -->
      <div class="kwic-toolbar">
        <div class="kwic-search-row">
          <input class="kwic-search-input" id="kwic-input" type="search"
            placeholder="Rechercher dans les segments (FTS5)… — / focus" autocomplete="off" spellcheck="false">
          <button class="btn btn-primary btn-sm kwic-search-btn" id="kwic-search-btn">Rechercher</button>
          <div class="kwic-scope-hint" title="Seuls les segments en base (après job de segmentation) sont indexés ici.">
            <span class="kwic-scope-badge">Segments</span>
            <span class="kwic-scope-sub">Index FTS — pas de brut ni SRT seuls</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="kwic-reindex-btn"
            title="Reconstruit l’index plein texte (segments_fts) à partir de la table segments. À utiliser si le concordancier ne trouve rien alors que des segments existent.">
            Réindexer FTS
          </button>
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
                  <div class="kwic-help-note" style="margin-top:10px">Ce concordancier interroge <strong>uniquement les segments</strong> (texte découpé et indexé). Pour du texte non segmenté, lancez d’abord la segmentation dans « Préparer ».</div>
                  <div class="kwic-help-note" style="margin-top:6px">Si des segments existent mais la recherche ne renvoie rien, utilisez <strong>Réindexer FTS</strong> (reconstruit <code>segments_fts</code> depuis la table <code>segments</code>).</div>
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
          <button class="kwic-toolbar-btn kwic-stats-toggle" id="kwic-stats-btn" title="Statistiques lexicales — fréquences, vocabulaire, comparaison de corpus">📊 Stats</button>
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

      <!-- Tri / compact / limite (proximité AGRAFES : contrôle de la liste) -->
      <div class="kwic-results-toolbar hidden" id="kwic-results-toolbar">
        <div class="kwic-results-left">
          <span class="kwic-results-label">Tri</span>
          <select class="kwic-results-select" id="kwic-sort" title="Ordre des lignes (côté client)">
            <option value="relevance">Ordre serveur</option>
            <option value="ep_asc">Épisode A → Z</option>
            <option value="ep_desc">Épisode Z → A</option>
            <option value="position">Position (caractère)</option>
          </select>
          <button type="button" class="kwic-toolbar-btn kwic-compact-toggle" id="kwic-compact-btn" title="Affichage compact (plus de lignes visibles)">▤ Compact</button>
        </div>
        <div class="kwic-results-right">
          <span class="kwic-results-count" id="kwic-results-count"></span>
          <button type="button" class="btn btn-secondary btn-sm" id="kwic-load-more" style="display:none">Charger plus (max ${QUERY_LIMIT_MAX})</button>
        </div>
      </div>

      <!-- Error -->
      <div class="kwic-error" id="kwic-error"></div>
      <div class="kwic-feedback" id="kwic-feedback" role="status" aria-live="polite"></div>

      <!-- Results -->
      <div class="kwic-table-wrap">
        <div class="kwic-empty">
          <span style="font-size:2.2rem">🔍</span>
          <span>Entrez un terme et lancez la recherche.</span>
          <div class="kwic-empty-hint" style="font-size:0.78rem;color:var(--text-muted);max-width:26rem;margin-top:8px;line-height:1.45;text-align:center">Uniquement les <strong>segments</strong> déjà présents en base (après segmentation). Sinon le corpus reste vide ici.</div>
        </div>
      </div>

      <!-- Pagination -->
      <div class="kwic-pagination"></div>

      <!-- Stats panel -->
      <div class="kwic-stats-panel hidden" id="kwic-stats-panel">
        <div class="kwic-stats-filter-block" id="kwic-stats-filter-a">
          <div class="kwic-stats-filter-hd">
            <span class="kwic-stats-badge kwic-stats-badge-a" id="kwic-stats-badge-a" style="display:none">A</span>
            <span class="kwic-stats-section-title">Filtres du corpus</span>
          </div>
          <div class="kwic-stats-filters">
            <div class="kwic-stats-filter-group">
              <label>Épisode</label>
              <input id="kwic-stats-ep-a" placeholder="Tout le corpus" list="kwic-stats-datalist-a" autocomplete="off">
              <datalist id="kwic-stats-datalist-a"></datalist>
            </div>
            <div class="kwic-stats-filter-group">
              <label>Type</label>
              <select id="kwic-stats-kind-a">
                <option value="">Tous</option>
                <option value="utterance">Tours de parole</option>
                <option value="sentence">Phrases</option>
              </select>
            </div>
            <div class="kwic-stats-filter-group">
              <label>Locuteur</label>
              <input id="kwic-stats-speaker-a" placeholder="Tous">
            </div>
            <div class="kwic-stats-filter-group">
              <label>Top N mots</label>
              <input type="number" id="kwic-stats-topn" min="10" max="200" value="50" style="min-width:0;width:70px">
            </div>
            <button class="btn btn-primary btn-sm" id="kwic-stats-run-btn">Analyser</button>
            <button class="kwic-toolbar-btn" id="kwic-stats-compare-btn" title="Comparer deux sous-corpus côte à côte">⇄ Comparer</button>
          </div>
        </div>

        <div class="kwic-stats-filter-block kwic-stats-filter-block-b hidden" id="kwic-stats-filter-b">
          <div class="kwic-stats-filter-hd">
            <span class="kwic-stats-badge kwic-stats-badge-b">B</span>
            <span class="kwic-stats-section-title">Corpus B</span>
          </div>
          <div class="kwic-stats-filters">
            <div class="kwic-stats-filter-group">
              <label>Épisode</label>
              <input id="kwic-stats-ep-b" placeholder="Tout le corpus" list="kwic-stats-datalist-b" autocomplete="off">
              <datalist id="kwic-stats-datalist-b"></datalist>
            </div>
            <div class="kwic-stats-filter-group">
              <label>Type</label>
              <select id="kwic-stats-kind-b">
                <option value="">Tous</option>
                <option value="utterance">Tours de parole</option>
                <option value="sentence">Phrases</option>
              </select>
            </div>
            <div class="kwic-stats-filter-group">
              <label>Locuteur</label>
              <input id="kwic-stats-speaker-b" placeholder="Tous">
            </div>
          </div>
        </div>

        <div id="kwic-stats-results"></div>
      </div>
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
  const rootKwic       = container.querySelector<HTMLElement>(".kwic-root")!;
  const sortSel        = container.querySelector<HTMLSelectElement>("#kwic-sort")!;
  const compactBtn     = container.querySelector<HTMLButtonElement>("#kwic-compact-btn")!;
  const loadMoreBtn    = container.querySelector<HTMLButtonElement>("#kwic-load-more")!;
  const feedbackEl     = container.querySelector<HTMLElement>("#kwic-feedback")!;
  const reindexBtn     = container.querySelector<HTMLButtonElement>("#kwic-reindex-btn")!;

  function hideFeedback() {
    feedbackEl.classList.remove("visible", "success", "err");
    feedbackEl.textContent = "";
  }

  _sortMode = readSortMode();
  _compactView = localStorage.getItem(lsKey(COMPACT_LS_KEY)) === "1";
  sortSel.value = _sortMode;
  compactBtn.classList.toggle("active", _compactView);
  rootKwic.classList.toggle("kwic-compact", _compactView);

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
    if (_filterOpen) {
      _filterOpen = false;
      filterDrawer.classList.add("hidden");
      filterBtn.classList.remove("active");
    }
  }

  // ── Window slider ───────────────────────────────────────────────────────────
  windowRange.addEventListener("input", () => { windowVal.textContent = windowRange.value; });

  reindexBtn.addEventListener("click", () => {
    hideFeedback();
    errEl.style.display = "none";
    reindexBtn.disabled = true;
    reindexBtn.textContent = "…";
    const myMountId = _concordancierMountId;
    void withNoDbRecovery(() => rebuildSegmentsFts())
      .then((r) => {
        if (_concordancierMountId !== myMountId) return;
        feedbackEl.textContent =
          `Index segments FTS reconstruit — ${r.segments_rows} segment(s) en base, ${r.segments_fts_rows} ligne(s) dans l’index. Vous pouvez relancer une recherche.`;
        feedbackEl.className = "kwic-feedback visible success";
      })
      .catch((e) => {
        if (_concordancierMountId !== myMountId) return;
        const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
        feedbackEl.textContent = msg;
        feedbackEl.className = "kwic-feedback visible err";
      })
      .finally(() => {
        if (_concordancierMountId !== myMountId) return;
        reindexBtn.disabled = false;
        reindexBtn.textContent = "Réindexer FTS";
      });
  });

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
    (container.querySelector<HTMLInputElement>("#kwic-episode-id")!).value = "";
    (container.querySelector<HTMLInputElement>("#kwic-speaker")!).value = "";
    updateChips(container);
  });
  ["#kwic-kind", "#kwic-episode-id", "#kwic-speaker"].forEach((sel) => {
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
        <span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.term.slice(0, 36))}</span>
       </button>`
    ).join("") +
      `<div class="kwic-dd-sep"></div>
       <button class="kwic-dd-item muted" id="kwic-hist-clear">Effacer l'historique</button>`;

    histMenu.querySelectorAll<HTMLButtonElement>("[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = hist[Number(btn.dataset.idx)];
        input.value = entry.term;
        const kEl = container.querySelector<HTMLSelectElement>("#kwic-kind");     if (kEl) kEl.value = entry.kind;
        const eEl = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (eEl) eEl.value = entry.episode_id;
        const sEl = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (sEl) sEl.value = entry.speaker;
        updateChips(container);
        updateFtsPreview();
        closeAllPanels();
        runSearch();
      });
    });
    histMenu.querySelector<HTMLButtonElement>("#kwic-hist-clear")?.addEventListener("click", () => {
      localStorage.removeItem(lsKey(HIST_KEY));
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

  sortSel.addEventListener("change", () => {
    _sortMode = sortSel.value as SortMode;
    localStorage.setItem(lsKey(SORT_LS_KEY), _sortMode);
    _page = 0;
    if (_hits.length) renderResults(container);
  });

  compactBtn.addEventListener("click", () => {
    _compactView = !_compactView;
    localStorage.setItem(lsKey(COMPACT_LS_KEY), _compactView ? "1" : "0");
    compactBtn.classList.toggle("active", _compactView);
    rootKwic.classList.toggle("kwic-compact", _compactView);
  });

  loadMoreBtn.addEventListener("click", () => void runSearch({ append: true, skipHistory: true }));

  // ── Reset button ────────────────────────────────────────────────────────────
  resetBtn.addEventListener("click", () => {
    // Sortir du mode Stats si actif
    if (_statsMode) _toggleStatsMode(false);
    _statsResults        = null;
    _statsCompareResults = null;
    _statsCompareMode    = false;
    container.querySelector<HTMLElement>("#kwic-stats-results")?.replaceChildren();
    container.querySelector<HTMLElement>("#kwic-stats-filter-b")?.classList.add("hidden");
    container.querySelector<HTMLElement>("#kwic-stats-badge-a")?.style.setProperty("display", "none");
    const cmpBtn = container.querySelector<HTMLButtonElement>("#kwic-stats-compare-btn");
    if (cmpBtn) { cmpBtn.textContent = "⇄ Comparer"; cmpBtn.classList.remove("active"); }

    input.value = "";
    _hits        = [];
    _page        = 0;
    _hasMore     = false;
    _sortMode = "relevance";
    localStorage.removeItem(lsKey(SORT_LS_KEY));
    sortSel.value = "relevance";
    _compactView = false;
    localStorage.removeItem(lsKey(COMPACT_LS_KEY));
    compactBtn.classList.remove("active");
    rootKwic.classList.remove("kwic-compact");
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
    const eEl = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (eEl) eEl.value = "";
    const sEl = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (sEl) sEl.value = "";
    updateChips(container);
    container.querySelector<HTMLElement>("#kwic-analytics")!.classList.add("hidden");
    container.querySelector<HTMLElement>("#kwic-results-toolbar")?.classList.add("hidden");
    errEl.style.display = "none";
    hideFeedback();
    const wrap = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:2.2rem">🔍</span><span>Entrez un terme et lancez la recherche.</span><div class="kwic-empty-hint" style="font-size:0.78rem;color:var(--text-muted);max-width:26rem;margin-top:8px;line-height:1.45;text-align:center">Uniquement les <strong>segments</strong> déjà présents en base (après segmentation).</div></div>`;
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
      term, scope: KWIC_SCOPE,
      total_hits: _hits.length,
      distinct_episodes: Object.keys(epMap).length,
      distinct_langs: langs.size,
      top_episodes: Object.entries(epMap)
        .map(([id, v]) => ({ episode_id: id, title: v.title, count: v.count }))
        .sort((a, b) => b.count - a.count).slice(0, 8),
    };
  }

  // ── Search ──────────────────────────────────────────────────────────────────
  async function runSearch(opts?: { limit?: number; skipHistory?: boolean; append?: boolean }) {
    const raw = input.value.trim();
    if (!raw) return;

    const term = buildFtsQuery(raw, _builderMode, _nearN);
    updateFtsPreview();

    searchBtn.disabled = true;
    searchBtn.textContent = "…";
    errEl.style.display = "none";
    hideFeedback();
    container.querySelector<HTMLElement>("#kwic-analytics")!.classList.add("hidden");

    const append = opts?.append ?? false;
    let reqLimit: number;
    let reqOffset: number;
    if (append) {
      reqOffset = _hits.length;
      reqLimit = Math.min(QUERY_CHUNK, Math.max(0, QUERY_LIMIT_MAX - reqOffset));
      if (reqLimit <= 0) {
        searchBtn.disabled = false;
        searchBtn.textContent = "Rechercher";
        return;
      }
    } else {
      reqOffset = 0;
      reqLimit = Math.min(QUERY_LIMIT_MAX, opts?.limit ?? QUERY_LIMIT_INITIAL);
    }

    const req: QueryRequest = {
      term, scope: KWIC_SCOPE,
      kind:           container.querySelector<HTMLSelectElement>("#kwic-kind")!.value || null,
      lang:           null,
      episode_id:     container.querySelector<HTMLInputElement>("#kwic-episode-id")!.value.trim() || null,
      speaker:        container.querySelector<HTMLInputElement>("#kwic-speaker")!.value.trim() || null,
      window:         Number(windowRange.value),
      limit:          reqLimit,
      offset:         reqOffset,
      case_sensitive: _caseSensitive || undefined,
    };

    const myToken = ++_searchToken;

    try {
      const res = await withNoDbRecovery(() => apiPost<QueryResponse>("/query", req));
      if (_searchToken !== myToken) return;
      if (append) {
        _hits = [..._hits, ...res.hits];
      } else {
        _hits    = res.hits;
        _page    = 0;
      }
      _hasMore = res.has_more ?? false;

      if (!opts?.skipHistory) {
        saveHistory({ term: raw, scope: KWIC_SCOPE, kind: req.kind ?? "", lang: "",
          episode_id: req.episode_id ?? "", speaker: req.speaker ?? "", ts: Date.now() });
      }

      renderResults(container);
      updateChips(container);

      // Facettes : première requête uniquement (append = même requête, pas de nouvel agrégat)
      if (!append) {
        _facets = null;
        withNoDbRecovery(() =>
          apiPost<FacetsResponse>("/query/facets", {
            term, scope: KWIC_SCOPE, kind: req.kind, lang: req.lang,
            episode_id: req.episode_id, speaker: req.speaker,
          }),
        ).then((f) => {
          if (_searchToken !== myToken) return;
          _facets = f;
          renderAnalytics(container);
        }).catch(() => {
          if (_searchToken !== myToken) return;
          _facets = buildFacetsFromHits(raw);
          renderAnalytics(container);
        });
      }

    } catch (e) {
      if (_searchToken !== myToken) return; // requête annulée ou nouvelle recherche lancée
      const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
      errEl.textContent = msg;
      errEl.style.display = "block";
    } finally {
      if (_searchToken !== myToken) return; // une nouvelle recherche a pris le relais
      // Ne pas réactiver le bouton si le backend est hors ligne
      // (evite la race avec le handler onStatusChange qui vient de le désactiver)
      if (!_offlineErrShown) searchBtn.disabled = false;
      searchBtn.textContent = "Rechercher";
    }
  }

  searchBtn.addEventListener("click", () => void runSearch());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void runSearch(); });

  // ── Stats ──────────────────────────────────────────────────────────────────
  const statsBtn   = container.querySelector<HTMLButtonElement>("#kwic-stats-btn")!;
  const statsPanel = container.querySelector<HTMLElement>("#kwic-stats-panel")!;

  const _statsHideSelectors = [
    "#kwic-fts-preview", "#kwic-chips-bar", "#kwic-analytics",
    "#kwic-results-toolbar", "#kwic-error", "#kwic-feedback",
    ".kwic-table-wrap", ".kwic-pagination",
  ];

  function _toggleStatsMode(active: boolean) {
    _statsMode = active;
    statsBtn.classList.toggle("active", active);
    statsPanel.classList.toggle("hidden", !active);
    for (const sel of _statsHideSelectors) {
      const el = container.querySelector<HTMLElement>(sel);
      if (!el) continue;
      if (active) {
        // Sauvegarder l'état display actuel avant de cacher
        el.dataset.kwicPrevDisplay = el.style.display;
        el.style.display = "none";
      } else {
        // Restaurer l'état exact (pas juste ""), évite de rendre visibles
        // des éléments contrôlés uniquement par inline-style (ex: #kwic-error)
        el.style.display = el.dataset.kwicPrevDisplay ?? "";
        delete el.dataset.kwicPrevDisplay;
      }
    }
  }

  let _statsEpsLoaded = false;
  async function _populateStatsEpDatalists() {
    if (_statsEpsLoaded) return;
    try {
      const data = await apiGet<{ episodes: { episode_id: string; title: string }[] }>("/episodes");
      const opts = data.episodes
        .map((ep) => `<option value="${escapeHtml(ep.episode_id)}" label="${escapeHtml(ep.title)}">`)
        .join("");
      const dlA = container.querySelector<HTMLDataListElement>("#kwic-stats-datalist-a");
      const dlB = container.querySelector<HTMLDataListElement>("#kwic-stats-datalist-b");
      if (dlA) dlA.innerHTML = opts;
      if (dlB) dlB.innerHTML = opts;
      _statsEpsLoaded = true;
    } catch (e) {
      // Datalists non critiques : on signale l'erreur dans les deux datalists (A et B)
      const errMsg = `(chargement épisodes impossible : ${e instanceof Error ? e.message : String(e)})`;
      for (const sel of ["#kwic-stats-datalist-a", "#kwic-stats-datalist-b"]) {
        const dl = container.querySelector<HTMLDataListElement>(sel);
        if (dl) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.label = errMsg;
          dl.appendChild(opt);
        }
      }
    }
  }

  statsBtn.addEventListener("click", () => {
    _toggleStatsMode(!_statsMode);
    if (_statsMode) void _populateStatsEpDatalists();
  });

  container.querySelector<HTMLButtonElement>("#kwic-stats-compare-btn")!.addEventListener("click", (e) => {
    _statsCompareMode = !_statsCompareMode;
    container.querySelector<HTMLElement>("#kwic-stats-filter-b")!.classList.toggle("hidden", !_statsCompareMode);
    container.querySelector<HTMLElement>("#kwic-stats-badge-a")!.style.display = _statsCompareMode ? "" : "none";
    const btn = e.currentTarget as HTMLButtonElement;
    btn.textContent = _statsCompareMode ? "✕ Comparaison" : "⇄ Comparer";
    btn.classList.toggle("active", _statsCompareMode);
    _statsCompareResults = null;
    container.querySelector<HTMLElement>("#kwic-stats-results")!.innerHTML = "";
  });

  container.querySelector<HTMLButtonElement>("#kwic-stats-run-btn")!.addEventListener("click", () => void runStats(container));

  _kbdHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeAllPanels();
    }
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target as HTMLElement;
      if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA" && !t.isContentEditable) {
        e.preventDefault();
        input.focus();
      }
    }
  };
  document.addEventListener("keydown", _kbdHandler);

  // État initial : désactiver la recherche si le backend est déjà hors ligne au montage
  let _offlineErrShown = false;
  if (!ctx.getBackendStatus().online) {
    searchBtn.disabled = true;
    errEl.textContent = "Backend HIMYC hors ligne — les recherches sont indisponibles.";
    errEl.style.display = "block";
    _offlineErrShown = true;
  }

  _unsubscribe = ctx.onStatusChange((s) => {
    if (!s.online) {
      searchBtn.disabled = true;
      errEl.textContent = "Backend HIMYC hors ligne — les recherches sont indisponibles.";
      errEl.style.display = "block";
      _offlineErrShown = true;
    } else if (_offlineErrShown) {
      searchBtn.disabled = false;
      errEl.style.display = "none";
      _offlineErrShown = false;
    }
    // Si online et pas de bannière offline : ne pas toucher searchBtn
    // (il peut être désactivé le temps d'une recherche en cours)
  });
}

// ── Dispose ───────────────────────────────────────────────────────────────────

export function disposeConcordancier() {
  _shellCtx = null;
  _projectPrefix       = "";
  if (_unsubscribe)       { _unsubscribe(); _unsubscribe = null; }
  if (_closeDropdownsRef) { document.removeEventListener("click", _closeDropdownsRef); _closeDropdownsRef = null; }
  if (_kbdHandler)       { document.removeEventListener("keydown", _kbdHandler); _kbdHandler = null; }
  _searchToken++;
  _statsToken++;
  _concordancierMountId++;
  _hits                = [];
  _page                = 0;
  _hasMore             = false;
  _facets              = null;
  _filterOpen          = false;
  _histOpen            = false;
  _expOpen             = false;
  _builderOpen         = false;
  _helpOpen            = false;
  _showAligned         = false;
  _showParallel        = false;
  _builderMode         = "simple";
  _nearN               = 5;
  _caseSensitive       = false;
  _sortMode            = "relevance";
  _compactView         = false;
  _statsMode           = false;
  _statsResults        = null;
  _statsCompareMode    = false;
  _statsCompareResults = null;
}
