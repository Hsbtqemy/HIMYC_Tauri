/**
 * concordancierModule.ts — Concordancier KWIC (MX-022/MX-023)
 *
 * Placeholder — implémentation complète dans MX-022 (backend /query)
 * et MX-023 (vue KWIC + recherche + filtres).
 */

import type { ShellContext } from "../context";
import { injectGlobalCss } from "../ui/dom";

let _unsubscribe: (() => void) | null = null;

export function mountConcordancier(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      height:100%; gap:1rem; color:var(--text-muted); text-align:center; padding:2rem;
    ">
      <div style="font-size:2.5rem">🔍</div>
      <div style="font-size:1rem; font-weight:600; color:var(--text)">Concordancier</div>
      <div style="font-size:0.85rem; max-width:360px; line-height:1.6">
        Recherche KWIC, filtres langue · épisode · personnage, export CSV/JSON/DOCX.<br>
        <span style="opacity:0.6">En cours de développement — MX-022 / MX-023.</span>
      </div>
    </div>`;

  _unsubscribe = ctx.onStatusChange(() => {});
}

export function disposeConcordancier() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
