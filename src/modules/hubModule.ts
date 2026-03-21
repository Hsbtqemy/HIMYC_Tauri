/**
 * hubModule.ts — Hub d'entrée HIMYC
 *
 * Page d'accueil avec 3 cartes de navigation (AGRAFES style) :
 *   Concordancier · Préparer le corpus · Exporter
 * Suivi d'une section projet : nom du projet actif + bouton changer + KPIs.
 */

import type { ShellContext } from "../context";
import { injectGlobalCss, escapeHtml } from "../ui/dom";
import { fetchConfig, fetchQaReport, fetchCharacters } from "../api";

const CSS = `
/* ── Racine ───────────────────────────────────────────────────────────── */
.hub-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  background: #f0f2f5;
  padding: 3rem 2rem 2.5rem;
  gap: 0;
}

/* ── Titre ────────────────────────────────────────────────────────────── */
.hub-hero {
  text-align: center;
  margin-bottom: 2.75rem;
}
.hub-hero-title {
  font-size: 2.2rem;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 0.3rem;
  letter-spacing: -0.5px;
}
.hub-hero-sub {
  font-size: 0.95rem;
  color: #6c757d;
  margin: 0;
}

/* ── Cartes ───────────────────────────────────────────────────────────── */
.hub-cards {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 2.75rem;
}

.hub-card {
  background: #fff;
  border: 1px solid #dde1e8;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  padding: 2rem 2.5rem;
  width: 240px;
  cursor: pointer;
  transition: box-shadow 0.18s, transform 0.12s, border-color 0.18s;
  text-align: center;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.hub-card:hover  { transform: translateY(-3px); }
.hub-card:active { transform: translateY(0); }

.hub-card-concordancier:hover { box-shadow: 0 6px 20px rgba(44,95,158,0.22);  border-color: #2c5f9e; }
.hub-card-constituer:hover    { box-shadow: 0 6px 20px rgba(26,127,78,0.22);  border-color: #1a7f4e; }
.hub-card-exporter:hover      { box-shadow: 0 6px 20px rgba(180,83,9,0.22);   border-color: #b45309; }

.hub-card-icon { font-size: 2.2rem; margin-bottom: 0.4rem; }

.hub-card-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 20px;
  margin-bottom: 0.6rem;
}
.hub-card-badge-concordancier { background: #dbeafe; color: #1e4a80; }
.hub-card-badge-constituer    { background: #d1fae5; color: #145a38; }
.hub-card-badge-exporter      { background: #fff3cd; color: #92400e; }

.hub-card h2 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0 0 0.4rem;
  color: #1a1a2e;
}
.hub-card p {
  font-size: 0.82rem;
  color: #6c757d;
  margin: 0;
  line-height: 1.4;
}

/* ── Séparateur ───────────────────────────────────────────────────────── */
.hub-sep {
  width: 100%;
  max-width: 580px;
  height: 1px;
  background: #dde1e8;
  margin-bottom: 1.75rem;
}

/* ── Section projet ───────────────────────────────────────────────────── */
.hub-project-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  max-width: 580px;
  margin-bottom: 1.5rem;
}

.hub-project-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
}

.hub-project-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #adb5bd;
  margin-bottom: -0.1rem;
  width: 100%;
  text-align: center;
}

.hub-project-name {
  font-size: 0.9rem;
  font-family: ui-monospace, "SF Mono", monospace;
  color: #1a1a2e;
  font-weight: 600;
  background: #fff;
  border: 1px solid #dde1e8;
  border-radius: 6px;
  padding: 4px 12px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hub-project-name.none {
  color: #adb5bd;
  font-style: italic;
  font-weight: 400;
}

.hub-project-btn {
  background: #fff;
  border: 1px solid #dde1e8;
  border-radius: 6px;
  color: #495057;
  font-size: 0.8rem;
  padding: 4px 12px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.hub-project-btn:hover:not(:disabled) { background: #f0f4ff; border-color: #2c5f9e; color: #2c5f9e; }
.hub-project-btn:disabled { opacity: 0.5; cursor: default; }

/* ── Onboarding ───────────────────────────────────────────────────────── */
.hub-onboard {
  background: #f0fdf4;
  border: 1.5px solid #86efac;
  border-radius: 8px;
  padding: 0.85rem 1.2rem;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  max-width: 520px;
  width: 100%;
}
.hub-onboard-icon { font-size: 1.4rem; flex-shrink: 0; }
.hub-onboard-body { flex: 1; }
.hub-onboard-title { font-size: 0.88rem; font-weight: 700; color: #166534; margin-bottom: 2px; }
.hub-onboard-desc  { font-size: 0.78rem; color: #166534; opacity: 0.85; line-height: 1.4; }
.hub-onboard-cta {
  padding: 0.3rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  background: #16a34a;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  font-family: inherit;
}
.hub-onboard-cta:hover { background: #15803d; }

/* ── KPI strip ────────────────────────────────────────────────────────── */
.hub-kpi-strip {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 580px;
  width: 100%;
}
.hub-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #fff;
  border: 1px solid #dde1e8;
  border-radius: 8px;
  padding: 6px 14px;
  min-width: 76px;
}
.hub-kpi-val {
  font-size: 1.15rem;
  font-weight: 700;
  font-family: ui-monospace, monospace;
  color: #1a1a2e;
  line-height: 1.2;
}
.hub-kpi-label {
  font-size: 0.62rem;
  color: #6c757d;
  text-transform: uppercase;
  letter-spacing: .05em;
  margin-top: 1px;
}
.hub-gate-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  margin-right: 3px;
  vertical-align: middle;
}
.hub-gate-dot.ok       { background: #34d399; }
.hub-gate-dot.warnings { background: #fbbf24; }
.hub-gate-dot.blocking { background: #f87171; }

/* ── Statut backend ───────────────────────────────────────────────────── */
.hub-status {
  margin-top: 1.5rem;
  font-size: 0.72rem;
  color: #adb5bd;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.hub-status-dot {
  width: 6px; height: 6px;
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

      <!-- Titre -->
      <div class="hub-hero" style="display:flex;align-items:center;gap:2.5rem;justify-content:center">
        <img src="/ted-barney.png" alt="How I Met Your Mother" style="height:160px;width:auto;border-radius:14px;opacity:0.88;flex-shrink:0;box-shadow:0 4px 18px rgba(0,0,0,0.13)">
        <div style="text-align:left">
          <h1 class="hub-hero-title">HIMYC</h1>
          <p class="hub-hero-sub">How I Met Your Corpus</p>
        </div>
      </div>

      <!-- Cartes de navigation -->
      <div class="hub-cards">
        <div class="hub-card hub-card-concordancier" data-mode="concordancier">
          <div class="hub-card-icon">🔍</div>
          <span class="hub-card-badge hub-card-badge-concordancier">Concordancier</span>
          <h2>Explorer le corpus</h2>
          <p>Rechercher, filtrer et exporter des concordances KWIC dans les segments et sous-titres.</p>
        </div>
        <div class="hub-card hub-card-constituer" data-mode="constituer">
          <div class="hub-card-icon">📂</div>
          <span class="hub-card-badge hub-card-badge-constituer">Préparation</span>
          <h2>Préparer le corpus</h2>
          <p>Importer, normaliser, segmenter et aligner les transcriptions et sous-titres.</p>
        </div>
        <div class="hub-card hub-card-exporter" data-mode="exporter">
          <div class="hub-card-icon">📤</div>
          <span class="hub-card-badge hub-card-badge-exporter">Export</span>
          <h2>Exporter</h2>
          <p>Exporter le corpus, les alignements, les SRT enrichis et les personnages.</p>
        </div>
      </div>

      <!-- Séparateur -->
      <div class="hub-sep"></div>

      <!-- Section projet -->
      <div class="hub-project-section">
        <div class="hub-project-label">Projet actif</div>
        <div class="hub-project-row">
          <span class="hub-project-name none" id="hub-project-name">—</span>
          <button class="hub-project-btn" id="hub-change-btn">📁 Changer…</button>
        </div>
        <div id="hub-onboard-zone"></div>
      </div>

      <!-- KPI strip -->
      <div class="hub-kpi-strip" id="hub-kpi-strip" style="display:none">
        <div class="hub-kpi"><span class="hub-kpi-val" id="hkpi-ep">—</span><span class="hub-kpi-label">Épisodes</span></div>
        <div class="hub-kpi"><span class="hub-kpi-val" id="hkpi-seg">—</span><span class="hub-kpi-label">Segmentés</span></div>
        <div class="hub-kpi"><span class="hub-kpi-val" id="hkpi-srt">—</span><span class="hub-kpi-label">Avec SRT</span></div>
        <div class="hub-kpi"><span class="hub-kpi-val" id="hkpi-run">—</span><span class="hub-kpi-label">Alignements</span></div>
        <div class="hub-kpi"><span class="hub-kpi-val" id="hkpi-chr">—</span><span class="hub-kpi-label">Personnages</span></div>
        <div class="hub-kpi"><span class="hub-kpi-val" id="hkpi-gate">—</span><span class="hub-kpi-label">QA</span></div>
      </div>

      <!-- Statut backend -->
      <div class="hub-status">
        <div class="hub-status-dot ${status.online ? "online" : "offline"}" id="hub-dot"></div>
        <span id="hub-status-label">${status.online ? `Backend v${status.version ?? "?"}` : "Backend hors ligne"}</span>
      </div>

    </div>`;

  // ── Navigation cartes ──────────────────────────────────────────────────────
  container.querySelectorAll<HTMLElement>(".hub-card").forEach((card) => {
    card.addEventListener("click", () => {
      ctx.navigateTo(card.dataset.mode as "concordancier" | "constituer" | "exporter");
    });
  });

  // ── Bouton changer de projet ───────────────────────────────────────────────
  container.querySelector<HTMLButtonElement>("#hub-change-btn")
    ?.addEventListener("click", () => ctx.changeProject());

  // ── Statut backend ─────────────────────────────────────────────────────────
  const dot   = container.querySelector<HTMLElement>("#hub-dot")!;
  const label = container.querySelector<HTMLElement>("#hub-status-label")!;

  // ── Chargement des infos projet + KPIs ────────────────────────────────────
  function loadProjectInfo() {
    fetchConfig().then((cfg) => {
      const nameEl = container.querySelector<HTMLElement>("#hub-project-name");
      if (nameEl) {
        nameEl.textContent = escapeHtml(cfg.project_name);
        nameEl.classList.toggle("none", !cfg.project_name);
      }

      const onboardZone = container.querySelector<HTMLElement>("#hub-onboard-zone");
      if (!onboardZone) return;
      const needsSetup = !cfg.series_url?.trim() && cfg.languages.length === 0;
      if (needsSetup) {
        onboardZone.innerHTML = `
          <div class="hub-onboard">
            <div class="hub-onboard-icon">🚀</div>
            <div class="hub-onboard-body">
              <div class="hub-onboard-title">Projet non configuré</div>
              <div class="hub-onboard-desc">Définissez la série, les langues et la source pour commencer à importer.</div>
            </div>
            <button class="hub-onboard-cta" id="hub-onboard-cta">Démarrer →</button>
          </div>`;
        container.querySelector<HTMLButtonElement>("#hub-onboard-cta")
          ?.addEventListener("click", () => ctx.navigateTo("constituer"));
      } else {
        onboardZone.innerHTML = "";
      }
    }).catch(() => {});

    loadKpis(container);
  }

  function loadKpis(root: HTMLElement) {
    const strip = root.querySelector<HTMLElement>("#hub-kpi-strip");
    if (!strip) return;
    const set = (id: string, val: string | number) => {
      const el = root.querySelector<HTMLElement>(`#${id}`);
      if (el) el.textContent = String(val);
    };
    Promise.all([fetchQaReport("lenient"), fetchCharacters()])
      .then(([qa, chars]) => {
        set("hkpi-ep",  qa.total_episodes);
        set("hkpi-seg", qa.n_segmented);
        set("hkpi-srt", qa.n_with_srts);
        set("hkpi-run", qa.n_alignment_runs);
        set("hkpi-chr", chars.characters.length);
        const gateEl = root.querySelector<HTMLElement>("#hkpi-gate");
        if (gateEl) {
          const cls  = qa.gate === "ok" ? "ok" : qa.gate === "warnings" ? "warnings" : "blocking";
          const lbl  = qa.gate === "ok" ? "OK"  : qa.gate === "warnings" ? "⚠"      : "🔴";
          gateEl.innerHTML = `<span class="hub-gate-dot ${cls}"></span>${lbl}`;
        }
        strip.style.display = "flex";
      })
      .catch(() => {});
  }

  if (status.online) loadProjectInfo();

  _unsubscribe = ctx.onStatusChange((s) => {
    dot.className   = "hub-status-dot " + (s.online ? "online" : "offline");
    label.textContent = s.online ? `Backend v${s.version ?? "?"}` : "Backend hors ligne";
    if (s.online) loadProjectInfo();
  });
}

export function disposeHub() {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}
