/**
 * main.ts — point d'entrée HIMYC
 *
 * En mode Tauri : gère le démarrage du backend Python avant d'initialiser le shell.
 *   1. Lire le projet sauvegardé (invoke get_project_path)
 *   2. Si aucun projet : afficher le sélecteur de dossier
 *   3. Sinon : attendre que le backend réponde sur /health (poll 500ms × 60)
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

// ─── Health poll ──────────────────────────────────────────────────────────────

async function pollHealth(maxTries = POLL_MAX_TRIES): Promise<boolean> {
  for (let i = 0; i < maxTries; i++) {
    try {
      await fetchHealth();
      return true;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

// ─── Startup séquence (mode Tauri) ───────────────────────────────────────────

async function startupTauri() {
  const { invoke } = await import("@tauri-apps/api/core");
  const { open: openDialog } = await import("@tauri-apps/plugin-dialog");

  const pickBtn  = el<HTMLButtonElement>("startup-pick-btn");
  const retryBtn = el<HTMLButtonElement>("startup-retry-btn");

  // ── Fonction : lancer le backend avec un chemin donné ──────────────────────
  async function launchWithPath(path: string) {
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

    setStatus(`Backend en cours de démarrage…`);
    const ready = await pollHealth();
    if (ready) {
      hideOverlay();
      initShell().catch(console.error);
    } else {
      setError("Le backend n'a pas répondu après 30 s. Vérifiez que HIMYC est installé (pip install howimetyourcorpus).");
      showSpinner(false);
      pickBtn.style.display  = "inline-block";
      retryBtn.style.display = "inline-block";
    }
  }

  // ── Bouton "Choisir un projet" ─────────────────────────────────────────────
  async function pickProject() {
    const selected = await openDialog({
      directory: true,
      title: "Choisir le dossier projet HIMYC",
    });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : (selected as string[])[0];
    if (path) await launchWithPath(path);
  }

  pickBtn.addEventListener("click",  pickProject);
  retryBtn.addEventListener("click", async () => {
    const savedPath = await invoke<string | null>("get_project_path");
    if (savedPath) await launchWithPath(savedPath);
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

  // Chemin connu — démarrer directement
  await launchWithPath(savedPath);
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

if (IS_TAURI) {
  startupTauri().catch(console.error);
} else {
  // Mode dev Vite ou VITE_E2E : backend déjà lancé, aller directement
  hideOverlay();
  initShell().catch(console.error);
}
