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
  importTranscript,
  importSrt,
  fetchJobs,
  createJob,
  cancelJob,
  type Episode,
  type EpisodeSource,
  type EpisodesResponse,
  type JobRecord,
  type JobType,
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
/* ── Section nav ───────────────────────────────────────────── */
.cons-section-nav {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  overflow-x: auto;
}
.cons-section-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0 1.1rem;
  height: 36px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.13s, border-color 0.13s;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.cons-section-tab:hover { color: var(--text); }
.cons-section-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 700;
}
.cons-section-tab .cons-tab-badge {
  font-size: 0.68rem;
  opacity: 0.55;
}
.cons-section-pane { display: none; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
.cons-section-pane.active { display: flex; }

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
`;

// ── Module state ────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;
let _container: HTMLElement | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _jobsExpanded = true;
let _activeSection = "actions";
let _page = 0;

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

  const sections: Array<{ id: string; label: string; badge: string }> = [
    { id: "importer",    label: "Importer",    badge: "sources" },
    { id: "documents",   label: "Documents",   badge: "épisodes" },
    { id: "actions",     label: "Actions",     badge: "pipeline" },
    { id: "personnages", label: "Personnages", badge: "locuteurs" },
    { id: "exporter",    label: "Exporter",    badge: "formats" },
  ];

  container.innerHTML = `
    <div class="cons-root">
      <nav class="cons-section-nav">
        ${sections.map((s) => `
          <button class="cons-section-tab${s.id === _activeSection ? " active" : ""}" data-section="${s.id}">
            ${s.label}
            <span class="cons-tab-badge">${s.badge}</span>
          </button>`).join("")}
      </nav>

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

      <!-- Section : Actions (contenu pipeline actuel) -->
      <div class="cons-section-pane${_activeSection === "actions" ? " active" : ""}" data-section="actions">
        <div class="cons-toolbar">
          <span class="cons-toolbar-title">Actions</span>
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
    </div>`;

  // Section nav switching
  container.querySelectorAll<HTMLButtonElement>(".cons-section-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.dataset.section!;
      _activeSection = sec;
      container.querySelectorAll<HTMLButtonElement>(".cons-section-tab")
        .forEach((b) => b.classList.toggle("active", b.dataset.section === sec));
      container.querySelectorAll<HTMLElement>(".cons-section-pane")
        .forEach((p) => p.classList.toggle("active", p.dataset.section === sec));
    });
  });

  // Refresh episodes button
  container
    .querySelector<HTMLButtonElement>("#cons-refresh")!
    .addEventListener("click", () => loadAndRender(container));

  // Batch normalize button — épisodes chargés au clic
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

  // Jobs toggle
  container
    .querySelector<HTMLElement>("#cons-jobs-toggle")!
    .addEventListener("click", () => {
      _jobsExpanded = !_jobsExpanded;
      const body = container.querySelector<HTMLElement>("#cons-jobs-body");
      const hdr  = container.querySelector<HTMLElement>("#cons-jobs-toggle");
      if (body) body.style.display = _jobsExpanded ? "block" : "none";
      if (hdr) hdr.textContent = (_jobsExpanded ? "▾" : "▸") + " File de jobs";
      // Recréer le compteur (effacé par textContent)
      if (hdr) {
        const span = document.createElement("span");
        span.className = "cons-jobs-count";
        span.textContent = "…";
        hdr.appendChild(span);
      }
    });

  // Refresh jobs button
  container
    .querySelector<HTMLButtonElement>("#cons-refresh-jobs")!
    .addEventListener("click", () => refreshJobs(container));

  // Backend status dot
  const dotEl = container.querySelector<HTMLElement>("#cons-api-dot")!;
  _unsubscribe = ctx.onStatusChange((s) => {
    dotEl.className = "cons-api-dot " + (s.online ? "online" : "offline");
  });

  // Initial load
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
}
