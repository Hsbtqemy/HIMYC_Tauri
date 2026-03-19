/**
 * concordancierModule.ts — Concordancier KWIC (MX-022/MX-023)
 *
 * Recherche full-text sur segments / cues / documents avec affichage KWIC.
 * Filtres : scope · kind · lang · episode_id · speaker.
 * Pagination client-side · export CSV.
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { API_BASE, ApiError } from "../api";

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
  hits: KwicHit[];
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
.kwic-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Barre de recherche */
.kwic-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.kwic-search-input {
  flex: 1;
  min-width: 200px;
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
  padding: 6px 16px;
  white-space: nowrap;
}

/* Filtres */
.kwic-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface2);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.kwic-filter-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.kwic-filter-group label {
  font-size: 0.73rem;
  color: var(--text-muted);
  font-weight: 600;
  white-space: nowrap;
}
.kwic-filter-select, .kwic-filter-input {
  font-size: 0.78rem;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
}
.kwic-filter-input { width: 130px; }

/* Barre résultats */
.kwic-results-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.kwic-results-bar .kwic-total { font-weight: 600; color: var(--text); }
.kwic-results-bar-gap { flex: 1; }

/* Table KWIC */
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
  border-bottom: 1px solid var(--border);
  padding: 5px 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: left;
  z-index: 1;
}
.kwic-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kwic-table tr:hover td { background: var(--surface2); }

/* Colonnes fixes */
.kwic-col-ep    { width: 90px; }
.kwic-col-left  { width: 28%; text-align: right; color: var(--text-muted); direction: ltr; }
.kwic-col-match { width: 16%; text-align: center; }
.kwic-col-right { width: 28%; color: var(--text-muted); }
.kwic-col-meta  { width: 100px; }

.kwic-match-pill {
  display: inline-block;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  font-weight: 700;
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 0.83rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kwic-ep-badge {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.kwic-speaker-badge {
  font-size: 0.7rem;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 4px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
  display: inline-block;
}
.kwic-lang-badge {
  font-size: 0.68rem;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--accent);
  opacity: 0.8;
}

/* Pagination */
.kwic-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.kwic-pag-gap { flex: 1; }

/* Error */
.kwic-error {
  margin: 8px 16px;
  padding: 8px 12px;
  background: color-mix(in srgb, #dc2626 10%, transparent);
  border: 1px solid #dc2626;
  border-radius: var(--radius);
  color: #dc2626;
  font-size: 0.82rem;
  display: none;
}
`;

// ── State ────────────────────────────────────────────────────────────────────

let _styleInjected = false;
let _hits: KwicHit[] = [];
let _page = 0;
const PAGE_SIZE = 50;

// ── API ──────────────────────────────────────────────────────────────────────

async function queryCorpus(req: QueryRequest): Promise<QueryResponse> {
  const res = await fetch(`${API_BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      err?.detail?.error ?? "QUERY_ERROR",
      err?.detail?.message ?? `HTTP ${res.status}`,
    );
  }
  return res.json();
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderResults(container: HTMLElement) {
  const wrap  = container.querySelector<HTMLElement>(".kwic-table-wrap")!;
  const total = container.querySelector<HTMLElement>(".kwic-total")!;
  const pag   = container.querySelector<HTMLElement>(".kwic-pagination")!;

  const pageCount = Math.ceil(_hits.length / PAGE_SIZE);
  _page = Math.min(_page, Math.max(0, pageCount - 1));
  const slice = _hits.slice(_page * PAGE_SIZE, (_page + 1) * PAGE_SIZE);

  total.textContent = `${_hits.length} résultat${_hits.length !== 1 ? "s" : ""}`;

  if (_hits.length === 0) {
    wrap.innerHTML = `<div class="kwic-empty"><span style="font-size:1.5rem">🔍</span><span>Aucun résultat.</span></div>`;
    pag.style.display = "none";
    return;
  }

  const rows = slice.map((h) => {
    const meta = h.speaker
      ? `<span class="kwic-speaker-badge" title="${escapeHtml(h.speaker)}">${escapeHtml(h.speaker)}</span>`
      : h.lang
        ? `<span class="kwic-lang-badge">${escapeHtml(h.lang)}</span>`
        : "";
    return `
      <tr>
        <td class="kwic-col-ep">
          <div class="kwic-ep-badge">${escapeHtml(h.episode_id)}</div>
        </td>
        <td class="kwic-col-left">${escapeHtml(h.left)}</td>
        <td class="kwic-col-match"><span class="kwic-match-pill">${escapeHtml(h.match)}</span></td>
        <td class="kwic-col-right">${escapeHtml(h.right)}</td>
        <td class="kwic-col-meta">${meta}</td>
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
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Pagination
  if (pageCount <= 1) {
    pag.style.display = "none";
  } else {
    pag.style.display = "flex";
    pag.innerHTML = `
      <button class="btn btn-ghost" id="kwic-prev" style="font-size:11px;padding:2px 8px" ${_page === 0 ? "disabled" : ""}>‹ Préc.</button>
      <span>Page ${_page + 1} / ${pageCount} (${_page * PAGE_SIZE + 1}–${Math.min((_page + 1) * PAGE_SIZE, _hits.length)})</span>
      <span class="kwic-pag-gap"></span>
      <button class="btn btn-ghost" id="kwic-next" style="font-size:11px;padding:2px 8px" ${_page >= pageCount - 1 ? "disabled" : ""}>Suiv. ›</button>`;
    pag.querySelector("#kwic-prev")?.addEventListener("click", () => { _page--; renderResults(container); });
    pag.querySelector("#kwic-next")?.addEventListener("click", () => { _page++; renderResults(container); });
  }
}

function exportCsv() {
  if (_hits.length === 0) return;
  const header = "episode_id,title,left,match,right,speaker,lang,kind\n";
  const rows = _hits.map((h) =>
    [h.episode_id, h.title, h.left, h.match, h.right, h.speaker ?? "", h.lang ?? "", h.kind ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  ).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `concordance_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Mount ────────────────────────────────────────────────────────────────────

let _unsubscribe: (() => void) | null = null;

export function mountConcordancier(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  _hits = [];
  _page = 0;

  container.innerHTML = `
    <div class="kwic-root">
      <!-- Barre de recherche -->
      <div class="kwic-search-bar">
        <input class="kwic-search-input" id="kwic-input" type="search"
          placeholder="Rechercher dans le corpus…" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary kwic-search-btn" id="kwic-search-btn">🔍 Rechercher</button>
      </div>

      <!-- Filtres -->
      <div class="kwic-filters">
        <div class="kwic-filter-group">
          <label>Portée</label>
          <select class="kwic-filter-select" id="kwic-scope">
            <option value="segments">Segments</option>
            <option value="cues">Sous-titres (cues)</option>
            <option value="episodes">Documents</option>
          </select>
        </div>
        <div class="kwic-filter-group" id="kwic-kind-group">
          <label>Type</label>
          <select class="kwic-filter-select" id="kwic-kind">
            <option value="">Tous</option>
            <option value="sentence">Phrases</option>
            <option value="utterance">Tours</option>
          </select>
        </div>
        <div class="kwic-filter-group" id="kwic-lang-group" style="display:none">
          <label>Langue</label>
          <input class="kwic-filter-input" id="kwic-lang" placeholder="en, fr, it…" style="width:80px">
        </div>
        <div class="kwic-filter-group">
          <label>Épisode</label>
          <input class="kwic-filter-input" id="kwic-episode-id" placeholder="S01E01…">
        </div>
        <div class="kwic-filter-group">
          <label>Locuteur</label>
          <input class="kwic-filter-input" id="kwic-speaker" placeholder="Nom…">
        </div>
      </div>

      <!-- Barre résultats -->
      <div class="kwic-results-bar">
        <span class="kwic-total">—</span>
        <span class="kwic-results-bar-gap"></span>
        <button class="btn btn-ghost" id="kwic-export-csv" style="font-size:11px;padding:2px 8px" disabled>⬇ CSV</button>
      </div>

      <div class="kwic-error" id="kwic-error"></div>

      <!-- Table KWIC -->
      <div class="kwic-table-wrap">
        <div class="kwic-empty">
          <span style="font-size:2rem">🔍</span>
          <span>Entrez un terme et lancez la recherche.</span>
        </div>
      </div>

      <!-- Pagination -->
      <div class="kwic-pagination" style="display:none"></div>
    </div>`;

  const input    = container.querySelector<HTMLInputElement>("#kwic-input")!;
  const scopeSel = container.querySelector<HTMLSelectElement>("#kwic-scope")!;
  const kindGroup = container.querySelector<HTMLElement>("#kwic-kind-group")!;
  const langGroup = container.querySelector<HTMLElement>("#kwic-lang-group")!;
  const errEl    = container.querySelector<HTMLElement>("#kwic-error")!;
  const exportBtn = container.querySelector<HTMLButtonElement>("#kwic-export-csv")!;

  // Scope change → toggle filtres
  scopeSel.addEventListener("change", () => {
    const scope = scopeSel.value;
    kindGroup.style.display = scope === "segments" ? "flex" : "none";
    langGroup.style.display = scope === "cues" ? "flex" : "none";
  });

  const runSearch = async () => {
    const term = input.value.trim();
    if (!term) return;

    const searchBtn = container.querySelector<HTMLButtonElement>("#kwic-search-btn")!;
    searchBtn.disabled = true;
    searchBtn.textContent = "…";
    errEl.style.display = "none";
    container.querySelector<HTMLElement>(".kwic-total")!.textContent = "Recherche…";

    try {
      const scope = scopeSel.value as QueryRequest["scope"];
      const req: QueryRequest = {
        term,
        scope,
        kind:       scope === "segments" ? (container.querySelector<HTMLSelectElement>("#kwic-kind")!.value || null) : null,
        lang:       scope === "cues" ? (container.querySelector<HTMLInputElement>("#kwic-lang")!.value.trim() || null) : null,
        episode_id: container.querySelector<HTMLInputElement>("#kwic-episode-id")!.value.trim() || null,
        speaker:    container.querySelector<HTMLInputElement>("#kwic-speaker")!.value.trim() || null,
        window:     60,
        limit:      500,
      };
      const res = await queryCorpus(req);
      _hits = res.hits;
      _page = 0;
      renderResults(container);
      exportBtn.disabled = _hits.length === 0;
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
      errEl.textContent = msg;
      errEl.style.display = "block";
      container.querySelector<HTMLElement>(".kwic-total")!.textContent = "—";
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "🔍 Rechercher";
    }
  };

  container.querySelector<HTMLButtonElement>("#kwic-search-btn")!
    .addEventListener("click", runSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
  exportBtn.addEventListener("click", exportCsv);

  _unsubscribe = ctx.onStatusChange(() => {});
}

export function disposeConcordancier() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _hits = [];
}
