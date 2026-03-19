/**
 * exporterModule.ts — Vue Exporter top-level (depuis hub tile) — L4
 *
 * Stage tabs : Corpus | Segments | QA | Jobs
 * KPI strip + gate banner QA + export jobs JSONL.
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import {
  runExport,
  fetchConfig,
  fetchQaReport,
  ApiError,
  type ExportResult,
  type QaReport,
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
`;

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;
let _qaPolicy: "lenient" | "strict" = "lenient";
let _qaData: QaReport | null = null;

export function mountExporter(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

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
              </div>
              <div class="exp-result" id="exp-segments-result"></div>
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
      result.textContent = e instanceof ApiError ? e.message : String(e);
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
  const scope  = btn.dataset.scope as "corpus" | "segments" | "jobs";
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
        : `${res.jobs ?? 0} jobs`;
    result.textContent = `✓ ${count} → ${res.path}`;
    result.className = "exp-result visible ok";
  } catch (e) {
    result.textContent = e instanceof ApiError ? e.message : String(e);
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
    gateText.textContent = e instanceof ApiError ? `${e.errorCode} — ${e.message}` : String(e);
  }
}

export function disposeExporter() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _qaData = null;
}
