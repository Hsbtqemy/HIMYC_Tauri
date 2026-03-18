/**
 * constituerModule.ts — Mode Constituer (placeholder MX-002)
 *
 * Placeholder operationnel pour le smoke test de navigation.
 * Contenu reel : MX-005 (Vue Constituer episodes + import).
 */

import type { ShellContext } from "../context.ts";

const CSS = `
  .mod-placeholder {
    padding: 2rem;
    max-width: 640px;
    margin: 0 auto;
  }
  .mod-placeholder h1 {
    font-size: 1.4rem;
    font-weight: 700;
    color: #1a1a2e;
    margin: 0 0 0.5rem;
  }
  .mod-placeholder p {
    color: #6b7280;
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
  .mod-placeholder ul {
    color: #374151;
    font-size: 0.875rem;
    padding-left: 1.2rem;
    line-height: 1.7;
  }
  .mod-api-status {
    margin-top: 1rem;
    padding: 0.6rem 0.9rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-family: ui-monospace, "SF Mono", monospace;
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #e5e7eb;
  }
  .mod-api-status.online  { background: #ecfdf5; border-color: #6ee7b7; color: #065f46; }
  .mod-api-status.offline { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
`;

let _styleEl: HTMLStyleElement | null = null;
let _unsubscribe: (() => void) | null = null;

export function mountConstituer(container: HTMLElement, ctx: ShellContext) {
  if (!_styleEl) {
    _styleEl = document.createElement("style");
    _styleEl.textContent = CSS;
    document.head.appendChild(_styleEl);
  }

  container.innerHTML = `
    <div class="mod-placeholder">
      <h1>Constituer</h1>
      <p>Importez et organisez les corpus par episode (transcript + SRT multi-langues).</p>
      <ul>
        <li>Table episodes + colonnes sources — <em>MX-005</em></li>
        <li>Import transcript / SRT — <em>MX-005</em></li>
        <li>Statut de completion par episode — <em>MX-005</em></li>
        <li>Jobs batch (normalisation, queue, reprise) — <em>MX-006</em></li>
      </ul>
      <div class="mod-api-status" id="constituer-api-status">Verification backend…</div>
    </div>
  `;

  const statusEl = container.querySelector<HTMLElement>("#constituer-api-status")!;

  function updateStatus(s: { online: boolean; version?: string }) {
    statusEl.className = "mod-api-status " + (s.online ? "online" : "offline");
    statusEl.textContent = s.online
      ? `Backend HIMYC v${s.version ?? "?"} — http://localhost:8765`
      : "Backend HIMYC hors ligne — lancez : uvicorn howimetyourcorpus.api.server:app --port 8765";
  }

  updateStatus(ctx.getBackendStatus());
  _unsubscribe = ctx.onStatusChange(updateStatus);
}

export function disposeConstituer() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
