/**
 * inspecterModule.ts — Mode Inspecter (placeholder MX-002)
 *
 * Placeholder operationnel pour le smoke test de navigation.
 * Contenu reel : MX-007 (Vue Inspecter source-centric zone unique).
 */

import type { ShellContext } from "../context.ts";

const CSS = `
  .mod-inspecter-placeholder {
    padding: 2rem;
    max-width: 640px;
    margin: 0 auto;
  }
  .mod-inspecter-placeholder h1 {
    font-size: 1.4rem;
    font-weight: 700;
    color: #1a1a2e;
    margin: 0 0 0.5rem;
  }
  .mod-inspecter-placeholder p {
    color: #6b7280;
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
  .mod-inspecter-placeholder ul {
    color: #374151;
    font-size: 0.875rem;
    padding-left: 1.2rem;
    line-height: 1.7;
  }
`;

let _styleEl: HTMLStyleElement | null = null;
let _unsubscribe: (() => void) | null = null;

export function mountInspecter(container: HTMLElement, ctx: ShellContext) {
  if (!_styleEl) {
    _styleEl = document.createElement("style");
    _styleEl.textContent = CSS;
    document.head.appendChild(_styleEl);
  }

  container.innerHTML = `
    <div class="mod-inspecter-placeholder">
      <h1>Inspecter</h1>
      <p>Zone de travail unique pilotee par Episode + Source (transcript ou SRT).</p>
      <ul>
        <li>Selecteur Episode + Source — <em>MX-007</em></li>
        <li>Zone unique RAW / CLEAN / SRT selon source active — <em>MX-007</em></li>
        <li>Actions contextuelles (Normaliser, Decouper) selon source — <em>MX-007</em></li>
        <li>Gardes metier et coherence CTA — <em>MX-008</em></li>
      </ul>
    </div>
  `;

  // Pas d abonnement statut necessaire pour ce placeholder.
  void ctx;
  _unsubscribe = null;
}

export function disposeInspecter() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
