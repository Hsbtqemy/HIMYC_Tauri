/**
 * exporterModule.ts — Vue Exporter top-level (depuis hub tile) — L4
 *
 * Stage tabs : Corpus | Segments | Alignements | SRT enrichi | Personnages | QA | Jobs
 * KPI strip + gate banner QA + export jobs JSONL.
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import {
  runExport,
  fetchConfig,
  fetchQaReport,
  fetchAllAlignmentRuns,
  exportAlignments,
  propagateCharacters,
  fetchEpisodeSource,
  ApiError,
  formatApiError,
  type ExportResult,
  type QaReport,
  type AlignmentRunFlat,
  type PropagateResult,
  type SrtSourceContent,
} from "../api";

const CSS = `
.exp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface2);
  overflow: hidden;
}
.exp-header {
  padding: 1rem 1.5rem 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.exp-header-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.exp-header-top h2 { margin: 0; font-size: 1rem; font-weight: 700; color: var(--text); }
.exp-project-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 0.74rem;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
}
/* KPI strip */
.exp-kpi-strip {
  display: flex;
  gap: 16px;
  padding: 6px 0 10px;
  flex-wrap: wrap;
}
.exp-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 56px;
}
.exp-kpi-val {
  font-size: 1.1rem;
  font-weight: 700;
  font-family: ui-monospace, monospace;
  color: var(--text);
  line-height: 1.2;
}
.exp-kpi-label { font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; }
.exp-kpi-sep { width: 1px; background: var(--border); align-self: stretch; margin: 2px 0; }
/* Stage tabs */
.exp-tabs {
  display: flex;
  gap: 2px;
  padding-top: 4px;
}
.exp-tab {
  padding: 6px 14px;
  font-size: 0.8rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: background .1s, color .1s;
  position: relative;
  bottom: -1px;
}
.exp-tab:hover { background: var(--surface2); color: var(--text); }
.exp-tab.active {
  background: var(--surface2);
  border-color: var(--border);
  border-bottom-color: var(--surface2);
  color: var(--text);
  font-weight: 600;
}
/* Body */
.exp-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
/* Tab panes */
.exp-pane { display: none; flex-direction: column; gap: 1rem; }
.exp-pane.active { display: flex; }
/* Cards */
.exp-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 620px) { .exp-card-grid { grid-template-columns: 1fr; } }
.exp-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem;
}
.exp-card-title { font-size: 0.92rem; font-weight: 700; color: var(--text); margin-bottom: 0.4rem; }
.exp-card-desc { font-size: 0.78rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 0.75rem; }
.exp-fmt-row { display: flex; gap: 6px; flex-wrap: wrap; }
.exp-result {
  margin-top: 8px;
  font-size: 0.77rem;
  padding: 6px 10px;
  border-radius: 5px;
  background: var(--surface2);
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  word-break: break-all;
  display: none;
}
.exp-result.visible { display: block; }
.exp-result.ok  { color: var(--success, #16a34a); background: #f0fdf4; }
.exp-result.err { color: var(--danger,  #dc2626); background: #fef2f2; }
/* QA gate banner */
.exp-gate-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 0.82rem;
  font-weight: 600;
  border: 1px solid;
  flex-shrink: 0;
}
.exp-gate-banner.ok       { background: #f0fdf4; border-color: #86efac; color: #166534; }
.exp-gate-banner.warnings { background: #fefce8; border-color: #fde047; color: #854d0e; }
.exp-gate-banner.blocking { background: #fef2f2; border-color: #fca5a5; color: #7f1d1d; }
.exp-gate-icon { font-size: 1.1rem; }
/* QA policy toggle */
.exp-policy-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.exp-policy-btn {
  padding: 2px 10px;
  font-size: 0.74rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
}
.exp-policy-btn.active { background: var(--accent, #0f766e); color: #fff; border-color: var(--accent, #0f766e); }
/* QA issue list */
.exp-issue-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.exp-issue {
  font-size: 0.76rem;
  padding: 4px 10px;
  border-radius: 4px;
  border-left: 3px solid;
}
.exp-issue.blocking { background: #fef2f2; border-color: #dc2626; color: #7f1d1d; }
.exp-issue.warning  { background: #fefce8; border-color: #ca8a04; color: #713f12; }
/* Alignements tab */
.exp-align-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.exp-align-table th { background: var(--surface2); font-weight: 600; color: var(--text-muted); padding: 5px 10px; text-align: left; border-bottom: 1px solid var(--border); }
.exp-align-table td { padding: 5px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.exp-align-table tr:hover td { background: var(--surface2); }
.exp-align-mono { font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--text-muted); }
.exp-align-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 10px; font-size: 0.7rem; font-weight: 600; background: var(--surface2); color: var(--text-muted); border: 1px solid var(--border); }
.exp-align-actions { display: flex; gap: 4px; }
/* SRT Enrichi tab */
.exp-srt-info {
  font-size: 0.8rem; color: var(--text-muted); line-height: 1.6;
  padding: 10px 14px; background: var(--surface2); border-radius: var(--radius);
  border: 1px solid var(--border); margin-bottom: 0;
}
.exp-srt-info code { font-family: ui-monospace, monospace; font-size: 0.75rem; background: var(--surface); padding: 1px 4px; border-radius: 3px; }
.exp-srt-result-strip {
  display: flex; align-items: center; gap: 10px; padding: 5px 10px;
  font-size: 0.77rem; border-radius: var(--radius); margin-top: 4px;
  background: var(--surface2);
}
.exp-srt-result-strip.ok  { background: #f0fdf4; color: #166534; }
.exp-srt-result-strip.err { background: #fef2f2; color: #7f1d1d; }
`;

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;
let _qaPolicy: "lenient" | "strict" = "lenient";
let _qaData: QaReport | null = null;
let _alignRuns: AlignmentRunFlat[] | null = null;
let _alignTabLoaded = false;
let _srtTabLoaded = false;

export function mountExporter(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();
  _qaPolicy = "lenient";

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  container.innerHTML = `
    <div class="exp-root">
      <div class="exp-header">
        <div class="exp-header-top">
          <h2>Exporter</h2>
          <span id="exp-project-badge" class="exp-project-badge">…</span>
        </div>
        <!-- KPI strip -->
        <div class="exp-kpi-strip" id="exp-kpi-strip">
          <div class="exp-kpi"><span class="exp-kpi-val" id="kpi-total">—</span><span class="exp-kpi-label">Épisodes</span></div>
          <div class="exp-kpi-sep"></div>
          <div class="exp-kpi"><span class="exp-kpi-val" id="kpi-norm">—</span><span class="exp-kpi-label">Normalisés</span></div>
          <div class="exp-kpi-sep"></div>
          <div class="exp-kpi"><span class="exp-kpi-val" id="kpi-seg">—</span><span class="exp-kpi-label">Segmentés</span></div>
          <div class="exp-kpi-sep"></div>
          <div class="exp-kpi"><span class="exp-kpi-val" id="kpi-srts">—</span><span class="exp-kpi-label">Avec SRT</span></div>
          <div class="exp-kpi-sep"></div>
          <div class="exp-kpi"><span class="exp-kpi-val" id="kpi-runs">—</span><span class="exp-kpi-label">Runs align.</span></div>
        </div>
        <!-- Stage tabs -->
        <div class="exp-tabs">
          <button class="exp-tab active" data-stage="corpus">Corpus</button>
          <button class="exp-tab" data-stage="segments">Segments</button>
          <button class="exp-tab" data-stage="alignements">Alignements</button>
          <button class="exp-tab" data-stage="srt">SRT Enrichi</button>
          <button class="exp-tab" data-stage="personnages">Personnages</button>
          <button class="exp-tab" data-stage="qa">QA</button>
          <button class="exp-tab" data-stage="jobs">Jobs</button>
        </div>
      </div>

      <div class="exp-body">

        <!-- ── Corpus ──────────────────────────── -->
        <div class="exp-pane active" data-stage="corpus">
          <div class="exp-card-grid">
            <div class="exp-card">
              <div class="exp-card-title">Corpus (texte)</div>
              <div class="exp-card-desc">
                Tous les épisodes normalisés.<br>
                Utilise <code>clean.txt</code> si disponible, sinon <code>raw.txt</code>.
              </div>
              <div class="exp-fmt-row">
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="corpus" data-fmt="txt">TXT</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="corpus" data-fmt="csv">CSV</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="corpus" data-fmt="json">JSON</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="corpus" data-fmt="docx">DOCX</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="corpus" data-fmt="jsonl">JSONL</button>
              </div>
              <div class="exp-result" id="exp-corpus-result"></div>
            </div>
          </div>
        </div>

        <!-- ── Segments ────────────────────────── -->
        <div class="exp-pane" data-stage="segments">
          <div class="exp-card-grid">
            <div class="exp-card">
              <div class="exp-card-title">Segments</div>
              <div class="exp-card-desc">
                Segments issus de la segmentation.<br>
                Requiert que la segmentation ait été lancée.
              </div>
              <div class="exp-fmt-row">
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="segments" data-fmt="txt">TXT</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="segments" data-fmt="csv">CSV</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="segments" data-fmt="tsv">TSV</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="segments" data-fmt="docx">DOCX</button>
              </div>
              <div class="exp-result" id="exp-segments-result"></div>
            </div>
          </div>
        </div>

        <!-- ── Alignements ────────────────────── -->
        <div class="exp-pane" data-stage="alignements">
          <div id="exp-align-body">
            <div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Chargement…</div>
          </div>
        </div>

        <!-- ── SRT Enrichi ────────────────────── -->
        <div class="exp-pane" data-stage="srt">
          <div id="exp-srt-body">
            <div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Chargement…</div>
          </div>
        </div>

        <!-- ── Personnages ────────────────────── -->
        <div class="exp-pane" data-stage="personnages">
          <div class="exp-card-grid">
            <div class="exp-card">
              <div class="exp-card-title">Catalogue personnages</div>
              <div class="exp-card-desc">
                Liste des personnages avec noms canoniques, noms par langue et alias.<br>
                Fichier source : <code>characters.json</code>.
              </div>
              <div class="exp-fmt-row">
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="characters" data-fmt="json">JSON</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="characters" data-fmt="csv">CSV</button>
              </div>
              <div class="exp-result" id="exp-characters-result"></div>
            </div>
            <div class="exp-card">
              <div class="exp-card-title">Assignations</div>
              <div class="exp-card-desc">
                Table des assignations segment/cue → personnage.<br>
                Fichier source : <code>assignments.json</code>.
              </div>
              <div class="exp-fmt-row">
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="assignments" data-fmt="json">JSON</button>
                <button class="btn btn-secondary btn-sm exp-btn" data-scope="assignments" data-fmt="csv">CSV</button>
              </div>
              <div class="exp-result" id="exp-assignments-result"></div>
            </div>
          </div>
        </div>

        <!-- ── QA ─────────────────────────────── -->
        <div class="exp-pane" data-stage="qa">
          <div class="exp-policy-row">
            Politique :
            <button class="exp-policy-btn active" data-policy="lenient">Souple</button>
            <button class="exp-policy-btn" data-policy="strict">Stricte</button>
            <button class="btn btn-ghost btn-sm" id="qa-refresh">↺ Actualiser</button>
          </div>
          <div id="exp-gate-banner" class="exp-gate-banner ok" style="display:none">
            <span class="exp-gate-icon">⏳</span>
            <span id="exp-gate-text">Chargement…</span>
          </div>
          <div id="exp-issue-list" class="exp-issue-list"></div>
          <div class="exp-card" style="max-width:340px">
            <div class="exp-card-title">Rapport QA</div>
            <div class="exp-card-desc">Export du rapport de diagnostics corpus (JSON).</div>
            <div class="exp-fmt-row">
              <button class="btn btn-secondary btn-sm" id="exp-qa-json-btn">JSON</button>
            </div>
            <div class="exp-result" id="exp-qa-result"></div>
          </div>
        </div>

        <!-- ── Jobs ──────────────────────────── -->
        <div class="exp-pane" data-stage="jobs">
          <div class="exp-card" style="max-width:340px">
            <div class="exp-card-title">Historique des jobs</div>
            <div class="exp-card-desc">Export de tous les jobs du projet (pipeline, normalisation, segmentation, alignement).</div>
            <div class="exp-fmt-row">
              <button class="btn btn-secondary btn-sm exp-btn" data-scope="jobs" data-fmt="jsonl">JSONL</button>
              <button class="btn btn-secondary btn-sm exp-btn" data-scope="jobs" data-fmt="json">JSON</button>
            </div>
            <div class="exp-result" id="exp-jobs-result"></div>
          </div>
        </div>

      </div>
    </div>`;

  // ── Project info + KPIs ─────────────────────────────────────────────────
  if (ctx.getBackendStatus().online) {
    fetchConfig().then((cfg) => {
      const el = container.querySelector<HTMLElement>("#exp-project-badge");
      if (el) el.innerHTML = `📁 ${escapeHtml(cfg.project_name)}`;
    }).catch(() => {});
    loadQaData(container);
  }

  // ── Stage tabs ──────────────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".exp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".exp-tab").forEach((t) => t.classList.remove("active"));
      container.querySelectorAll(".exp-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      container.querySelector<HTMLElement>(`.exp-pane[data-stage="${tab.dataset.stage}"]`)?.classList.add("active");
      // Lazy-load alignements tab
      if (tab.dataset.stage === "alignements" && !_alignTabLoaded) {
        _alignTabLoaded = true;
        loadAlignmentsTab(container);
      }
      // Lazy-load SRT enrichi tab
      if (tab.dataset.stage === "srt" && !_srtTabLoaded) {
        _srtTabLoaded = true;
        loadSrtTab(container);
      }
    });
  });

  // ── QA policy buttons ───────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".exp-policy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".exp-policy-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _qaPolicy = btn.dataset.policy as "lenient" | "strict";
      loadQaData(container);
    });
  });

  container.querySelector<HTMLButtonElement>("#qa-refresh")?.addEventListener("click", () => {
    loadQaData(container);
  });

  // ── QA JSON export ──────────────────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#exp-qa-json-btn")?.addEventListener("click", async () => {
    const btn = container.querySelector<HTMLButtonElement>("#exp-qa-json-btn")!;
    const result = container.querySelector<HTMLElement>("#exp-qa-result")!;
    btn.disabled = true;
    result.textContent = "Export en cours…";
    result.className = "exp-result visible";
    try {
      // Export QA as JSON via /export (scope=jobs is available; QA data is client-side)
      // We serialize the current QA data client-side if available, or re-fetch
      if (!_qaData) _qaData = await fetchQaReport(_qaPolicy);
      const blob = new Blob([JSON.stringify(_qaData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qa_report_${_qaPolicy}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      result.textContent = "✓ Téléchargement lancé";
      result.className = "exp-result visible ok";
    } catch (e) {
      result.textContent = formatApiError(e);
      result.className = "exp-result visible err";
    } finally {
      btn.disabled = false;
    }
  });

  // ── Export buttons ──────────────────────────────────────────────────────
  container.querySelectorAll<HTMLButtonElement>(".exp-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleExport(container, btn));
  });

  _unsubscribe = ctx.onStatusChange((status) => {
    if (status.online && !_qaData) loadQaData(container);
  });
}

async function handleExport(container: HTMLElement, btn: HTMLButtonElement) {
  const scope  = btn.dataset.scope as "corpus" | "segments" | "jobs" | "characters" | "assignments";
  const fmt    = btn.dataset.fmt!;
  const resultId = `exp-${scope}-result`;
  const result = container.querySelector<HTMLElement>(`#${resultId}`)!;

  btn.disabled = true;
  result.textContent = "Export en cours…";
  result.className = "exp-result visible";

  try {
    const res: ExportResult = await runExport(scope, fmt);
    const count = res.episodes != null
      ? `${res.episodes} épisodes`
      : res.segments != null
        ? `${res.segments} segments`
        : res.characters != null
          ? `${res.characters} personnages`
          : res.assignments != null
            ? `${res.assignments} assignations`
            : `${res.jobs ?? 0} jobs`;
    result.textContent = `✓ ${count} → ${res.path}`;
    result.className = "exp-result visible ok";
  } catch (e) {
    result.textContent = formatApiError(e);
    result.className = "exp-result visible err";
  } finally {
    btn.disabled = false;
  }
}

async function loadQaData(container: HTMLElement) {
  const banner   = container.querySelector<HTMLElement>("#exp-gate-banner");
  const gateText = container.querySelector<HTMLElement>("#exp-gate-text");
  const issueList = container.querySelector<HTMLElement>("#exp-issue-list");
  if (!banner || !gateText || !issueList) return;

  banner.style.display = "flex";
  banner.className = "exp-gate-banner ok";
  gateText.textContent = "Chargement diagnostics…";
  issueList.innerHTML = "";

  try {
    const qa = await fetchQaReport(_qaPolicy);
    _qaData = qa;

    // Update KPIs
    const set = (id: string, v: number) => {
      const el = container.querySelector<HTMLElement>(`#${id}`);
      if (el) el.textContent = String(v);
    };
    set("kpi-total", qa.total_episodes);
    set("kpi-norm",  qa.n_normalized + qa.n_segmented); // normalized includes segmented
    set("kpi-seg",   qa.n_segmented);
    set("kpi-srts",  qa.n_with_srts);
    set("kpi-runs",  qa.n_alignment_runs);

    // Gate banner
    const icons: Record<string, string> = { ok: "✅", warnings: "⚠️", blocking: "🔴" };
    const labels: Record<string, string> = {
      ok: "Corpus en bon état — aucun problème détecté",
      warnings: `${qa.issues.length} avertissement(s) — export possible`,
      blocking: `${qa.issues.filter(i => i.level === "blocking").length} problème(s) bloquant(s)`,
    };
    banner.className = `exp-gate-banner ${qa.gate}`;
    gateText.innerHTML = `<span>${icons[qa.gate]}</span> ${escapeHtml(labels[qa.gate])} <span style="margin-left:8px;font-size:0.72rem;opacity:.7">[${qa.policy}]</span>`;

    // Issues
    if (qa.issues.length > 0) {
      issueList.innerHTML = qa.issues.map((issue) =>
        `<div class="exp-issue ${issue.level}">${escapeHtml(issue.message)}</div>`
      ).join("");
    }
  } catch (e) {
    banner.className = "exp-gate-banner blocking";
    gateText.textContent = formatApiError(e);
  }
}

export function disposeExporter() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _qaData = null;
  _alignRuns = null;
  _alignTabLoaded = false;
  _srtTabLoaded = false;
}

// ── Alignements tab ──────────────────────────────────────────────────────────

async function loadAlignmentsTab(container: HTMLElement) {
  const body = container.querySelector<HTMLElement>("#exp-align-body");
  if (!body) return;
  body.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Chargement des runs…</div>`;
  try {
    const { runs } = await fetchAllAlignmentRuns();
    _alignRuns = runs;
    renderAlignmentsTab(body);
  } catch (e) {
    body.innerHTML = `<div style="color:var(--danger);font-size:0.82rem">${formatApiError(e)}</div>`;
  }
}

function renderAlignmentsTab(body: HTMLElement) {
  const runs = _alignRuns ?? [];

  if (runs.length === 0) {
    body.innerHTML = `<div class="exp-card" style="max-width:480px">
      <div class="exp-card-title">Aucun run d'alignement</div>
      <div class="exp-card-desc">Lancez un alignement depuis la section Constituer → Alignement pour exporter les concordances ici.</div>
    </div>`;
    return;
  }

  const rows = runs.map((r) => {
    const created = r.created_at ? new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
    const langs = [r.pivot_lang, ...r.target_langs].filter(Boolean).join(" → ");
    return `
      <tr data-run-id="${escapeHtml(r.run_id)}" data-ep-id="${escapeHtml(r.episode_id)}">
        <td class="exp-align-mono">${escapeHtml(r.episode_id)}</td>
        <td class="exp-align-mono" style="font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.run_id)}">${escapeHtml(r.run_id.slice(0, 12))}…</td>
        <td><span class="exp-align-badge">${escapeHtml(langs)}</span></td>
        <td style="white-space:nowrap;font-size:0.75rem;color:var(--text-muted)">${created}</td>
        <td>
          <div class="exp-align-actions">
            <button class="btn btn-secondary btn-sm align-export-btn" data-fmt="csv">CSV</button>
            <button class="btn btn-secondary btn-sm align-export-btn" data-fmt="tsv">TSV</button>
          </div>
          <div class="exp-result align-export-result" style="margin-top:4px"></div>
        </td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    <div style="overflow-x:auto">
      <table class="exp-align-table">
        <thead><tr>
          <th>Épisode</th>
          <th>Run ID</th>
          <th>Langues</th>
          <th>Date</th>
          <th>Export</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  body.querySelectorAll<HTMLTableRowElement>("tr[data-run-id]").forEach((row) => {
    const epId  = row.dataset.epId!;
    const runId = row.dataset.runId!;
    const result = row.querySelector<HTMLElement>(".align-export-result")!;

    row.querySelectorAll<HTMLButtonElement>(".align-export-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const fmt = btn.dataset.fmt as "csv" | "tsv";
        btn.disabled = true;
        result.textContent = "Export…";
        result.className = "exp-result visible";
        try {
          const res = await exportAlignments(epId, runId, fmt);
          result.textContent = `✓ ${res.rows} lignes → ${res.path}`;
          result.className = "exp-result visible ok";
        } catch (e) {
          result.textContent = formatApiError(e);
          result.className = "exp-result visible err";
        } finally {
          btn.disabled = false;
        }
      });
    });
  });
}

// ── SRT Enrichi tab ──────────────────────────────────────────────────────────

async function loadSrtTab(container: HTMLElement) {
  const body = container.querySelector<HTMLElement>("#exp-srt-body");
  if (!body) return;
  body.innerHTML = `<div style="color:var(--text-muted);font-size:0.82rem;padding:8px 0">Chargement des runs…</div>`;
  try {
    const { runs } = _alignRuns !== null
      ? { runs: _alignRuns }
      : await fetchAllAlignmentRuns();
    if (_alignRuns === null) _alignRuns = runs;
    renderSrtTab(body, runs);
  } catch (e) {
    body.innerHTML = `<div style="color:var(--danger);font-size:0.82rem">${formatApiError(e)}</div>`;
  }
}

function renderSrtTab(body: HTMLElement, runs: AlignmentRunFlat[]) {
  if (runs.length === 0) {
    body.innerHTML = `<div class="exp-card" style="max-width:520px">
      <div class="exp-card-title">Aucun run d'alignement</div>
      <div class="exp-card-desc">Définissez des personnages, créez des assignations, puis lancez un alignement pour utiliser cette fonctionnalité.</div>
    </div>`;
    return;
  }

  const info = `<div class="exp-srt-info">
    <strong>Propagation §8</strong> — Pour chaque run sélectionné, les noms de personnages sont
    injectés dans les cues SRT via les assignations et les liens d'alignement, puis les fichiers
    <code>.srt</code> du projet sont réécrits. Cette opération est <strong>non-destructive</strong> :
    seul le champ <code>text_clean</code> est modifié ; <code>text_raw</code> est conservé.
  </div>`;

  const rows = runs.map((r) => {
    const created = r.created_at
      ? new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
      : "—";
    const langsDisplay = [r.pivot_lang, ...r.target_langs].filter(Boolean).join(" → ");
    const langsData    = [r.pivot_lang, ...r.target_langs].filter(Boolean).join(",");
    return `
      <tr data-run-id="${escapeHtml(r.run_id)}" data-ep-id="${escapeHtml(r.episode_id)}" data-langs="${escapeHtml(langsData)}">
        <td class="exp-align-mono">${escapeHtml(r.episode_id)}</td>
        <td class="exp-align-mono" style="font-size:0.7rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.run_id)}">${escapeHtml(r.run_id.slice(0, 12))}…</td>
        <td><span class="exp-align-badge">${escapeHtml(langsDisplay)}</span></td>
        <td style="white-space:nowrap;font-size:0.75rem;color:var(--text-muted)">${created}</td>
        <td>
          <button class="btn btn-primary btn-sm srt-propagate-btn">✦ Propager</button>
          <div class="exp-srt-result-strip srt-propagate-result" style="display:none"></div>
        </td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    ${info}
    <div style="overflow-x:auto;margin-top:12px">
      <table class="exp-align-table">
        <thead><tr>
          <th>Épisode</th><th>Run ID</th><th>Langues</th><th>Date</th><th>Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  body.querySelectorAll<HTMLTableRowElement>("tr[data-run-id]").forEach((row) => {
    const epId   = row.dataset.epId!;
    const runId  = row.dataset.runId!;
    const langs  = (row.dataset.langs ?? "").split(",").filter(Boolean);
    const btn    = row.querySelector<HTMLButtonElement>(".srt-propagate-btn")!;
    const result = row.querySelector<HTMLElement>(".srt-propagate-result")!;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "…";
      result.style.display = "none";
      try {
        const res: PropagateResult = await propagateCharacters(epId, runId);
        result.textContent = `✓ ${res.nb_segments_updated} segments · ${res.nb_cues_updated} cues mis à jour`;
        result.className = "exp-srt-result-strip srt-propagate-result ok";
        result.style.display = "flex";
        btn.textContent = "✓ Propagé";
        // Afficher boutons de téléchargement SRT par langue
        _renderSrtDownloadBtns(row, epId, langs);
      } catch (e) {
        result.textContent = formatApiError(e);
        result.className = "exp-srt-result-strip srt-propagate-result err";
        result.style.display = "flex";
        btn.disabled = false;
        btn.textContent = "✦ Propager";
      }
    });
  });
}

function _renderSrtDownloadBtns(row: HTMLTableRowElement, epId: string, langs: string[]) {
  const cell = row.querySelector("td:last-child")!;
  const existing = cell.querySelector(".srt-dl-row");
  if (existing) existing.remove();
  if (!langs.length) return;
  const dlRow = document.createElement("div");
  dlRow.className = "srt-dl-row";
  dlRow.style.cssText = "display:flex;gap:6px;margin-top:6px;flex-wrap:wrap";
  langs.forEach((lang) => {
    const dlBtn = document.createElement("button");
    dlBtn.className = "btn btn-ghost btn-sm";
    dlBtn.textContent = `⬇ SRT ${lang.toUpperCase()}`;
    dlBtn.addEventListener("click", async () => {
      dlBtn.disabled = true;
      try {
        const src = await fetchEpisodeSource(epId, `srt_${lang}`) as SrtSourceContent;
        const blob = new Blob([src.content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${epId}_${lang}.${src.format ?? "srt"}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        dlBtn.textContent = `✗ SRT ${lang.toUpperCase()}`;
      } finally {
        dlBtn.disabled = false;
      }
    });
    dlRow.appendChild(dlBtn);
  });
  cell.appendChild(dlRow);
}
