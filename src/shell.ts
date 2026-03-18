/**
 * shell.ts — HIMYC Shell V0.1
 *
 * Shell Tauri HIMYC inspire de AGRAFES tauri-shell.
 *
 * - Header fixe 44px : brand + onglets (Constituer / Inspecter / Aligner) + statut API
 * - Couleurs d accent par mode (body[data-mode="..."])
 * - Lifecycle modules : mount / dispose par onglet actif
 * - Persistence localStorage : last_mode
 * - Healthcheck backend au demarrage + polling toutes les 30s
 * - Toast notification
 *
 * Layout (index.html) :
 *   #shell-header  fixe 44px
 *   #app           padding-top:44px — point de montage des modules
 */

import type { ShellContext, BackendStatus } from "./context.ts";
import { fetchHealth, API_BASE } from "./api.ts";
import { mountConstituer, disposeConstituer } from "./modules/constituerModule.ts";
import { mountInspecter, disposeInspecter } from "./modules/inspecterModule.ts";
import { mountAligner, disposeAligner } from "./modules/alignerModule.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "constituer" | "inspecter" | "aligner";

interface ModeConfig {
  label: string;
  badge: string;
  mount: (el: HTMLElement, ctx: ShellContext) => void;
  dispose: () => void;
}

const MODES: Record<Mode, ModeConfig> = {
  constituer: {
    label: "Constituer",
    badge: "corpus",
    mount: mountConstituer,
    dispose: disposeConstituer,
  },
  inspecter: {
    label: "Inspecter",
    badge: "source",
    mount: mountInspecter,
    dispose: disposeInspecter,
  },
  aligner: {
    label: "Aligner",
    badge: "alignement",
    mount: mountAligner,
    dispose: disposeAligner,
  },
};

const DEFAULT_MODE: Mode = "constituer";

// ─── CSS ──────────────────────────────────────────────────────────────────────

const SHELL_CSS = `
  :root {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1a1a2e;
  }
  body[data-mode="constituer"] {
    --accent:            #1a7f4e;
    --accent-header-bg:  #145a38;
  }
  body[data-mode="inspecter"] {
    --accent:            #2c5f9e;
    --accent-header-bg:  #1e4a80;
  }
  body[data-mode="aligner"] {
    --accent:            #7c3aed;
    --accent-header-bg:  #4c1d95;
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

  .shell-tabs {
    display: flex;
    height: 44px;
    gap: 0;
  }

  .shell-tab {
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    color: rgba(255,255,255,0.65);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0 1.15rem;
    height: 100%;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .shell-tab:hover {
    color: #fff;
    background: rgba(255,255,255,0.08);
  }
  .shell-tab.active {
    color: #fff;
    font-weight: 700;
    border-bottom-color: rgba(255,255,255,0.88);
    background: rgba(255,255,255,0.12);
  }
  .shell-tab-badge {
    font-size: 0.7rem;
    opacity: 0.5;
  }

  /* Statut API (droite du header) */
  .shell-api-zone {
    margin-left: auto;
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

let _currentMode: Mode = DEFAULT_MODE;
let _backendStatus: BackendStatus = { online: false };
const _statusListeners: Array<(s: BackendStatus) => void> = [];
let _pollInterval: ReturnType<typeof setInterval> | null = null;

// ─── ShellContext ─────────────────────────────────────────────────────────────

const shellContext: ShellContext = {
  getApiBase: () => API_BASE,
  getBackendStatus: () => ({ ..._backendStatus }),
  onStatusChange(cb) {
    _statusListeners.push(cb);
    return () => {
      const i = _statusListeners.indexOf(cb);
      if (i !== -1) _statusListeners.splice(i, 1);
    };
  },
};

function _setBackendStatus(status: BackendStatus) {
  _backendStatus = status;
  _statusListeners.forEach((cb) => cb({ ...status }));
  _updateApiDot();
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

let _headerEl: HTMLElement;
let _appEl: HTMLElement;
let _apiDot: HTMLElement;
let _apiLabel: HTMLElement;
let _toastEl: HTMLElement;
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Navigation ───────────────────────────────────────────────────────────────

function _navigateTo(mode: Mode) {
  if (mode === _currentMode && _appEl.childElementCount > 0) return;

  // Dispose module precedent
  MODES[_currentMode].dispose();

  _currentMode = mode;
  localStorage.setItem("himyc_last_mode", mode);
  document.body.dataset.mode = mode;

  // Mettre a jour les onglets
  _headerEl.querySelectorAll<HTMLButtonElement>(".shell-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  // Vider et monter le nouveau module
  _appEl.innerHTML = "";
  MODES[mode].mount(_appEl, shellContext);
}

// ─── Header ───────────────────────────────────────────────────────────────────

function _buildHeader() {
  // CSS
  const style = document.createElement("style");
  style.textContent = SHELL_CSS;
  document.head.appendChild(style);

  // Brand
  const brand = document.createElement("div");
  brand.className = "shell-brand";
  brand.textContent = "HIMYC";
  _headerEl.appendChild(brand);

  // Onglets
  const tabs = document.createElement("div");
  tabs.className = "shell-tabs";
  (Object.entries(MODES) as [Mode, ModeConfig][]).forEach(([key, cfg]) => {
    const btn = document.createElement("button");
    btn.className = "shell-tab" + (key === _currentMode ? " active" : "");
    btn.dataset.mode = key;
    btn.innerHTML = `${cfg.label} <span class="shell-tab-badge">${cfg.badge}</span>`;
    btn.addEventListener("click", () => _navigateTo(key));
    tabs.appendChild(btn);
  });
  _headerEl.appendChild(tabs);

  // Zone statut API
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
    if (!wasOnline) _toast("Backend HIMYC connecte");
  } catch {
    const wasOnline = _backendStatus.online;
    _setBackendStatus({ online: false });
    if (wasOnline) _toast("Backend HIMYC deconnecte");
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initShell() {
  _headerEl = document.getElementById("shell-header")!;
  _appEl = document.getElementById("app")!;

  // Restaurer le dernier mode
  const saved = localStorage.getItem("himyc_last_mode");
  if (saved && saved in MODES) _currentMode = saved as Mode;

  document.body.dataset.mode = _currentMode;

  _buildHeader();

  // Monter le module initial
  MODES[_currentMode].mount(_appEl, shellContext);

  // Healthcheck initial + polling 30s
  await _checkHealth();
  _pollInterval = setInterval(_checkHealth, 30_000);
}
