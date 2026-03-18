/**
 * features/metaPanel.ts — Panneau meta episode/source HIMYC.
 *
 * Adapte de AGRAFES tauri-app/src/features/metaPanel.ts@03a8790.
 * Modele de donnees remplace : QueryHit/doc_id/unit_id -> EpisodeSourceInfo.
 * Structure conservee : open/close, backdrop, sections, bouton copie.
 * Hors perimetre HIMYC (non portes) :
 *   - navigation prev/next dans les hits de recherche (pas de concordancier)
 *   - compteur "autres occurrences" (pas de state.hits)
 *   - contexte local via GET /unit/context (pas de segmentation unites)
 */

import { elt } from "../ui/dom.ts";
import { makeCopyBtn } from "../ui/copyUtils.ts";

// ─── Types HIMYC ──────────────────────────────────────────────────────────────

export interface EpisodeSourceInfo {
  episode_id: string;
  title: string;
  source_key: string;       // "transcript" | "srt_<lang>"
  language?: string;
  source_state?: string;    // "raw" | "normalized" | "segmented" | "ready_for_alignment"
  track_count?: number;     // nombre de pistes SRT disponibles pour cet episode
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _current: EpisodeSourceInfo | null = null;

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  /* Backdrop */
  #himyc-meta-backdrop {
    display: none;
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.35);
    z-index: 1000;
    cursor: pointer;
  }
  #himyc-meta-backdrop.open { display: block; }

  /* Panneau lateral droit */
  #himyc-meta-panel {
    position: fixed;
    top: 44px; right: 0; bottom: 0;
    width: 320px;
    background: var(--surface, #fff);
    border-left: 1px solid var(--border, #dee2e6);
    box-shadow: -4px 0 16px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
    z-index: 1001;
    transform: translateX(100%);
    transition: transform 0.22s ease;
  }
  #himyc-meta-panel.open { transform: translateX(0); }

  .meta-panel-head {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border, #dee2e6);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .meta-panel-title {
    flex: 1;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text, #212529);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-panel-close {
    background: none;
    border: none;
    font-size: 1.1rem;
    cursor: pointer;
    color: var(--text-muted, #6c757d);
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .meta-panel-close:hover { background: var(--surface2, #f8f9fa); }

  #himyc-meta-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
  }

  .meta-section-head {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, #6c757d);
    margin: 14px 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border, #dee2e6);
  }
  .meta-section-head:first-child { margin-top: 0; }

  .meta-field {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
  }
  .meta-lbl {
    color: var(--text-muted, #6c757d);
    min-width: 72px;
    flex-shrink: 0;
  }
  .meta-val {
    color: var(--text, #212529);
    font-family: ui-monospace, "SF Mono", monospace;
    word-break: break-all;
  }
  .meta-val.is-text {
    font-family: inherit;
    word-break: normal;
  }

  .meta-state-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    background: var(--surface2, #f8f9fa);
    border: 1px solid var(--border, #dee2e6);
    color: var(--text-muted, #6c757d);
  }
  .meta-state-badge.ready    { background: #dcfce7; border-color: #86efac; color: #166534; }
  .meta-state-badge.segmented { background: #dbeafe; border-color: #93c5fd; color: #1e40af; }
  .meta-state-badge.normalized { background: #fef9c3; border-color: #fde047; color: #854d0e; }
  .meta-state-badge.raw       { background: #f3f4f6; border-color: #d1d5db; color: #374151; }

  #himyc-meta-foot {
    padding: 10px 14px;
    border-top: 1px solid var(--border, #dee2e6);
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
`;

// ─── Init DOM ─────────────────────────────────────────────────────────────────

let _initialized = false;

function _ensurePanel(): void {
  if (_initialized) return;
  _initialized = true;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.id = "himyc-meta-backdrop";
  backdrop.addEventListener("click", closeMetaPanel);
  document.body.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.id = "himyc-meta-panel";
  panel.innerHTML = `
    <div class="meta-panel-head">
      <span class="meta-panel-title" id="himyc-meta-panel-title">Informations</span>
      <button class="meta-panel-close" id="himyc-meta-close" title="Fermer">✕</button>
    </div>
    <div id="himyc-meta-body"></div>
    <div id="himyc-meta-foot"></div>
  `;
  document.body.appendChild(panel);

  document.getElementById("himyc-meta-close")?.addEventListener("click", closeMetaPanel);
}

// ─── API publique ─────────────────────────────────────────────────────────────

export function openMetaPanel(info: EpisodeSourceInfo): void {
  _ensurePanel();
  _current = info;

  const panel   = document.getElementById("himyc-meta-panel");
  const backdrop = document.getElementById("himyc-meta-backdrop");
  const body    = document.getElementById("himyc-meta-body");
  const foot    = document.getElementById("himyc-meta-foot");
  const titleEl = document.getElementById("himyc-meta-panel-title");
  if (!panel || !backdrop || !body || !foot || !titleEl) return;

  titleEl.textContent = info.title || info.episode_id;
  _renderContent(info, body, foot);

  panel.classList.add("open");
  backdrop.classList.add("open");
}

export function closeMetaPanel(): void {
  document.getElementById("himyc-meta-panel")?.classList.remove("open");
  document.getElementById("himyc-meta-backdrop")?.classList.remove("open");
  _current = null;
}

export function getCurrentInfo(): EpisodeSourceInfo | null {
  return _current;
}

// ─── Rendu contenu ────────────────────────────────────────────────────────────

function _renderContent(
  info: EpisodeSourceInfo,
  body: HTMLElement,
  foot: HTMLElement,
): void {
  const field = (label: string, value: string, mono = true): HTMLElement => {
    const f = elt("div", { class: "meta-field" });
    f.appendChild(elt("span", { class: "meta-lbl" }, label));
    f.appendChild(elt("span", { class: `meta-val${mono ? "" : " is-text"}` }, value || "—"));
    return f;
  };

  body.innerHTML = "";
  foot.innerHTML = "";

  // ── Section Episode ──────────────────────────────────────────────────────────
  body.appendChild(elt("div", { class: "meta-section-head" }, "Episode"));
  body.appendChild(field("ID", info.episode_id));
  body.appendChild(field("Titre", info.title, false));
  if (info.track_count !== undefined) {
    body.appendChild(field("Pistes SRT", String(info.track_count)));
  }

  // ── Section Source ───────────────────────────────────────────────────────────
  body.appendChild(elt("div", { class: "meta-section-head" }, "Source active"));
  body.appendChild(field("Source", info.source_key));
  if (info.language) body.appendChild(field("Langue", info.language.toUpperCase()));

  if (info.source_state) {
    const stateRow = elt("div", { class: "meta-field" });
    stateRow.appendChild(elt("span", { class: "meta-lbl" }, "Etat"));
    const badge = elt("span", { class: `meta-state-badge ${info.source_state}` },
      _stateLabel(info.source_state));
    stateRow.appendChild(badge);
    body.appendChild(stateRow);
  }

  // ── Pied : actions ───────────────────────────────────────────────────────────
  foot.appendChild(makeCopyBtn(
    `${info.episode_id} — ${info.title}`,
    "📋 Copier ref",
  ));
}

function _stateLabel(state: string): string {
  switch (state) {
    case "raw":                   return "RAW";
    case "normalized":            return "Normalise";
    case "segmented":             return "Segmente";
    case "ready_for_alignment":   return "Pret alignement";
    default:                      return state;
  }
}
