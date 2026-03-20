/**
 * ui/dom.ts — Utilitaires DOM et tokens CSS globaux.
 *
 * Porte de AGRAFES tauri-app/src/ui/dom.ts@03a8790.
 * Adapte pour HIMYC : tokens generiques conserves, layout AGRAFES-specifique
 * (topbar, toolbar, concordancier, KWIC) retire. Delta 03a8790 inclus :
 * .meta-aligned-group, .meta-copy-micro, .parallel-group-copy-btn.
 */

// ─── DOM helpers ──────────────────────────────────────────────────────────────

export function elt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (string | HTMLElement)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Injection CSS globale ─────────────────────────────────────────────────────

let _injected = false;

export function injectGlobalCss(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement("style");
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}

const GLOBAL_CSS = `
/* ─── Design tokens ─────────────────────────────────────────────────── */
:root {
  --brand:         #4361ee;
  --brand-dark:    #3a56d4;
  --surface:       #ffffff;
  --surface2:      #f8f9fa;
  --border:        #dee2e6;
  --text:          #212529;
  --text-muted:    #6c757d;
  --danger:        #e63946;
  --success:       #2dc653;
  --warning:       #f4a261;
  --radius:        10px;
  --shadow:        0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08);
  --bg:            var(--surface);
}

* { box-sizing: border-box; }

body { font-size: 14px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }

/* ─── Boutons generiques (AGRAFES-aligned) ───────────────────────────── */
.btn {
  padding: 0.35rem 0.9rem;
  border: 1.5px solid transparent;
  border-radius: var(--radius);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s, color .15s;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-sm { padding: 0.2rem 0.55rem; font-size: 0.78rem; }
.btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }

.btn-primary { background: var(--brand); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--brand-dark); }

.btn-secondary { background: var(--surface2); color: var(--text); border-color: var(--border); }
.btn-secondary:hover:not(:disabled) { background: var(--border); }
.btn-secondary.active { background: var(--brand); color: #fff; border-color: var(--brand); }

.btn-ghost { background: transparent; color: var(--text-muted); border-color: var(--border); }
.btn-ghost:hover:not(:disabled) { background: var(--surface2); color: var(--text); }

.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover:not(:disabled) { background: #c62828; }

/* ─── Focus visible (AGRAFES-aligned) ───────────────────────────────── */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[role="button"]:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

/* ─── Status dot ─────────────────────────────────────────────────────── */
.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.starting { background: var(--warning); animation: himyc-pulse 1s infinite; }
.status-dot.ready    { background: var(--success); }
.status-dot.error    { background: var(--danger); }
.status-dot.idle     { background: rgba(0,0,0,.2); }
@keyframes himyc-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: .4; }
}

/* ─── Delta 03a8790 : boutons copie et groupes alignes ──────────────── */

/* Petit bouton copie inline dans les panneaux meta */
.meta-copy-micro {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
  line-height: 1;
}
.meta-copy-micro:hover { color: var(--brand); border-color: var(--brand); }

/* Petit bouton copie icone dans les entetes de groupes alignes */
.parallel-group-copy-btn {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid transparent;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.15s, border-color 0.15s;
  line-height: 1;
}
.parallel-lang-header:hover .parallel-group-copy-btn,
.parallel-group-copy-btn:focus-visible {
  opacity: 1;
  border-color: var(--border);
}

/* Groupes aligne dans le panneau meta */
.meta-aligned-group {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
}
.meta-aligned-group + .meta-aligned-group { margin-top: 6px; }
.meta-aligned-group-header {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
}
.meta-aligned-group-title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta-aligned-row {
  line-height: 1.5;
  color: var(--text);
  word-break: break-word;
}
.meta-aligned-ref {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
}
`;
