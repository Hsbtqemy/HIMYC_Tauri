/**
 * exporterModule.ts — Vue Exporter top-level (depuis hub tile)
 *
 * Corpus (TXT/CSV/JSON/DOCX) + Segments (TXT/CSV/TSV).
 * Partage le endpoint POST /export avec la section Exporter de Constituer.
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { runExport, fetchConfig, ApiError, type ExportResult } from "../api";

const CSS = `
.exp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface2);
  overflow-y: auto;
}
.exp-header {
  padding: 1.5rem 2rem 0.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.exp-header h2 {
  margin: 0 0 0.2rem;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
}
.exp-header-sub {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.exp-body {
  flex: 1;
  padding: 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 760px;
}
.exp-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 600px) { .exp-card-grid { grid-template-columns: 1fr; } }
.exp-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem;
}
.exp-card:hover { box-shadow: 0 2px 6px rgba(0,0,0,.12); }
.exp-card-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 0.5rem;
}
.exp-card-desc {
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 0.75rem;
}
.exp-fmt-row { display: flex; gap: 6px; flex-wrap: wrap; }
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
.exp-result.ok  { color: var(--success, #16a34a); background: #f0fdf4; }
.exp-result.err { color: var(--danger,  #dc2626); background: #fef2f2; }
.exp-footer {
  font-size: 0.76rem;
  color: var(--text-muted);
  line-height: 1.6;
  padding: 0 2rem 1.5rem;
  max-width: 760px;
}
.exp-project-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
}
`;

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;

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
        <h2>📤 Exporter</h2>
        <div class="exp-header-sub" id="exp-project-info">Chargement projet…</div>
      </div>

      <div class="exp-body">
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

      <div class="exp-footer">
        Les fichiers sont écrits dans le dossier <code>exports/</code> du projet.
      </div>
    </div>`;

  // Project info
  if (ctx.getBackendStatus().online) {
    fetchConfig().then((cfg) => {
      const el = container.querySelector<HTMLElement>("#exp-project-info");
      if (el) el.innerHTML = `<span class="exp-project-badge">📁 ${escapeHtml(cfg.project_name)}</span>`;
    }).catch(() => {});
  }

  // Export buttons
  container.querySelectorAll<HTMLButtonElement>(".exp-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scope  = btn.dataset.scope as "corpus" | "segments";
      const fmt    = btn.dataset.fmt!;
      const result = container.querySelector<HTMLElement>(`#exp-${scope}-result`)!;

      btn.disabled = true;
      result.textContent = "Export en cours…";
      result.className = "exp-result visible";

      try {
        const res: ExportResult = await runExport(scope, fmt);
        const count = res.episodes != null ? `${res.episodes} épisodes` : `${res.segments} segments`;
        result.textContent = `✓ ${count} → ${res.path}`;
        result.className = "exp-result visible ok";
      } catch (e) {
        result.textContent = e instanceof ApiError ? e.message : String(e);
        result.className = "exp-result visible err";
      } finally {
        btn.disabled = false;
      }
    });
  });

  _unsubscribe = ctx.onStatusChange(() => {});
}

export function disposeExporter() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
