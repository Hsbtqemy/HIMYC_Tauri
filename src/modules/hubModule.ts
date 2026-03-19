/**
 * hubModule.ts — Hub d'entrée HIMYC (MX-020)
 *
 * Landing page avec 3 tuiles de navigation :
 * Concordancier · Constituer · Exporter
 */

import type { ShellContext } from "../context";
import { injectGlobalCss } from "../ui/dom";

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
      </div>
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
  _unsubscribe = ctx.onStatusChange((s) => {
    dot.className = "hub-status-dot " + (s.online ? "online" : "offline");
    label.textContent = s.online ? `Backend v${s.version ?? "?"}` : "Backend hors ligne";
  });
}

export function disposeHub() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
