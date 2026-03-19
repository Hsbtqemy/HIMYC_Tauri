/**
 * inspecterModule.ts — Mode Inspecter source-centric (MX-007 + MX-008)
 *
 * Zone unique de travail pilotée par Episode + Source :
 * - Sélecteur Episode → sélecteur Source (auto-filtré sur sources disponibles)
 * - Transcript : onglets RAW / CLEAN, actions Normaliser / Segmenter selon état
 * - SRT        : contenu brut SRT, pas d'action normalisation (MX-009)
 * - Panneau méta via metaPanel.ts
 * - Gardes métier centralisées (MX-008) : UI + handlers
 */

import type { ShellContext } from "../context";
import {
  fetchEpisodes,
  fetchEpisodeSource,
  createJob,
  type Episode,
  type EpisodeSource,
  type TranscriptSourceContent,
  type SrtSourceContent,
  ApiError,
} from "../api";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { measureAsync } from "../perf";
import { openMetaPanel, type EpisodeSourceInfo } from "../features/metaPanel";
import {
  guardNormalizeTranscript,
  guardSegmentTranscript,
  guardAlignEpisode,
  guardedAction,
} from "../guards";
import type { AlignerHandoff } from "../context";
import { deriveDocRelations, resolveSrtPivot } from "../model";

// ── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
.insp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar sélecteur */
.insp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.insp-select-group {
  display: flex;
  align-items: center;
  gap: 5px;
}
.insp-select-group label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
  white-space: nowrap;
}
.insp-select {
  font-size: 0.8rem;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  max-width: 240px;
}
.insp-select:disabled { opacity: 0.5; cursor: not-allowed; }
.insp-toolbar-gap { flex: 1; }

/* Barre d'actions */
.insp-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface2);
  flex-shrink: 0;
  min-height: 38px;
}
.insp-state-badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.insp-state-badge.raw        { background: #fef9c3; color: #92400e; }
.insp-state-badge.normalized { background: #dbeafe; color: #1e40af; }
.insp-state-badge.segmented  { background: #e0e7ff; color: #3730a3; }
.insp-state-badge.ready      { background: #dcfce7; color: #166534; }
.insp-state-badge.unknown    { background: #f3f4f6; color: #6b7280; }
.insp-actions-gap { flex: 1; }
.insp-job-feedback {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-style: italic;
}

/* Onglets RAW / CLEAN */
.insp-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface2);
  flex-shrink: 0;
}
.insp-tab {
  padding: 5px 16px;
  font-size: 0.78rem;
  font-weight: 600;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color .15s;
}
.insp-tab:hover { color: var(--text); }
.insp-tab.active { color: var(--brand); border-bottom-color: var(--brand); }

/* Zone de contenu */
.insp-content-wrap {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
}
.insp-text {
  font-family: ui-monospace, "SF Mono", monospace;
  font-size: 0.78rem;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  margin: 0;
}
.insp-srt {
  font-family: ui-monospace, "SF Mono", monospace;
  font-size: 0.78rem;
  line-height: 1.65;
  white-space: pre-wrap;
  color: var(--text);
}

/* États vides/erreur/chargement */
.insp-empty {
  padding: 3rem 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.7;
}
.insp-error {
  margin: 10px 14px;
  padding: 9px 13px;
  border-radius: 6px;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #991b1b;
  font-size: 0.82rem;
}
.insp-loading {
  padding: 3rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
`;

// ── Module state ────────────────────────────────────────────────────────────

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;

/** Épisode sélectionné */
let _episodes: Episode[] = [];
let _selectedEpId   = "";
let _selectedSrcKey = "";
/** Onglet actif : "raw" | "clean" */
let _activeTab: "raw" | "clean" = "raw";
/** Référence au bouton Aligner pour mise à jour hors mountInspecter */
let _alignBtn: HTMLButtonElement | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function updateAlignBtn() {
  if (!_alignBtn) return;
  const ep = _episodes.find((e) => e.episode_id === _selectedEpId);
  if (!ep) { _alignBtn.disabled = true; _alignBtn.title = "Sélectionnez un épisode"; return; }
  const g = guardAlignEpisode(ep);
  _alignBtn.disabled = !g.allowed;
  _alignBtn.title = g.allowed ? "Passer en mode Aligner" : (g.reason ?? "");
}

function availableSources(ep: Episode): EpisodeSource[] {
  return ep.sources.filter((s) => s.available);
}

function stateBadgeHtml(state: string): string {
  const labels: Record<string, string> = {
    unknown: "?",
    raw: "brut",
    normalized: "normalisé",
    segmented: "segmenté",
    ready_for_alignment: "prêt",
  };
  const cls = state === "ready_for_alignment" ? "ready" : (state || "unknown");
  return `<span class="insp-state-badge ${escapeHtml(cls)}">${escapeHtml(labels[state] ?? state)}</span>`;
}

// ── Rendu sélecteurs ────────────────────────────────────────────────────────

function populateEpisodeSelect(container: HTMLElement) {
  const sel = container.querySelector<HTMLSelectElement>("#insp-ep-select")!;
  sel.innerHTML = _episodes.length === 0
    ? `<option value="">— aucun épisode —</option>`
    : _episodes
        .map((ep) =>
          `<option value="${escapeHtml(ep.episode_id)}" ${ep.episode_id === _selectedEpId ? "selected" : ""}>` +
          `${escapeHtml(ep.episode_id)} — ${escapeHtml(ep.title)}</option>`)
        .join("");
}

function populateSourceSelect(container: HTMLElement) {
  const ep  = _episodes.find((e) => e.episode_id === _selectedEpId);
  const sel = container.querySelector<HTMLSelectElement>("#insp-src-select")!;
  if (!ep) { sel.innerHTML = `<option value="">—</option>`; sel.disabled = true; return; }

  const srcs = availableSources(ep);
  sel.disabled = srcs.length === 0;
  sel.innerHTML = srcs.length === 0
    ? `<option value="">— aucune source —</option>`
    : srcs
        .map((s) =>
          `<option value="${escapeHtml(s.source_key)}" ${s.source_key === _selectedSrcKey ? "selected" : ""}>${escapeHtml(s.source_key)}</option>`)
        .join("");

  // Sélection auto : maintenir la source si disponible, sinon prendre la première
  const match = srcs.find((s) => s.source_key === _selectedSrcKey);
  _selectedSrcKey = match ? match.source_key : (srcs[0]?.source_key ?? "");
  sel.value = _selectedSrcKey;
}

// ── Barre d'actions ─────────────────────────────────────────────────────────

function renderActions(container: HTMLElement, src: EpisodeSource | undefined) {
  const bar = container.querySelector<HTMLElement>(".insp-actions")!;
  if (!src) { bar.innerHTML = ""; return; }

  const state = src.state ?? "unknown";
  const isTranscript = src.source_key === "transcript";
  const isSrt = src.source_key.startsWith("srt_");

  // ── Évaluer les gardes (UI + handler) ────────────────────────────────
  const normGuard = guardNormalizeTranscript(src);
  const segGuard  = guardSegmentTranscript(src);

  let actions = "";
  let guidance = "";

  if (isTranscript) {
    if (normGuard.allowed) {
      actions += `<button class="btn btn-primary" id="insp-btn-normalize" style="font-size:12px;padding:4px 12px">Normaliser</button>`;
    } else if (segGuard.allowed) {
      actions += `<button class="btn btn-primary" id="insp-btn-segment" style="font-size:12px;padding:4px 12px">Segmenter</button>`;
    } else {
      // Aucune action disponible — afficher le message de guidance
      guidance = normGuard.reason ?? segGuard.reason ?? "";
    }
  }

  if (isSrt) {
    actions += `<span style="font-size:0.75rem;color:var(--text-muted)">SRT — actions dans l'onglet Aligner (MX-009)</span>`;
  }

  const guidanceHtml = guidance
    ? `<span style="font-size:0.72rem;color:var(--text-muted);font-style:italic">${escapeHtml(guidance)}</span>`
    : "";

  bar.innerHTML = `${stateBadgeHtml(state)} ${actions}${guidanceHtml}<span class="insp-actions-gap"></span><span class="insp-job-feedback" id="insp-job-fb"></span>`;

  const showFeedback = (msg: string, ok: boolean) => {
    const fb = bar.querySelector<HTMLElement>("#insp-job-fb");
    if (fb) {
      fb.textContent = msg;
      fb.style.color = ok ? "var(--success)" : "var(--danger)";
    }
  };

  // Handler normaliser — garde vérifiée à nouveau côté handler (MX-008)
  bar.querySelector<HTMLButtonElement>("#insp-btn-normalize")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    await guardedAction(
      guardNormalizeTranscript(src),
      async () => {
        await createJob("normalize_transcript", _selectedEpId);
        showFeedback("Job normalisation ajouté ✓", true);
      },
      (reason) => showFeedback(reason, false),
    ).catch((err) => showFeedback(err instanceof ApiError ? err.message : String(err), false));
    btn.disabled = false;
  });

  // Handler segmenter — garde vérifiée à nouveau côté handler (MX-008)
  bar.querySelector<HTMLButtonElement>("#insp-btn-segment")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    await guardedAction(
      guardSegmentTranscript(src),
      async () => {
        await createJob("segment_transcript", _selectedEpId);
        showFeedback("Job segmentation ajouté ✓", true);
      },
      (reason) => showFeedback(reason, false),
    ).catch((err) => showFeedback(err instanceof ApiError ? err.message : String(err), false));
    btn.disabled = false;
  });
}

// ── Onglets RAW / CLEAN ─────────────────────────────────────────────────────

function renderTabs(container: HTMLElement, hasClean: boolean) {
  const tabBar = container.querySelector<HTMLElement>(".insp-tabs")!;
  tabBar.style.display = hasClean ? "flex" : "none";
  if (!hasClean) { _activeTab = "raw"; return; }
  tabBar.querySelectorAll<HTMLElement>(".insp-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === _activeTab);
  });
}

// ── Contenu source ──────────────────────────────────────────────────────────

async function loadContent(container: HTMLElement) {
  if (!_selectedEpId || !_selectedSrcKey) {
    renderEmpty(container, "Sélectionnez un épisode et une source.");
    return;
  }

  const ep  = _episodes.find((e) => e.episode_id === _selectedEpId);
  const src = ep?.sources.find((s) => s.source_key === _selectedSrcKey);

  renderActions(container, src);

  const wrap = container.querySelector<HTMLElement>(".insp-content-wrap")!;
  wrap.innerHTML = `<div class="insp-loading">Chargement…</div>`;
  hideError(container);

  try {
    const data = await measureAsync(
      `inspecter:load_source:${_selectedSrcKey}`,
      () => fetchEpisodeSource(_selectedEpId, _selectedSrcKey),
    );

    if (data.source_key === "transcript") {
      const t = data as TranscriptSourceContent;
      const hasClean = !!t.clean?.trim();
      renderTabs(container, hasClean);

      const tabBar = container.querySelector<HTMLElement>(".insp-tabs")!;
      tabBar.querySelectorAll<HTMLElement>(".insp-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          _activeTab = tab.dataset.tab as "raw" | "clean";
          tabBar.querySelectorAll(".insp-tab").forEach((t2) =>
            t2.classList.toggle("active", t2 === tab));
          displayText(wrap, _activeTab === "clean" ? t.clean : t.raw);
        });
      });

      displayText(wrap, _activeTab === "clean" && hasClean ? t.clean : t.raw);
    } else {
      const s = data as SrtSourceContent;
      renderTabs(container, false);
      wrap.innerHTML = `<pre class="insp-srt">${escapeHtml(s.content)}</pre>`;
    }

    // Panneau méta
    const metaBtn = container.querySelector<HTMLButtonElement>("#insp-btn-meta");
    if (metaBtn && ep && src) {
      metaBtn.onclick = () => {
        const info: EpisodeSourceInfo = {
          episode_id:   ep.episode_id,
          title:        ep.title,
          source_key:   src.source_key,
          language:     src.language,
          source_state: src.state,
          track_count:  ep.sources.filter((s2) => s2.source_key.startsWith("srt_") && s2.available).length,
        };
        openMetaPanel(info);
      };
    }
  } catch (e) {
    wrap.innerHTML = "";
    showError(container, e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e));
  }
}

const TEXT_TRUNCATE_CHARS = 50_000;

function displayText(wrap: HTMLElement, text: string) {
  if (text.length > TEXT_TRUNCATE_CHARS) {
    const truncated = text.slice(0, TEXT_TRUNCATE_CHARS);
    const remaining = text.length - TEXT_TRUNCATE_CHARS;
    wrap.innerHTML = `
      <pre class="insp-text">${escapeHtml(truncated)}</pre>
      <div style="padding:8px 0;font-size:0.75rem;color:var(--text-muted);font-style:italic">
        … ${remaining.toLocaleString("fr-FR")} caractères supplémentaires masqués.
        <button class="btn btn-ghost" id="insp-show-all" style="font-size:11px;padding:2px 7px;margin-left:6px">Afficher tout</button>
      </div>`;
    wrap.querySelector<HTMLButtonElement>("#insp-show-all")?.addEventListener("click", () => {
      wrap.innerHTML = `<pre class="insp-text">${escapeHtml(text)}</pre>`;
    });
  } else {
    wrap.innerHTML = `<pre class="insp-text">${escapeHtml(text)}</pre>`;
  }
}

function renderEmpty(container: HTMLElement, msg: string) {
  const wrap = container.querySelector<HTMLElement>(".insp-content-wrap")!;
  const tabBar = container.querySelector<HTMLElement>(".insp-tabs");
  if (tabBar) tabBar.style.display = "none";
  const bar = container.querySelector<HTMLElement>(".insp-actions");
  if (bar) bar.innerHTML = "";
  wrap.innerHTML = `<div class="insp-empty">${escapeHtml(msg)}</div>`;
}

function showError(container: HTMLElement, msg: string) {
  const el = container.querySelector<HTMLElement>(".insp-error");
  if (el) { el.textContent = msg; el.style.display = "block"; }
}

function hideError(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>(".insp-error");
  if (el) el.style.display = "none";
}

// ── Chargement initial épisodes ─────────────────────────────────────────────

async function loadEpisodes(container: HTMLElement) {
  try {
    const { episodes } = await measureAsync("inspecter:load_episodes", fetchEpisodes);
    _episodes = episodes;

    populateEpisodeSelect(container);

    // Sélection auto du premier épisode si vide
    if (!_selectedEpId && _episodes.length > 0) {
      _selectedEpId = _episodes[0].episode_id;
      const sel = container.querySelector<HTMLSelectElement>("#insp-ep-select");
      if (sel) sel.value = _selectedEpId;
    }

    populateSourceSelect(container);
    updateAlignBtn();

    if (_selectedEpId && _selectedSrcKey) {
      loadContent(container);
    } else {
      renderEmpty(container, _episodes.length === 0
        ? "Aucun épisode dans ce projet."
        : "Sélectionnez un épisode pour commencer.");
    }
  } catch (e) {
    showError(container, e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e));
  }
}

// ── Mount / Dispose ─────────────────────────────────────────────────────────

export function mountInspecter(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  // Réinitialiser l'état à chaque montage
  _selectedEpId   = "";
  _selectedSrcKey = "";
  _activeTab      = "raw";
  _episodes       = [];

  container.innerHTML = `
    <div class="insp-root">
      <div class="insp-toolbar">
        <div class="insp-select-group">
          <label for="insp-ep-select">Épisode</label>
          <select class="insp-select" id="insp-ep-select" disabled>
            <option>Chargement…</option>
          </select>
        </div>
        <div class="insp-select-group">
          <label for="insp-src-select">Source</label>
          <select class="insp-select" id="insp-src-select" disabled>
            <option>—</option>
          </select>
        </div>
        <span class="insp-toolbar-gap"></span>
        <button class="btn btn-secondary" id="insp-btn-align" style="font-size:11px;padding:3px 9px" disabled title="Passer en mode Aligner">→ Aligner</button>
        <button class="btn btn-ghost" id="insp-btn-meta" style="font-size:12px;padding:4px 10px" disabled>ℹ Info</button>
        <button class="btn btn-ghost" id="insp-btn-reload" style="font-size:12px;padding:4px 10px">↺</button>
      </div>
      <div class="insp-error" style="display:none"></div>
      <div class="insp-actions"></div>
      <div class="insp-tabs">
        <button class="insp-tab active" data-tab="raw">RAW</button>
        <button class="insp-tab" data-tab="clean">CLEAN</button>
      </div>
      <div class="insp-content-wrap">
        <div class="insp-empty">Chargement des épisodes…</div>
      </div>
    </div>`;

  const epSel   = container.querySelector<HTMLSelectElement>("#insp-ep-select")!;
  const srcSel  = container.querySelector<HTMLSelectElement>("#insp-src-select")!;
  const metaBtn = container.querySelector<HTMLButtonElement>("#insp-btn-meta")!;
  const alignBtn = container.querySelector<HTMLButtonElement>("#insp-btn-align")!;

  epSel.addEventListener("change", () => {
    _selectedEpId   = epSel.value;
    _selectedSrcKey = "";
    populateSourceSelect(container);
    updateAlignBtn();
    if (_selectedSrcKey) loadContent(container);
    else renderEmpty(container, "Sélectionnez une source.");
  });

  srcSel.addEventListener("change", () => {
    _selectedSrcKey = srcSel.value;
    metaBtn.disabled = !_selectedSrcKey;
    updateAlignBtn();
    if (_selectedSrcKey) loadContent(container);
  });

  _alignBtn = alignBtn;

  alignBtn.addEventListener("click", () => {
    const ep = _episodes.find((e) => e.episode_id === _selectedEpId);
    if (!ep) return;
    const g = guardAlignEpisode(ep);
    if (!g.allowed) { showError(container, g.reason ?? "Alignement non disponible."); return; }

    const transcript = ep.sources.find((s) => s.source_key === "transcript" && s.available);
    const srts = ep.sources.filter((s) => s.source_key.startsWith("srt_") && s.available);

    let handoff: AlignerHandoff;
    if (transcript) {
      handoff = {
        episode_id:    ep.episode_id,
        episode_title: ep.title,
        pivot_key:     "transcript",
        target_keys:   srts.map((s) => s.source_key),
        mode:          "transcript_first",
        segment_kind:  "sentence",
      };
    } else {
      // srt-only
      const pivotKey = resolveSrtPivot(ep) ?? srts[0].source_key;
      handoff = {
        episode_id:    ep.episode_id,
        episode_title: ep.title,
        pivot_key:     pivotKey,
        target_keys:   srts.filter((s) => s.source_key !== pivotKey).map((s) => s.source_key),
        mode:          "srt_only",
        segment_kind:  "sentence",
      };
    }

    ctx.setHandoff(handoff);
    ctx.navigateTo("aligner");
  });

  container.querySelector<HTMLButtonElement>("#insp-btn-reload")!
    .addEventListener("click", () => loadEpisodes(container));

  _unsubscribe = ctx.onStatusChange((s) => {
    if (s.online && _episodes.length === 0) loadEpisodes(container);
  });

  if (ctx.getBackendStatus().online) {
    loadEpisodes(container).then(() => {
      epSel.disabled = false;
    });
  } else {
    renderEmpty(container, "Backend HIMYC hors ligne.\nLancez : uvicorn howimetyourcorpus.api.server:app --port 8765");
  }
}

export function disposeInspecter() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _alignBtn = null;
}
