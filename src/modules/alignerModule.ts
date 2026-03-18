/**
 * alignerModule.ts — Mode Aligner (placeholder MX-002)
 *
 * Placeholder operationnel pour le smoke test de navigation.
 * Contenu reel : MX-009 (Handoff vers Aligner) + MX-010 (parite messages).
 */

import type { ShellContext } from "../context.ts";

const CSS = `
  .mod-aligner-placeholder {
    padding: 2rem;
    max-width: 640px;
    margin: 0 auto;
  }
  .mod-aligner-placeholder h1 {
    font-size: 1.4rem;
    font-weight: 700;
    color: #1a1a2e;
    margin: 0 0 0.5rem;
  }
  .mod-aligner-placeholder p {
    color: #6b7280;
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
  .mod-aligner-placeholder ul {
    color: #374151;
    font-size: 0.875rem;
    padding-left: 1.2rem;
    line-height: 1.7;
  }
`;

let _styleEl: HTMLStyleElement | null = null;
let _unsubscribe: (() => void) | null = null;

export function mountAligner(container: HTMLElement, ctx: ShellContext) {
  if (!_styleEl) {
    _styleEl = document.createElement("style");
    _styleEl.textContent = CSS;
    document.head.appendChild(_styleEl);
  }

  container.innerHTML = `
    <div class="mod-aligner-placeholder">
      <h1>Aligner</h1>
      <p>Lancement et suivi des alignements transcript-first et srt-only.</p>
      <ul>
        <li>Handoff depuis Inspecter (episode_id + source_key + segment_kind) — <em>MX-009</em></li>
        <li>Alignement transcript-first — <em>MX-009</em></li>
        <li>Alignement srt-only — <em>MX-009</em></li>
        <li>Messages et preconditions harmonises — <em>MX-010</em></li>
      </ul>
    </div>
  `;

  void ctx;
  _unsubscribe = null;
}

export function disposeAligner() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
