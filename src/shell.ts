/**
 * shell.ts — HIMYC Shell V0.3 (MX-035)
 *
 * Navigation restructurée AGRAFES x HIMYC :
 * - Hub (landing) → Concordancier · Constituer · Exporter
 * - Sous-vue « Aligner » uniquement (pas d'onglet top-level) — pas de module Inspecter au shell
 * - Header : brand + [nav tabs] + [zone projet] + statut API
 * - Zone projet : badge "📁 <nom>" + bouton "Changer…" (Tauri seulement)
 * - Couleurs d'accent par mode
 * - Lifecycle modules : mount / dispose
 * - À chaque ouverture d’app : **hub** (pas de restauration du dernier mode)
 * - Healthcheck + polling 30s
 * - Sidebar : rail icônes (toujours visible) ; survol ou focus clavier déplie libellés (Explorer · Préparer · Exporter)
 */

import type { ShellContext, BackendStatus, AlignerHandoff } from "./context.ts";
import { fetchHealth, API_BASE } from "./api.ts";

const IS_TAURI = import.meta.env.VITE_E2E !== "true" && "__TAURI_INTERNALS__" in window;
import { mountHub,           disposeHub }           from "./modules/hubModule.ts";
import { mountConcordancier, disposeConcordancier } from "./modules/concordancierModule.ts";
import { mountConstituer,    disposeConstituer }    from "./modules/constituerModule.ts";
import { mountExporter,      disposeExporter }      from "./modules/exporterModule.ts";
import { mountAligner,       disposeAligner }       from "./modules/alignerModule.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Modes top-level affichés dans la nav */
type NavMode = "concordancier" | "constituer" | "exporter";
/** Tous les modes possibles (hub + nav + sous-vues) */
type Mode = "hub" | NavMode | "aligner";

interface ModeConfig {
  mount:   (el: HTMLElement, ctx: ShellContext) => void;
  dispose: () => void;
}

const MODE_CONFIGS: Record<Mode, ModeConfig> = {
  hub:           { mount: mountHub,           dispose: disposeHub },
  concordancier: { mount: mountConcordancier, dispose: disposeConcordancier },
  constituer:    { mount: mountConstituer,    dispose: disposeConstituer },
  exporter:      { mount: mountExporter,      dispose: disposeExporter },
  aligner:       { mount: mountAligner,       dispose: disposeAligner },
};

const NAV_MODES: Array<{ mode: NavMode; label: string; badge: string }> = [
  { mode: "concordancier", label: "Concordancier", badge: "KWIC" },
  { mode: "constituer",    label: "Constituer",    badge: "corpus" },
  { mode: "exporter",      label: "Exporter",      badge: "export" },
];

// Modes de sous-vue : pas d'onglet, retour vers constituer
const SUB_VIEWS = new Set<Mode>(["aligner"]);
// Accent couleur par mode
const MODE_ACCENT: Partial<Record<Mode, string>> = {
  hub:           "#1a1a2e",
  concordancier: "#2c5f9e",
  constituer:    "#1a7f4e",
  exporter:      "#b45309",
  aligner:       "#7c3aed",
};
const MODE_ACCENT_HEADER: Partial<Record<Mode, string>> = {
  hub:           "#1a1a2e",
  concordancier: "#1e4a80",
  constituer:    "#145a38",
  exporter:      "#92400e",
  aligner:       "#4c1d95",
};

// ─── CSS ──────────────────────────────────────────────────────────────────────

const SHELL_CSS = `
  :root {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1a1a2e;
    --shell-rail-w:           52px;
    --shell-sidebar-expanded-w: 192px;
  }

  #shell-header {
    background: var(--accent-header-bg);
    display: flex;
    align-items: center;
    padding: 0;
    gap: 0;
    transition: background 0.22s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.18);
  }

  .shell-brand {
    font-size: 0.95rem;
    font-weight: 700;
    color: #fff;
    cursor: default;
    user-select: none;
    letter-spacing: 0.5px;
    padding: 0 1rem;
    height: 44px;
    display: flex;
    align-items: center;
    border-right: 1px solid rgba(255,255,255,0.15);
    margin-right: 0.25rem;
  }

  /* ── Sidebar : rail icônes + dépliage au survol / focus ─────── */
  #shell-sidebar {
    position: fixed;
    top: 44px;
    left: 0;
    bottom: 0;
    width: var(--shell-rail-w);
    z-index: 9990;
    background: #12151f;
    border-right: 1px solid rgba(255,255,255,0.07);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.22s ease, box-shadow 0.22s ease;
  }
  #shell-sidebar:hover,
  #shell-sidebar:focus-within {
    width: var(--shell-sidebar-expanded-w);
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.28);
    z-index: 10050;
  }

  #app {
    transition: padding-left 0.22s ease;
  }

  .sidebar-section-label {
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.22);
    padding: 0 0.9rem;
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    flex-shrink: 0;
    transition: max-height 0.2s ease, opacity 0.18s ease, padding 0.2s ease;
  }
  #shell-sidebar:hover .sidebar-section-label,
  #shell-sidebar:focus-within .sidebar-section-label {
    max-height: 3rem;
    opacity: 1;
    padding: 0.9rem 0.9rem 0.3rem;
  }

  .sidebar-nav-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.62rem 0.9rem;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    font-size: 0.83rem;
    font-family: inherit;
    border: none;
    background: none;
    width: 100%;
    min-width: 0;
    text-align: left;
    box-shadow: inset 3px 0 0 transparent;
    transition: color 0.14s, background 0.14s, box-shadow 0.14s, justify-content 0.18s ease;
    user-select: none;
  }
  /* Rail replié : icône seule, centrée sur toute la largeur de colonne */
  #shell-sidebar:not(:hover):not(:focus-within) .sidebar-nav-item {
    justify-content: center;
    gap: 0;
    padding: 0.62rem 0;
    box-shadow: inset 3px 0 0 transparent;
  }
  #shell-sidebar:not(:hover):not(:focus-within) .sidebar-nav-item.active {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .sidebar-nav-item:hover {
    color: rgba(255,255,255,0.9);
    background: rgba(255,255,255,0.06);
  }
  .sidebar-nav-item.active {
    color: #fff;
    font-weight: 600;
    background: rgba(255,255,255,0.09);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .sidebar-nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    font-size: 1.05rem;
    line-height: 1;
  }
  .sidebar-nav-text {
    display: inline-block;
    overflow: hidden;
    white-space: nowrap;
    max-width: 0;
    min-width: 0;
    opacity: 0;
    transition: max-width 0.22s ease, opacity 0.16s ease;
  }
  #shell-sidebar:hover .sidebar-nav-text,
  #shell-sidebar:focus-within .sidebar-nav-text {
    max-width: 200px;
    opacity: 1;
  }
  .sidebar-spacer { flex: 1; }

  /* Bouton retour (sous-vues) */
  .shell-back-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.75);
    font-size: 0.8rem;
    padding: 0 0.9rem;
    height: 44px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    transition: color 0.15s;
    border-right: 1px solid rgba(255,255,255,0.12);
    margin-right: 0.25rem;
  }
  .shell-back-btn:hover { color: #fff; }

  /* Breadcrumb sous-vue */
  .shell-breadcrumb {
    font-size: 0.78rem;
    color: rgba(255,255,255,0.5);
    padding: 0 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .shell-breadcrumb-current {
    color: rgba(255,255,255,0.9);
    font-weight: 600;
  }

  /* Zone projet (avant le statut API) */
  .shell-project-zone {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.9rem;
    height: 44px;
    border-left: 1px solid rgba(255,255,255,0.12);
    min-width: 0;
    max-width: 260px;
  }
  .shell-project-name {
    font-size: 0.72rem;
    color: rgba(255,255,255,0.7);
    font-family: ui-monospace, "SF Mono", monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .shell-project-name.none {
    color: rgba(255,255,255,0.35);
    font-style: italic;
  }
  .shell-project-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.8);
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }
  .shell-project-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
  .shell-project-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Statut API (droite du header) */
  .shell-api-zone {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.9rem;
    height: 44px;
    border-left: 1px solid rgba(255,255,255,0.12);
  }
  .shell-api-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6b7280;
    transition: background 0.3s;
    flex-shrink: 0;
  }
  .shell-api-dot.online  { background: #34d399; }
  .shell-api-dot.offline { background: #f87171; animation: pulse-err 1.5s infinite; }
  @keyframes pulse-err {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  .shell-api-label {
    font-size: 0.72rem;
    color: rgba(255,255,255,0.55);
    font-family: ui-monospace, "SF Mono", monospace;
    white-space: nowrap;
  }

  /* Toast */
  .shell-toast {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%) translateY(12px);
    background: #1a1a2e;
    color: #fff;
    font-size: 0.83rem;
    padding: 0.5rem 1.1rem;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    opacity: 0;
    transition: opacity 0.22s, transform 0.22s;
    pointer-events: none;
    z-index: 99999;
  }
  .shell-toast.visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
`;

// ─── State ────────────────────────────────────────────────────────────────────

let _currentMode: Mode = "hub";
let _prevNavMode: NavMode = "constituer"; // mode nav à restaurer au retour d'une sous-vue
let _backendStatus: BackendStatus = { online: false };
const _statusListeners: Array<(s: BackendStatus) => void> = [];
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _handoff: AlignerHandoff | null = null;

// ─── ShellContext ─────────────────────────────────────────────────────────────

const shellContext: ShellContext = {
  getApiBase:       () => API_BASE,
  getBackendStatus: () => ({ ..._backendStatus }),
  onStatusChange(cb) {
    _statusListeners.push(cb);
    return () => {
      const i = _statusListeners.indexOf(cb);
      if (i !== -1) _statusListeners.splice(i, 1);
    };
  },
  navigateTo(mode) { _navigateTo(mode as Mode); },
  setHandoff(data)  { _handoff = data; },
  getHandoff()      { const h = _handoff; _handoff = null; return h; },
  changeProject()   { void _changeProject(); },
};

function _setBackendStatus(status: BackendStatus) {
  _backendStatus = status;
  _statusListeners.forEach((cb) => cb({ ...status }));
  _updateApiDot();
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

let _headerEl: HTMLElement;
let _sidebarEl: HTMLElement;
let _appEl: HTMLElement;
let _apiDot: HTMLElement;
let _apiLabel: HTMLElement;
let _projectLabel: HTMLElement;
let _projectBtn: HTMLButtonElement;
let _toastEl: HTMLElement;
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Gestion projet ───────────────────────────────────────────────────────────

let _currentProjectPath: string | null = null;

function _pathBasename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

function _updateProjectBadge(path: string | null) {
  _currentProjectPath = path;
  if (!_projectLabel) return;
  if (path) {
    _projectLabel.textContent = "📁 " + _pathBasename(path);
    _projectLabel.classList.remove("none");
  } else {
    _projectLabel.textContent = "aucun projet";
    _projectLabel.classList.add("none");
  }
}

async function _changeProject() {
  if (!IS_TAURI) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");

  const selected = await openDialog({ directory: true, title: "Choisir le dossier projet HIMYC" });
  if (!selected) return;
  const path = typeof selected === "string" ? selected : (selected as string[])[0];
  if (!path) return;

  _projectBtn.disabled = true;
  _projectBtn.textContent = "…";
  try {
    await invoke("set_project_path", { path });
    // Attendre que le backend réponde
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await fetchHealth();
        ready = true;
        break;
      } catch { /* pas encore prêt */ }
    }
    if (ready) {
      _updateProjectBadge(path);
      _toast("Projet changé : " + _pathBasename(path));
      await _checkHealth();
      // Recharger le module courant pour refléter le nouveau projet
      _navigateTo("hub");
    } else {
      _toast("Backend non disponible après changement de projet");
    }
  } catch (e) {
    _toast("Erreur : " + String(e));
  } finally {
    _projectBtn.disabled = false;
    _projectBtn.textContent = "Changer…";
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────

/** Après clic sur la nav, le bouton garde le focus → :focus-within garde la sidebar ouverte ; on retire le focus pour retrouver le rail icônes (sauf si la souris survole encore la barre). */
function _blurSidebarFocus() {
  queueMicrotask(() => {
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && _sidebarEl?.contains(ae)) ae.blur();
  });
}

function _navigateTo(mode: Mode) {
  if (mode === _currentMode && _appEl.childElementCount > 0) {
    _blurSidebarFocus();
    return;
  }

  MODE_CONFIGS[_currentMode].dispose();

  // Mémoriser le mode nav précédent avant d'entrer en sous-vue
  if (!SUB_VIEWS.has(mode) && mode !== "hub") {
    _prevNavMode = mode as NavMode;
  }

  _currentMode = mode;

  // Accent couleur
  const accent       = MODE_ACCENT[mode]       ?? "#2c5f9e";
  const accentHeader = MODE_ACCENT_HEADER[mode] ?? "#1a1a2e";
  document.documentElement.style.setProperty("--accent",           accent);
  document.documentElement.style.setProperty("--accent-header-bg", accentHeader);
  if (_headerEl) _headerEl.style.background = accentHeader;

  _rebuildNav();

  _appEl.innerHTML = "";
  MODE_CONFIGS[mode].mount(_appEl, shellContext);

  _blurSidebarFocus();
}

// ─── Header ───────────────────────────────────────────────────────────────────

function _rebuildNav() {
  // ── Sidebar : mettre à jour l'item actif ──────────────────────────────────
  if (_sidebarEl) {
    _sidebarEl.querySelectorAll<HTMLElement>(".sidebar-nav-item").forEach((item) => {
      const active = item.dataset.mode === _currentMode
        || (SUB_VIEWS.has(_currentMode) && item.dataset.mode === _prevNavMode);
      item.classList.toggle("active", active);
    });
  }

  // ── Header : back button pour les sous-vues uniquement ───────────────────
  const brand       = _headerEl.querySelector<HTMLElement>(".shell-brand")!;
  const projectZone = _headerEl.querySelector<HTMLElement>(".shell-project-zone");
  const apiZone     = _headerEl.querySelector<HTMLElement>(".shell-api-zone")!;
  const insertBefore = projectZone ?? apiZone;

  // Supprimer les éléments de nav du header (back btn + breadcrumb)
  Array.from(_headerEl.children).forEach((child) => {
    if (child !== brand && child !== projectZone && child !== apiZone) child.remove();
  });

  if (SUB_VIEWS.has(_currentMode)) {
    const backBtn = document.createElement("button");
    backBtn.className = "shell-back-btn";
    backBtn.innerHTML = "← Retour";
    backBtn.addEventListener("click", () => _navigateTo(_prevNavMode));
    _headerEl.insertBefore(backBtn, insertBefore);

    const breadcrumb = document.createElement("div");
    breadcrumb.className = "shell-breadcrumb";
    const modeLabel = "Aligner";
    const pm = _prevNavMode as string;
    const parentShellLabel =
      pm === "concordancier" ? "Explorer"
      : pm === "constituer" ? "Préparer"
      : pm === "exporter" ? "Exporter"
      : pm.charAt(0).toUpperCase() + pm.slice(1);
    breadcrumb.innerHTML = `${parentShellLabel} <span style="opacity:0.4">›</span> <span class="shell-breadcrumb-current">${modeLabel}</span>`;
    _headerEl.insertBefore(breadcrumb, insertBefore);
  }
}

const SIDEBAR_ITEMS: Array<{ mode: NavMode; icon: string; label: string }> = [
  { mode: "concordancier", icon: "🔍", label: "Explorer" },
  { mode: "constituer",    icon: "📂", label: "Préparer" },
  { mode: "exporter",      icon: "📤", label: "Exporter" },
];

function _buildSidebar() {
  const label = document.createElement("div");
  label.className = "sidebar-section-label";
  label.textContent = "Navigation";
  _sidebarEl.appendChild(label);

  SIDEBAR_ITEMS.forEach(({ mode, icon, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sidebar-nav-item";
    btn.dataset.mode = mode;
    btn.title = label;
    btn.innerHTML = `<span class="sidebar-nav-icon" aria-hidden="true">${icon}</span><span class="sidebar-nav-text">${label}</span>`;
    btn.addEventListener("click", () => _navigateTo(mode));
    _sidebarEl.appendChild(btn);
  });

  _sidebarEl.appendChild(Object.assign(document.createElement("div"), { className: "sidebar-spacer" }));
}

function _buildHeader() {
  const style = document.createElement("style");
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);

  // Brand — cliquable pour revenir au hub
  const brand = document.createElement("div");
  brand.className = "shell-brand";
  brand.textContent = "HIMYC";
  brand.style.cursor = "pointer";
  brand.addEventListener("click", () => _navigateTo("hub"));
  _headerEl.appendChild(brand);

  // Zone projet (Tauri seulement)
  if (IS_TAURI) {
    const projectZone = document.createElement("div");
    projectZone.className = "shell-project-zone";
    _projectLabel = document.createElement("span");
    _projectLabel.className = "shell-project-name none";
    _projectLabel.textContent = "aucun projet";
    _projectBtn = document.createElement("button");
    _projectBtn.className = "shell-project-btn";
    _projectBtn.textContent = "Changer…";
    _projectBtn.addEventListener("click", _changeProject);
    projectZone.appendChild(_projectLabel);
    projectZone.appendChild(_projectBtn);
    _headerEl.appendChild(projectZone);
  }

  // Zone statut API (toujours à droite)
  const apiZone = document.createElement("div");
  apiZone.className = "shell-api-zone";
  _apiDot = document.createElement("div");
  _apiDot.className = "shell-api-dot";
  _apiLabel = document.createElement("span");
  _apiLabel.className = "shell-api-label";
  _apiLabel.textContent = "API…";
  apiZone.appendChild(_apiDot);
  apiZone.appendChild(_apiLabel);
  _headerEl.appendChild(apiZone);

  // Toast
  _toastEl = document.createElement("div");
  _toastEl.className = "shell-toast";
  document.body.appendChild(_toastEl);

  // Nav initiale
  _rebuildNav();
}

function _updateApiDot() {
  if (!_apiDot) return;
  _apiDot.className = "shell-api-dot " + (_backendStatus.online ? "online" : "offline");
  _apiLabel.textContent = _backendStatus.online
    ? `v${_backendStatus.version ?? "?"}`
    : "API hors ligne";
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function _toast(msg: string) {
  _toastEl.textContent = msg;
  _toastEl.classList.add("visible");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => _toastEl.classList.remove("visible"), 2800);
}

// ─── Healthcheck ──────────────────────────────────────────────────────────────

async function _checkHealth() {
  try {
    const h = await fetchHealth();
    const wasOnline = _backendStatus.online;
    _setBackendStatus({ online: true, version: h.version });
    if (!wasOnline) _toast("Backend HIMYC connecté");
  } catch {
    const wasOnline = _backendStatus.online;
    _setBackendStatus({ online: false });
    if (wasOnline) _toast("Backend HIMYC déconnecté");
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initShell() {
  _headerEl  = document.getElementById("shell-header")!;
  _sidebarEl = document.getElementById("shell-sidebar")!;
  _appEl     = document.getElementById("app")!;

  // Toujours démarrer sur le hub (pas de restauration du dernier mode)
  _buildHeader();
  _buildSidebar();

  _rebuildNav();
  MODE_CONFIGS[_currentMode].mount(_appEl, shellContext);

  // Initialiser le badge projet (Tauri seulement)
  if (IS_TAURI) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string | null>("get_project_path");
      _updateProjectBadge(path);
    } catch { /* ignore */ }
  }

  await _checkHealth();
  _pollInterval = setInterval(_checkHealth, 30_000);
}
