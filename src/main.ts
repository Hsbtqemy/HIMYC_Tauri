/**
 * main.ts — point d'entrée HIMYC
 *
 * En mode Tauri : gère le démarrage du backend Python avant d'initialiser le shell.
 *   1. Lire le projet sauvegardé (invoke get_project_path)
 *   2. Si aucun projet : afficher le sélecteur de dossier
 *   3. Sinon : attendre que le backend réponde sur /health (poll 500ms × 60)
 *      → le backend est déjà spawné par setup() Rust ; on ne le re-spawn PAS
 *        pour éviter le double-start qui allonge le démarrage de ~3 s.
 *   4. Une fois prêt : cacher l'overlay, lancer initShell()
 *
 * En mode VITE_E2E=true : bypass direct vers initShell() (tests Playwright).
 */

import { initShell } from "./shell.ts";
import { fetchHealth } from "./api.ts";

const IS_TAURI = import.meta.env.VITE_E2E !== "true" && "__TAURI_INTERNALS__" in window;
const POLL_INTERVAL_MS = 500;
const POLL_MAX_TRIES   = 60; // 30s

// ─── Helpers DOM ──────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setStatus(msg: string) {
  el("startup-status").textContent = msg;
}

function setError(msg: string) {
  const e = el("startup-error");
  e.textContent = msg;
  e.style.display = msg ? "block" : "none";
}

function showSpinner(visible: boolean) {
  el("startup-spinner").style.display = visible ? "block" : "none";
}

function hideOverlay() {
  el("startup-overlay").style.display = "none";
}

/** Met à jour l'opacité de l'image hero (0 → 1 au fil du poll). */
function setProgress(fraction: number) {
  const img = el<HTMLImageElement>("startup-hero");
  if (img) img.style.opacity = String(Math.min(0.92, Math.max(0, fraction)));
}

// ─── Health poll ──────────────────────────────────────────────────────────────

async function pollHealth(maxTries = POLL_MAX_TRIES): Promise<boolean> {
  for (let i = 0; i < maxTries; i++) {
    try {
      await fetchHealth();
      // Amener l'image à 100% et laisser la transition se faire avant de cacher l'overlay
      setProgress(1);
      await new Promise((r) => setTimeout(r, 700));
      return true;
    } catch { /* pas encore prêt */ }
    // Progression linéaire sur les 70% premiers — réservé 30% pour la fin (burst)
    setProgress(0.05 + (i / maxTries) * 0.65);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  setProgress(0);
  return false;
}

// ─── Startup séquence (mode Tauri) ───────────────────────────────────────────

async function startupTauri() {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");

  const pickBtn  = el<HTMLButtonElement>("startup-pick-btn");
  const retryBtn = el<HTMLButtonElement>("startup-retry-btn");

  // ── Fonction : attendre que le backend soit prêt ───────────────────────────
  async function awaitBackend() {
    setStatus(`Backend en cours de démarrage…`);
    setError("");
    showSpinner(true);
    const ready = await pollHealth();
    if (ready) {
      hideOverlay();
      initShell().catch((e) => {
        document.body.innerHTML = `<div style="position:fixed;inset:0;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#fff;font-family:system-ui">
          <div style="font-size:1.4rem;font-weight:700">HIMYC</div>
          <div style="color:#f87171;font-size:0.85rem;max-width:480px;text-align:center">Erreur au lancement de l'interface :<br>${String(e)}</div>
        </div>`;
      });
    } else {
      // Lire le log pour afficher l'erreur réelle
      let logContent = "";
      try {
        logContent = await invoke<string>("get_backend_log");
      } catch { /* commande absente dans les vieilles builds */ }
      const detail = logContent && !logContent.startsWith("(")
        ? `\n\nLog backend :\n${logContent.slice(0, 600)}`
        : "\n\nVérifiez que HIMYC est installé : pip install howimetyourcorpus";
      setError(`Le backend n'a pas répondu après 30 s.${detail}`);
      showSpinner(false);
      pickBtn.style.display  = "inline-block";
      retryBtn.style.display = "inline-block";
    }
  }

  // ── Fonction : spawner un nouveau backend avec un chemin donné ─────────────
  async function spawnWithPath(path: string) {
    setStatus(`Démarrage du backend…`);
    setError("");
    showSpinner(true);
    pickBtn.style.display  = "none";
    retryBtn.style.display = "none";
    try {
      await invoke("set_project_path", { path });
    } catch (e) {
      setError(`Impossible de lancer le backend : ${e}`);
      showSpinner(false);
      pickBtn.style.display  = "inline-block";
      retryBtn.style.display = "inline-block";
      return;
    }
    await awaitBackend();
  }

  // ── Bouton "Choisir un projet" ─────────────────────────────────────────────
  async function pickProject() {
    const selected = await openDialog({
      directory: true,
      title: "Choisir le dossier projet HIMYC",
    });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : (selected as string[])[0];
    if (path) await spawnWithPath(path);
  }

  pickBtn.addEventListener("click",  pickProject);
  retryBtn.addEventListener("click", async () => {
    const savedPath = await invoke<string | null>("get_project_path");
    if (savedPath) await spawnWithPath(savedPath); // re-spawn si le process a crashé
    else           await pickProject();
  });

  // ── Lire le chemin sauvegardé ──────────────────────────────────────────────
  let savedPath: string | null = null;
  try {
    savedPath = await invoke<string | null>("get_project_path");
  } catch (e) {
    console.error("get_project_path:", e);
  }

  if (!savedPath) {
    setStatus("Bienvenue dans HIMYC — choisissez un dossier projet pour commencer.");
    showSpinner(false);
    pickBtn.style.display = "inline-block";
    return;
  }

  // Chemin connu : le backend est DÉJÀ spawné par setup() dans main.rs.
  // On poll directement sans re-spawn pour éviter le double-démarrage (~3 s de délai).
  await awaitBackend();
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

if (IS_TAURI) {
  startupTauri().catch(console.error);
} else {
  // Mode dev Vite ou VITE_E2E : backend déjà lancé, aller directement
  hideOverlay();
  initShell().catch(console.error);
}
