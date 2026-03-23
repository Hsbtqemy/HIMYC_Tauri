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
/* ── Racine : image plein cadre + contenu au-dessus ───────────────────── */
.hub-root {
  position: relative;
  min-height: 100%;
  overflow-x: hidden;
  background: #e9ecf1;
}

/* Image décorative grande, type « hero » plein écran */
.hub-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    url("/ted-barney.png") center 28% / cover no-repeat;
  pointer-events: none;
}
.hub-bg::after {
  content: "";
  position: absolute;
  inset: 0;
  /* Léger voile un peu plus marqué pour compenser les panneaux plus transparents */
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.55) 0%,
    rgba(240, 242, 245, 0.88) 38%,
    rgba(240, 242, 245, 0.98) 72%,
    #f0f2f5 100%
  );
  pointer-events: none;
}

.hub-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100%;
  padding: 2.75rem 2rem 2.5rem;
  gap: 0;
}

/* ── Titre ────────────────────────────────────────────────────────────── */
.hub-hero {
  text-align: center;
  margin-bottom: 2.5rem;
  max-width: 36rem;
}
.hub-hero-title {
  font-size: clamp(1.85rem, 4.5vw, 2.45rem);
  font-weight: 700;
  color: #141428;
  margin: 0 0 0.35rem;
  letter-spacing: -0.5px;
  text-shadow:
    0 0 24px rgba(255, 255, 255, 0.95),
    0 1px 0 rgba(255, 255, 255, 0.6);
}
.hub-hero-sub {
  font-size: 0.95rem;
  color: #3d4450;
  margin: 0;
  text-shadow: 0 0 18px rgba(255, 255, 255, 0.85);
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
  background: rgba(255, 255, 255, 0.5);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(221, 225, 232, 0.58);
  border-radius: 10px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  padding: 2rem 2.5rem;
  width: 240px;
  box-sizing: border-box;
  cursor: pointer;
  transition: box-shadow 0.18s, transform 0.12s, border-color 0.18s, background 0.18s;
  text-align: center;
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}
.hub-card:hover  {
  transform: translateY(-3px);
  background: rgba(255, 255, 255, 0.68);
}
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
.hub-card-badge-concordancier { background: rgba(219, 234, 254, 0.72); color: #1e4a80; }
.hub-card-badge-constituer    { background: rgba(209, 250, 229, 0.72); color: #145a38; }
.hub-card-badge-exporter      { background: rgba(255, 243, 205, 0.72); color: #92400e; }

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
  background: linear-gradient(90deg, transparent, rgba(180, 188, 200, 0.85), transparent);
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
  background: rgba(255, 255, 255, 0.45);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(221, 225, 232, 0.52);
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
  background: rgba(255, 255, 255, 0.48);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(221, 225, 232, 0.55);
  border-radius: 6px;
  color: #495057;
  font-size: 0.8rem;
  padding: 4px 12px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.hub-project-btn:hover:not(:disabled) { background: rgba(240, 244, 255, 0.72); border-color: #2c5f9e; color: #2c5f9e; }
.hub-project-btn:disabled { opacity: 0.5; cursor: default; }

/* ── Onboarding ───────────────────────────────────────────────────────── */
.hub-onboard {
  background: rgba(240, 253, 244, 0.68);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border: 1.5px solid rgba(134, 239, 172, 0.6);
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

/* ── KPI strip (grille : pas de débordement horizontal quand la fenêtre rétrécit) ─ */
.hub-kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 6px;
  max-width: 580px;
  width: 100%;
}
.hub-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  background: rgba(255, 255, 255, 0.45);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(221, 225, 232, 0.52);
  border-radius: 8px;
  padding: 6px 10px;
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

/* ── Breakpoints (tablette / mobile) ─────────────────────────────────── */
@media (max-width: 900px) {
  .hub-content {
    padding: 2.25rem 1.35rem 2.25rem;
  }
  .hub-bg {
    background-position: center 24%;
  }
}

@media (max-width: 640px) {
  .hub-content {
    padding: 1.5rem 0.9rem 1.75rem;
  }
  .hub-hero {
    margin-bottom: 1.65rem;
  }
  .hub-hero-sub {
    font-size: 0.88rem;
    padding: 0 0.25rem;
  }
  .hub-cards {
    flex-direction: column;
    align-items: stretch;
    gap: 0.9rem;
    width: 100%;
    max-width: min(360px, 100%);
    margin-bottom: 2rem;
  }
  .hub-card {
    width: 100%;
    max-width: none;
    padding: 1.35rem 1.15rem;
  }
  .hub-bg {
    background-position: center 32%;
  }
  .hub-project-section,
  .hub-sep {
    max-width: 100%;
  }
  .hub-project-row {
    width: 100%;
    flex-direction: column;
  }
  .hub-project-name {
    max-width: 100%;
    text-align: center;
  }
  .hub-onboard {
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.65rem;
  }
  .hub-kpi-strip {
    gap: 5px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .hub-kpi {
    padding: 6px 6px;
  }
  .hub-kpi-val {
    font-size: 1rem;
  }
  .hub-status {
    text-align: center;
    flex-wrap: wrap;
    justify-content: center;
  }
}

@media (max-width: 380px) {
  .hub-kpi-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .hub-card h2 {
    font-size: 1rem;
  }
  .hub-card p {
    font-size: 0.78rem;
  }
}
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
      <div class="hub-bg" aria-hidden="true"></div>
      <div class="hub-content">

      <!-- Titre (au-dessus du fond) -->
      <div class="hub-hero">
        <h1 class="hub-hero-title">HIMYC</h1>
        <p class="hub-hero-sub">How I Met Your Corpus</p>
      </div>

      <!-- Cartes de navigation -->
      <div class="hub-cards">
        <div class="hub-card hub-card-concordancier" data-mode="concordancier">
          <div class="hub-card-icon">🔍</div>
          <span class="hub-card-badge hub-card-badge-concordancier">Concordancier</span>
          <h2>Explorer le corpus</h2>
          <p>Rechercher, filtrer et exporter des concordances KWIC sur les <strong>segments</strong> indexés (après segmentation).</p>
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
