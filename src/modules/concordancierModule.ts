/**
 * concordancierModule.ts — Concordancier KWIC v2 (MX-025)
 *
 * Toolbar AGRAFES-like : mode tabs (Segments / Sous-titres / Documents),
 * window slider, filter drawer, historique localStorage, export multi-format.
 * Analytics : total hits · épisodes · langues · facets chips top-épisodes.
 * Résultats : table KWIC avec copy-row, badges locuteur/langue/type.
 * Pagination client-side avec bannière has_more.
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { apiPost, ApiError } from "../api";

// ── Types ────────────────────────────────────────────────────────────────────

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
let _hits: KwicHit[]          = [];
let _page                     = 0;
let _hasMore                  = false;
let _facets: FacetsResponse | null = null;
let _filterOpen               = false;
let _histOpen                 = false;
let _expOpen                  = false;
let _scope: "segments" | "cues" | "episodes" = "segments";
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

function exportJsonl() {
  if (!_hits.length) return;
  const lines = _hits.map((h) => JSON.stringify(h)).join("\n");
  dlBlob(new Blob([lines], { type: "application/json;charset=utf-8;" }), `kwic_${Date.now()}.jsonl`);
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
    ? `<span class="kwic-has-more-note kwic-analytics-sep">≥${_hits.length} résultats (limite atteinte, affinez la recherche)</span>`
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
          <button class="kwic-copy-btn" data-text="${escapeHtml(citation)}" title="Copier la concordance">⎘</button>
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
    pag.querySelector("#kwic-prev")?.addEventListener("click", () => { _page--; renderResults(container); });
    pag.querySelector("#kwic-next")?.addEventListener("click", () => { _page++; renderResults(container); });
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
      if (key === "kind") { const el = container.querySelector<HTMLSelectElement>("#kwic-kind");    if (el) el.value = ""; }
      if (key === "lang") { const el = container.querySelector<HTMLInputElement>("#kwic-lang");     if (el) el.value = ""; }
      if (key === "ep")   { const el = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (el) el.value = ""; }
      if (key === "sp")   { const el = container.querySelector<HTMLInputElement>("#kwic-speaker");  if (el) el.value = ""; }
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

  _hits     = [];
  _page     = 0;
  _hasMore  = false;
  _facets   = null;
  _filterOpen = false;
  _histOpen   = false;
  _expOpen    = false;
  _scope      = "segments";

  container.innerHTML = `
    <div class="kwic-root">

      <!-- Toolbar -->
      <div class="kwic-toolbar">
        <div class="kwic-search-row">
          <input class="kwic-search-input" id="kwic-input" type="search"
            placeholder="Rechercher dans le corpus…" autocomplete="off" spellcheck="false">
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
          <button class="kwic-toolbar-btn" id="kwic-filter-btn">⚙ Filtres</button>
          <div class="kwic-dd-wrap">
            <button class="kwic-toolbar-btn" id="kwic-hist-btn">⏱ Historique ▾</button>
            <div class="kwic-dd-menu" id="kwic-hist-menu"></div>
          </div>
          <div class="kwic-dd-wrap">
            <button class="kwic-toolbar-btn" id="kwic-export-btn" disabled>⬇ Exporter ▾</button>
            <div class="kwic-dd-menu" id="kwic-export-menu">
              <button class="kwic-dd-item" data-fmt="csv-flat">CSV plat</button>
              <button class="kwic-dd-item" data-fmt="csv-long">CSV long (avec contexte)</button>
              <button class="kwic-dd-item" data-fmt="jsonl">JSONL</button>
            </div>
          </div>
        </div>
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
          <input class="kwic-filter-input" id="kwic-episode-id" placeholder="S01E01…">
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
  const input        = container.querySelector<HTMLInputElement>("#kwic-input")!;
  const searchBtn    = container.querySelector<HTMLButtonElement>("#kwic-search-btn")!;
  const windowRange  = container.querySelector<HTMLInputElement>("#kwic-window")!;
  const windowVal    = container.querySelector<HTMLElement>("#kwic-window-val")!;
  const filterBtn    = container.querySelector<HTMLButtonElement>("#kwic-filter-btn")!;
  const filterDrawer = container.querySelector<HTMLElement>("#kwic-filter-drawer")!;
  const histBtn      = container.querySelector<HTMLButtonElement>("#kwic-hist-btn")!;
  const histMenu     = container.querySelector<HTMLElement>("#kwic-hist-menu")!;
  const exportBtn    = container.querySelector<HTMLButtonElement>("#kwic-export-btn")!;
  const exportMenu   = container.querySelector<HTMLElement>("#kwic-export-menu")!;
  const errEl        = container.querySelector<HTMLElement>("#kwic-error")!;
  const kindGroup    = container.querySelector<HTMLElement>("#kwic-kind-group")!;
  const langGroup    = container.querySelector<HTMLElement>("#kwic-lang-group")!;

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

  // ── Filter drawer ───────────────────────────────────────────────────────────
  filterBtn.addEventListener("click", () => {
    _filterOpen = !_filterOpen;
    filterDrawer.classList.toggle("hidden", !_filterOpen);
    filterBtn.classList.toggle("active", _filterOpen);
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
  const closeDropdowns = () => {
    _histOpen = false; histMenu.classList.remove("open"); histBtn.classList.remove("active");
    _expOpen  = false; exportMenu.classList.remove("open"); exportBtn.classList.remove("active");
  };

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
        // Restore scope
        container.querySelectorAll<HTMLButtonElement>(".kwic-mode-tab").forEach((t) => {
          t.classList.toggle("active", t.dataset.scope === entry.scope);
        });
        _scope = entry.scope as typeof _scope;
        kindGroup.style.display = _scope === "segments" ? "flex" : "none";
        langGroup.style.display = _scope === "cues"     ? "flex" : "none";
        // Restore filters
        const kEl = container.querySelector<HTMLSelectElement>("#kwic-kind");     if (kEl) kEl.value = entry.kind;
        const lEl = container.querySelector<HTMLInputElement>("#kwic-lang");      if (lEl) lEl.value = entry.lang;
        const eEl = container.querySelector<HTMLInputElement>("#kwic-episode-id"); if (eEl) eEl.value = entry.episode_id;
        const sEl = container.querySelector<HTMLInputElement>("#kwic-speaker");   if (sEl) sEl.value = entry.speaker;
        updateChips(container);
        closeDropdowns();
        runSearch();
      });
    });
    histMenu.querySelector<HTMLButtonElement>("#kwic-hist-clear")?.addEventListener("click", () => {
      localStorage.removeItem(HIST_KEY);
      closeDropdowns();
    });
  }

  histBtn.addEventListener("click", () => {
    _histOpen = !_histOpen;
    if (_histOpen) { _expOpen = false; exportMenu.classList.remove("open"); exportBtn.classList.remove("active"); renderHistMenu(); }
    histMenu.classList.toggle("open", _histOpen);
    histBtn.classList.toggle("active", _histOpen);
  });

  // ── Export menu ─────────────────────────────────────────────────────────────
  exportBtn.addEventListener("click", () => {
    _expOpen = !_expOpen;
    if (_expOpen) { _histOpen = false; histMenu.classList.remove("open"); histBtn.classList.remove("active"); }
    exportMenu.classList.toggle("open", _expOpen);
    exportBtn.classList.toggle("active", _expOpen);
  });
  exportMenu.querySelectorAll<HTMLButtonElement>("[data-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fmt = btn.dataset.fmt!;
      if (fmt === "csv-flat") exportCsvFlat();
      else if (fmt === "csv-long") exportCsvLong();
      else if (fmt === "jsonl") exportJsonl();
      closeDropdowns();
    });
  });

  // Close dropdowns on outside click
  _closeDropdownsRef = (e: MouseEvent) => {
    if (!histBtn.contains(e.target as Node) && !histMenu.contains(e.target as Node))   { _histOpen = false; histMenu.classList.remove("open"); histBtn.classList.remove("active"); }
    if (!exportBtn.contains(e.target as Node) && !exportMenu.contains(e.target as Node)) { _expOpen = false; exportMenu.classList.remove("open"); exportBtn.classList.remove("active"); }
  };
  document.addEventListener("click", _closeDropdownsRef);

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
    const term = input.value.trim();
    if (!term) return;

    searchBtn.disabled = true;
    searchBtn.textContent = "…";
    errEl.style.display = "none";
    container.querySelector<HTMLElement>("#kwic-analytics")!.classList.add("hidden");

    const req: QueryRequest = {
      term, scope: _scope,
      kind:       _scope === "segments" ? (container.querySelector<HTMLSelectElement>("#kwic-kind")!.value || null) : null,
      lang:       _scope === "cues"     ? (container.querySelector<HTMLInputElement>("#kwic-lang")!.value.trim() || null) : null,
      episode_id: container.querySelector<HTMLInputElement>("#kwic-episode-id")!.value.trim() || null,
      speaker:    container.querySelector<HTMLInputElement>("#kwic-speaker")!.value.trim() || null,
      window:     Number(windowRange.value),
      limit:      500,
    };

    try {
      const res = await apiPost<QueryResponse>("/query", req);
      _hits    = res.hits;
      _hasMore = res.has_more ?? false;
      _page    = 0;

      saveHistory({ term, scope: _scope, kind: req.kind ?? "", lang: req.lang ?? "",
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
        _facets = buildFacetsFromHits(term);
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
  if (_unsubscribe)        { _unsubscribe(); _unsubscribe = null; }
  if (_closeDropdownsRef)  { document.removeEventListener("click", _closeDropdownsRef); _closeDropdownsRef = null; }
  _hits   = [];
  _facets = null;
}
