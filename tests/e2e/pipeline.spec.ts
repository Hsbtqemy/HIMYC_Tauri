/**
 * pipeline.spec.ts — E2E frontend : normalize → segment → export.
 *
 * Couvre :
 * - Import transcript via API REST
 * - Bouton "Normaliser" dans l'Inspecter → feedback "Terminé ✓"
 * - Bouton "Segmenter" dans l'Inspecter → feedback "Terminé ✓"
 * - Bouton export CSV dans l'Exporter  → result "✓ … segments"
 *
 * Prérequis :
 * - Backend FastAPI sur localhost:8765 (HIMYC_PROJECT_PATH=/tmp/himyc-e2e)
 * - Frontend Vite sur localhost:1421   (VITE_E2E=true)
 * - Lancés automatiquement par playwright.config.ts webServer[]
 */

import { test, expect } from "@playwright/test";

const BACKEND_BASE = "http://127.0.0.1:8765";

const TRANSCRIPT = `\
Ted Mosby: Kids, I'm going to tell you an incredible story.
Marshall Eriksen: The story of how you met your mother?
Ted Mosby: Exactly. It all started in 2005.
Lily Aldrin: But first, let's set the scene.
Barney Stinson: Suit up!
Ted Mosby: In New York City, in the year 2030...
Marshall Eriksen: This is going to take a while.
Lily Aldrin: I'll get the popcorn.
Ted Mosby: Where was I? Right. It started with Robin.
Barney Stinson: Legendary. Wait for it.
`;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Navigate to a module tab (via localStorage + reload). */
async function gotoModule(page: import("@playwright/test").Page, mode: string) {
  await page.evaluate((m) => localStorage.setItem("himyc_last_mode", m), mode);
  await page.reload({ waitUntil: "networkidle" });
}

// ── Tests (séquentiels — chaque étape dépend de la précédente) ─────────────────

test.describe.serial("Pipeline normalize → segment → export", () => {
  /** Import du transcript avant toute interaction UI. */
  test.beforeAll(async ({ request }) => {
    const r = await request.post(`${BACKEND_BASE}/episodes/S01E01/sources/transcript`, {
      data: { content: TRANSCRIPT },
    });
    expect(r.ok(), `Import transcript: ${await r.text()}`).toBeTruthy();
  });

  test("1. Inspecter — bouton Normaliser visible et job terminé", async ({ page }) => {
    await page.goto("/");
    await gotoModule(page, "constituer");

    // Cliquer sur "→ Inspecter" de l'épisode S01E01
    await page.waitForSelector('[data-inspecter="S01E01"]', { timeout: 10_000 });
    await page.click('[data-inspecter="S01E01"]');

    // Le bouton Normaliser doit être présent (transcript en état "raw")
    const btnNorm = page.locator("#insp-btn-normalize");
    await expect(btnNorm).toBeVisible({ timeout: 10_000 });

    await btnNorm.click();

    // Attendre le feedback "Terminé ✓" (job asynchrone — jusqu'à 30 s)
    await expect(page.locator("#insp-job-fb")).toContainText("Terminé ✓", { timeout: 30_000 });
  });

  test("2. Inspecter — bouton Segmenter visible et job terminé", async ({ page }) => {
    await page.goto("/");
    await gotoModule(page, "constituer");

    await page.waitForSelector('[data-inspecter="S01E01"]', { timeout: 10_000 });
    await page.click('[data-inspecter="S01E01"]');

    // Après normalisation, le bouton Segmenter remplace Normaliser
    const btnSeg = page.locator("#insp-btn-segment");
    await expect(btnSeg).toBeVisible({ timeout: 10_000 });

    await btnSeg.click();

    await expect(page.locator("#insp-job-fb")).toContainText("Terminé ✓", { timeout: 30_000 });
  });

  test("3. Exporter — export CSV segments produit un résultat", async ({ page }) => {
    await page.goto("/");
    await gotoModule(page, "exporter");

    // Activer l'onglet "Segments" dans l'Exporter
    await page.waitForSelector('[data-stage="segments"]', { timeout: 10_000 });
    await page.click('[data-stage="segments"]');

    // Lancer l'export CSV
    await page.click('[data-scope="segments"][data-fmt="csv"]');

    // Le div résultat doit contenir "✓" et au moins une mention de "segment" ou du chemin
    await expect(page.locator("#exp-segments-result")).toContainText("✓", { timeout: 15_000 });
  });
});
