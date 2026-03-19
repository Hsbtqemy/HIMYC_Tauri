/**
 * alignerModule.ts — Mode Aligner (MX-009)
 *
 * Handoff depuis l'Inspecter :
 *   ctx.getHandoff() → AlignerHandoff{episode_id, pivot_key, target_keys, mode, segment_kind}
 *
 * Si handoff présent → formulaire pré-rempli.
 * Si navigation directe → sélecteur épisode + pivot + cible.
 *
 * Lancement → createJob("align", episodeId, "", params) → poll statut → lien résultats.
 *
 * Support transcript-first et srt-only (via guardAlignEpisode).
 */

import type { ShellContext, AlignerHandoff } from "../context";
import {
  fetchEpisodes,
  fetchAlignmentRuns,
  createJob,
  fetchJobs,
  type Episode,
  type AlignmentRun,
  ApiError,
} from "../api";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import {
  guardAlignEpisode,
  getAlignPreconditions,
  formatJobError,
} from "../guards";
import { resolveSrtPivot } from "../model";

// ── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
.align-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Toolbar */
.align-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.align-toolbar-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
}
.align-toolbar-gap { flex: 1; }

/* Body scroll */
.align-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Carte configuration */
.align-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.align-card-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 10px;
}

/* Champs formulaire */
.align-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.82rem;
}
.align-field label {
  min-width: 90px;
  color: var(--text-muted);
  font-weight: 600;
  flex-shrink: 0;
}
.align-targets-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.align-target-item {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--text);
  font-weight: 400;
}
.align-target-item input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--accent);
}
.align-select {
  font-size: 0.8rem;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
}
.align-select:disabled { opacity: 0.5; }
.align-mode-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  background: #ede9fe;
  color: #5b21b6;
}

/* Bouton lancer */
.align-launch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.align-feedback {
  font-size: 0.78rem;
  font-style: italic;
  color: var(--text-muted);
}

/* Garde bloquante */
.align-guard-msg {
  padding: 10px 13px;
  border-radius: 6px;
  background: #fef9c3;
  border: 1px solid #fde047;
  color: #854d0e;
  font-size: 0.82rem;
}

/* Historique runs */
.align-runs-empty {
  color: var(--text-muted);
  font-size: 0.82rem;
  font-style: italic;
}
.align-run-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.79rem;
}
.align-run-row:last-child { border-bottom: none; }
.align-run-id {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.align-run-langs { color: var(--text); }
.align-run-date { color: var(--text-muted); font-size: 0.72rem; margin-left: auto; }

/* Checklist préconditions (MX-010) */
.align-preconditions {
  padding: 10px 13px;
  border-radius: 6px;
  background: #fef9c3;
  border: 1px solid #fde047;
  font-size: 0.82rem;
}
.align-preconditions-title {
  font-weight: 700;
  color: #92400e;
  margin-bottom: 8px;
}
.align-pre-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  color: var(--text);
}
.align-pre-row.unmet { color: #92400e; }
.align-pre-icon { flex-shrink: 0; width: 14px; font-size: 0.8rem; }
.align-pre-label { font-weight: 500; }
.align-pre-hint { font-size: 0.75rem; color: var(--text-muted); font-style: italic; margin-left: 4px; }

/* Erreur */
.align-error {
  padding: 9px 13px;
  border-radius: 6px;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #991b1b;
  font-size: 0.82rem;
  display: none;
}
`;

// ── Module state ────────────────────────────────────────────────────────────

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _pendingJobId: string | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function pivotLangFromKey(key: string): string {
  if (key === "transcript") return ""; // pas de langue pivot fixe pour transcript-first
  return key.startsWith("srt_") ? key.slice(4) : key;
}

function targetLangsFromKeys(keys: string[]): string[] {
  return keys
    .filter((k) => k.startsWith("srt_"))
    .map((k) => k.slice(4));
}

// ── Rendu historique runs ────────────────────────────────────────────────────

async function loadRuns(container: HTMLElement, episodeId: string) {
  const runsEl = container.querySelector<HTMLElement>("#align-runs-body");
  if (!runsEl) return;
  try {
    const { runs } = await fetchAlignmentRuns(episodeId);
    if (runs.length === 0) {
      runsEl.innerHTML = `<div class="align-runs-empty">Aucun run d'alignement pour cet épisode.</div>`;
      return;
    }
    runsEl.innerHTML = runs
      .slice()
      .reverse()
      .map((r: AlignmentRun) => {
        const langs = [r.pivot_lang, ...r.target_langs].filter(Boolean).join(" → ");
        const date = r.created_at
          ? new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
          : "";
        return `
          <div class="align-run-row">
            <span class="align-run-id">${escapeHtml(r.run_id)}</span>
            <span class="align-run-langs">${escapeHtml(langs || "—")}</span>
            <span style="font-size:0.72rem;color:var(--text-muted)">${escapeHtml(r.segment_kind)}</span>
            <span class="align-run-date">${escapeHtml(date)}</span>
          </div>`;
      })
      .join("");
  } catch { /* silencieux */ }
}

// ── Poll job ────────────────────────────────────────────────────────────────

function startPoll(container: HTMLElement, jobId: string, episodeId: string) {
  _pendingJobId = jobId;
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(async () => {
    try {
      const { jobs } = await fetchJobs();
      const job = jobs.find((j) => j.job_id === jobId);
      if (!job) { stopPoll(); return; }

      const fb = container.querySelector<HTMLElement>("#align-feedback");
      if (fb) {
        if (job.status === "running") fb.textContent = "Alignement en cours…";
        else if (job.status === "done") {
          fb.textContent = "Alignement terminé ✓";
          fb.style.color = "var(--success)";
          stopPoll();
          loadRuns(container, episodeId);
        } else if (job.status === "error") {
          fb.textContent = formatJobError(job.error_msg);
          fb.style.color = "var(--danger)";
          stopPoll();
        }
      }
    } catch { stopPoll(); }
  }, 2000);
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _pendingJobId = null;
}

// ── Rendu formulaire ────────────────────────────────────────────────────────

function renderForm(
  container: HTMLElement,
  episode: Episode,
  handoff: AlignerHandoff | null,
) {
  const card = container.querySelector<HTMLElement>("#align-config-card")!;
  const errEl = container.querySelector<HTMLElement>(".align-error")!;
  errEl.style.display = "none";

  // Vérifier la garde — afficher checklist structurée si bloqué (MX-010)
  const guard = guardAlignEpisode(episode);
  if (!guard.allowed) {
    const preconditions = getAlignPreconditions(episode);
    const rows = preconditions
      .map((p) => {
        const cls  = p.met ? "met" : "unmet";
        const icon = p.met ? "✓" : "✗";
        const hint = !p.met && p.hint
          ? `<span class="align-pre-hint">→ ${escapeHtml(p.hint)}</span>`
          : "";
        return `
          <div class="align-pre-row ${cls}">
            <span class="align-pre-icon">${icon}</span>
            <span class="align-pre-label">${escapeHtml(p.label)}</span>
            ${hint}
          </div>`;
      })
      .join("");
    card.innerHTML = `
      <div class="align-card-title">Configuration</div>
      <div class="align-preconditions">
        <div class="align-preconditions-title">Préconditions manquantes</div>
        ${rows}
      </div>`;
    return;
  }

  const transcript = episode.sources.find((s) => s.source_key === "transcript" && s.available);
  const srts = episode.sources.filter((s) => s.source_key.startsWith("srt_") && s.available);

  // Mode
  const mode = transcript ? "transcript_first" : "srt_only";
  const pivotKeyDefault = handoff?.pivot_key ?? (transcript ? "transcript" : (resolveSrtPivot(episode) ?? srts[0]?.source_key ?? ""));
  const targetKeysDefault = handoff?.target_keys ?? srts.filter((s) => s.source_key !== pivotKeyDefault).map((s) => s.source_key);
  const segmentKindDefault = handoff?.segment_kind ?? "sentence";

  const modeLabel = mode === "transcript_first" ? "Transcript-first" : "SRT-only";
  const pivotDisplay = pivotKeyDefault === "transcript" ? "transcript" : pivotKeyDefault.replace("srt_", "SRT ");

  // Toutes les SRT éligibles comme cibles (tout sauf le pivot)
  const eligibleTargets = srts.filter((s) => s.source_key !== pivotKeyDefault);

  const targetsHtml = eligibleTargets.length === 0
    ? `<span style="font-size:0.82rem;color:var(--text-muted);font-style:italic">Aucune SRT disponible comme cible.</span>`
    : `<div class="align-targets-list">
        ${eligibleTargets.map((s) => {
          const checked = targetKeysDefault.includes(s.source_key) ? "checked" : "";
          const langLabel = s.source_key.replace("srt_", "SRT ").toUpperCase();
          return `<label class="align-target-item">
            <input type="checkbox" data-target-key="${escapeHtml(s.source_key)}" ${checked}>
            ${escapeHtml(langLabel)}
          </label>`;
        }).join("")}
      </div>`;

  // Sélecteur segment_kind
  const kindOptions = ["sentence", "utterance"]
    .map((k) => `<option value="${k}" ${k === segmentKindDefault ? "selected" : ""}>${k}</option>`)
    .join("");

  card.innerHTML = `
    <div class="align-card-title">Configuration</div>
    <div class="align-field">
      <label>Mode</label>
      <span class="align-mode-badge">${escapeHtml(modeLabel)}</span>
    </div>
    <div class="align-field">
      <label>Pivot</label>
      <span style="font-size:0.82rem;font-family:ui-monospace,monospace">${escapeHtml(pivotDisplay)}</span>
    </div>
    <div class="align-field" style="align-items:flex-start">
      <label style="padding-top:3px">Cible(s)</label>
      ${targetsHtml}
    </div>
    <div class="align-field">
      <label>Segmentation</label>
      <select class="align-select" id="align-segment-kind">${kindOptions}</select>
    </div>
    <div class="align-launch-row">
      <button class="btn btn-primary" id="align-btn-launch" style="font-size:13px;padding:6px 16px">▶ Lancer l'alignement</button>
      <span class="align-feedback" id="align-feedback"></span>
    </div>`;

  container.querySelector<HTMLButtonElement>("#align-btn-launch")!
    .addEventListener("click", async () => {
      const btn = container.querySelector<HTMLButtonElement>("#align-btn-launch")!;
      btn.disabled = true;
      const fb = container.querySelector<HTMLElement>("#align-feedback")!;
      fb.style.color = "var(--text-muted)";
      fb.textContent = "Création du job…";

      // Ré-évaluer la garde au moment du clic (MX-008)
      const g2 = guardAlignEpisode(episode);
      if (!g2.allowed) {
        fb.textContent = g2.reason ?? "Alignement bloqué.";
        fb.style.color = "var(--danger)";
        btn.disabled = false;
        return;
      }

      try {
        const segmentKind = (container.querySelector<HTMLSelectElement>("#align-segment-kind")?.value ?? "sentence") as "sentence" | "utterance";
        const pivotLang = pivotLangFromKey(pivotKeyDefault);
        // Lire les cibles cochées au moment du clic
        const checkedTargetKeys = Array.from(
          card.querySelectorAll<HTMLInputElement>("input[data-target-key]:checked"),
        ).map((inp) => inp.dataset.targetKey!);
        const targetLangs = targetLangsFromKeys(checkedTargetKeys);
        if (targetLangs.length === 0) {
          fb.textContent = "Sélectionnez au moins une cible SRT.";
          fb.style.color = "var(--danger)";
          btn.disabled = false;
          return;
        }
        const runId = `${episode.episode_id}-${Date.now()}`;

        const job = await createJob("align", episode.episode_id, "", {
          pivot_lang:   pivotLang || targetLangs[0] || "",
          target_langs: targetLangs,
          segment_kind: segmentKind,
          run_id:       runId,
        });

        fb.textContent = "Job créé — alignement en cours…";
        startPoll(container, job.job_id, episode.episode_id);
      } catch (e) {
        fb.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
        fb.style.color = "var(--danger)";
        btn.disabled = false;
      }
    });
}

// ── Chargement principal ────────────────────────────────────────────────────

async function loadModule(
  container: HTMLElement,
  handoff: AlignerHandoff | null,
) {
  try {
    const { episodes } = await fetchEpisodes();

    const epSel = container.querySelector<HTMLSelectElement>("#align-ep-select")!;
    epSel.innerHTML = episodes.length === 0
      ? `<option value="">— aucun épisode —</option>`
      : episodes
          .map((ep) =>
            `<option value="${escapeHtml(ep.episode_id)}" ${ep.episode_id === (handoff?.episode_id ?? "") ? "selected" : ""}>${escapeHtml(ep.episode_id)} — ${escapeHtml(ep.title)}</option>`)
          .join("");
    epSel.disabled = false;

    const selectedId = handoff?.episode_id ?? episodes[0]?.episode_id ?? "";
    epSel.value = selectedId;

    const episode = episodes.find((e) => e.episode_id === selectedId);
    if (episode) {
      renderForm(container, episode, handoff);
      loadRuns(container, episode.episode_id);
    }

    epSel.addEventListener("change", () => {
      stopPoll();
      const ep = episodes.find((e) => e.episode_id === epSel.value);
      if (ep) { renderForm(container, ep, null); loadRuns(container, ep.episode_id); }
    });
  } catch (e) {
    const errEl = container.querySelector<HTMLElement>(".align-error")!;
    errEl.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
    errEl.style.display = "block";
  }
}

// ── Mount / Dispose ─────────────────────────────────────────────────────────

export function mountAligner(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  const handoff = ctx.getHandoff(); // consommé ici — null sur navigations suivantes

  container.innerHTML = `
    <div class="align-root">
      <div class="align-toolbar">
        <span class="align-toolbar-title">Aligner</span>
        <div style="display:flex;align-items:center;gap:6px">
          <label style="font-size:0.75rem;color:var(--text-muted);font-weight:600">Épisode</label>
          <select class="align-select" id="align-ep-select" disabled style="max-width:260px">
            <option>Chargement…</option>
          </select>
        </div>
        <span class="align-toolbar-gap"></span>
        <button class="btn btn-ghost" id="align-btn-reload" style="font-size:12px;padding:4px 10px">↺</button>
      </div>
      <div class="align-error"></div>
      <div class="align-body">
        <div class="align-card" id="align-config-card">
          <div class="align-card-title">Configuration</div>
          <div style="color:var(--text-muted);font-size:0.82rem">Chargement…</div>
        </div>
        <div class="align-card">
          <div class="align-card-title">Historique des runs</div>
          <div id="align-runs-body"><div style="color:var(--text-muted);font-size:0.82rem">Chargement…</div></div>
        </div>
      </div>
    </div>`;

  container.querySelector<HTMLButtonElement>("#align-btn-reload")!
    .addEventListener("click", () => {
      stopPoll();
      loadModule(container, null);
    });

  _unsubscribe = ctx.onStatusChange((s) => {
    if (s.online) loadModule(container, handoff);
  });

  if (ctx.getBackendStatus().online) {
    loadModule(container, handoff);
  } else {
    const card = container.querySelector<HTMLElement>("#align-config-card")!;
    card.innerHTML = `<div class="align-card-title">Configuration</div>
      <div class="align-guard-msg">Backend HIMYC hors ligne. Lancez : <code>uvicorn howimetyourcorpus.api.server:app --port 8765</code></div>`;
  }
}

export function disposeAligner() {
  stopPoll();
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
