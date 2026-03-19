/**
 * hubModule.ts — Hub d'entrée HIMYC (MX-020)
 *
 * Landing page avec 3 tuiles de navigation :
 * Concordancier · Constituer · Exporter
 */

import type { ShellContext } from "../context";
import { injectGlobalCss } from "../ui/dom";
import { fetchConfig } from "../api";

const CSS = `
.hub-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--bg);
  gap: 2.5rem;
  padding: 2rem;
}

.hub-title {
  text-align: center;
}
.hub-title h1 {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 0.35rem 0;
  letter-spacing: -0.5px;
}
.hub-title p {
  font-size: 0.88rem;
  color: var(--text-muted);
  margin: 0;
}

.hub-tiles {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
  justify-content: center;
}

.hub-tile {
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: calc(var(--radius) * 2);
  padding: 1.75rem 2rem;
  width: 200px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  text-align: left;
  user-select: none;
}
.hub-tile:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 18px rgba(0,0,0,0.12);
  transform: translateY(-2px);
}
.hub-tile:active {
  transform: translateY(0);
}

.hub-tile-icon {
  font-size: 1.6rem;
  line-height: 1;
}
.hub-tile-label {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}
.hub-tile-desc {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.hub-status {
  font-size: 0.75rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.hub-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6b7280;
  flex-shrink: 0;
  transition: background 0.3s;
}
.hub-status-dot.online  { background: #34d399; }
.hub-status-dot.offline { background: #f87171; }

.hub-project-name {
  font-size: 0.78rem;
  color: var(--text-muted);
  font-family: ui-monospace, monospace;
  margin-top: 0.2rem;
}

.hub-onboard {
  background: #f0fdf4;
  border: 1.5px solid #86efac;
  border-radius: 12px;
  padding: 1rem 1.4rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  max-width: 480px;
  width: 100%;
}
.hub-onboard-icon { font-size: 1.6rem; flex-shrink: 0; }
.hub-onboard-body { flex: 1; }
.hub-onboard-title { font-size: 0.9rem; font-weight: 700; color: #166534; margin-bottom: 3px; }
.hub-onboard-desc  { font-size: 0.8rem; color: #166534; opacity: 0.85; line-height: 1.4; }
.hub-onboard-btn {
  padding: 0.3rem 0.8rem;
  font-size: 0.82rem;
  font-weight: 600;
  background: #16a34a;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.hub-onboard-btn:hover { background: #15803d; }
`;

let _styleInjected = false;
let _unsubscribe: (() => void) | null = null;

const TILES = [
  {
    mode: "concordancier" as const,
    icon: "🔍",
    label: "Concordancier",
    desc: "Rechercher, explorer et exporter des concordances KWIC",
  },
  {
    mode: "constituer" as const,
    icon: "📂",
    label: "Constituer",
    desc: "Importer, préparer et aligner les corpus épisodes",
  },
  {
    mode: "exporter" as const,
    icon: "📤",
    label: "Exporter",
    desc: "Exporter corpus, alignements et SRT avec personnages",
  },
];

export function mountHub(container: HTMLElement, ctx: ShellContext) {
  injectGlobalCss();

  if (!_styleInjected) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    _styleInjected = true;
  }

  const status = ctx.getBackendStatus();

  container.innerHTML = `
    <div class="hub-root">
      <div class="hub-title">
        <h1>HIMYC</h1>
        <p>How I Met Your Corpus</p>
        <div class="hub-project-name" id="hub-project-name"></div>
      </div>
      <div id="hub-onboard-zone"></div>
      <div class="hub-tiles">
        ${TILES.map((t) => `
          <div class="hub-tile" data-mode="${t.mode}">
            <div class="hub-tile-icon">${t.icon}</div>
            <div class="hub-tile-label">${t.label}</div>
            <div class="hub-tile-desc">${t.desc}</div>
          </div>`).join("")}
      </div>
      <div class="hub-status">
        <div class="hub-status-dot ${status.online ? "online" : "offline"}" id="hub-dot"></div>
        <span id="hub-status-label">${status.online ? `Backend v${status.version ?? "?"}` : "Backend hors ligne"}</span>
      </div>
    </div>`;

  container.querySelectorAll<HTMLElement>(".hub-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const mode = tile.dataset.mode as "concordancier" | "constituer" | "exporter";
      ctx.navigateTo(mode);
    });
  });

  const dot   = container.querySelector<HTMLElement>("#hub-dot")!;
  const label = container.querySelector<HTMLElement>("#hub-status-label")!;

  function loadProjectInfo() {
    fetchConfig().then((cfg) => {
      const nameEl = container.querySelector<HTMLElement>("#hub-project-name");
      if (nameEl) nameEl.textContent = cfg.project_name;

      const onboardZone = container.querySelector<HTMLElement>("#hub-onboard-zone");
      if (!onboardZone) return;
      const needsSetup = !cfg.series_url.trim() && cfg.languages.length === 0;
      if (needsSetup) {
        onboardZone.innerHTML = `
          <div class="hub-onboard">
            <div class="hub-onboard-icon">🚀</div>
            <div class="hub-onboard-body">
              <div class="hub-onboard-title">Premier pas — configurez votre projet</div>
              <div class="hub-onboard-desc">Définissez la série, les langues et la source pour commencer à importer.</div>
            </div>
            <button class="hub-onboard-btn" id="hub-onboard-cta">Démarrer →</button>
          </div>`;
        container.querySelector<HTMLButtonElement>("#hub-onboard-cta")
          ?.addEventListener("click", () => ctx.navigateTo("constituer"));
      } else {
        onboardZone.innerHTML = "";
      }
    }).catch(() => { /* backend down — ignore */ });
  }

  if (status.online) loadProjectInfo();

  _unsubscribe = ctx.onStatusChange((s) => {
    dot.className = "hub-status-dot " + (s.online ? "online" : "offline");
    label.textContent = s.online ? `Backend v${s.version ?? "?"}` : "Backend hors ligne";
    if (s.online) loadProjectInfo();
  });
}

export function disposeHub() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
