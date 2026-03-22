/**
 * pipeline.spec.ts — E2E frontend : normalize → segment → export.
 *
 * Couvre :
 * - Import transcript via API REST
 * - Normalisation depuis Constituer → Actions → Curation (bouton ⚡ épisode)
 * - Segmentation depuis Actions → Segmentation
 * - Export CSV segments dans l'Exporter
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

/** Hub puis sidebar Constituer → sous-vue Curation. */
async function gotoConstituerCuration(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator('[data-mode="constituer"]').click();
  await page.waitForSelector('.cons-nav-tree-link[data-subview="curation"]', { timeout: 15_000 });
  await page.locator('.cons-nav-tree-link[data-subview="curation"]').click();
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

  test("1. Curation — normalisation épisode S01E01 (⚡) puis badge norm.", async ({ page }) => {
    await gotoConstituerCuration(page);

    const normBtn = page.locator('button.cur-ep-normalize[data-ep="S01E01"]');
    await expect(normBtn).toBeVisible({ timeout: 15_000 });
    await normBtn.click();

    await expect(page.locator('.cur-ep-item[data-ep-id="S01E01"] .cons-badge.normalized')).toBeVisible({
      timeout: 45_000,
    });
  });

  test("2. Segmentation — job segmenter sur S01E01", async ({ page }) => {
    await gotoConstituerCuration(page);
    await page.locator('.cons-nav-tree-link[data-subview="segmentation"]').click();

    const segBtn = page.locator('button.seg-ep-btn[data-ep="S01E01"]');
    await expect(segBtn).toBeVisible({ timeout: 15_000 });
    await segBtn.click();

    await expect(
      page.locator('tr[data-ep-id="S01E01"] .cons-badge.segmented'),
    ).toBeVisible({ timeout: 45_000 });
  });

  test("3. Exporter — export CSV segments produit un résultat", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-mode="exporter"]').click();

    await page.waitForSelector('[data-stage="segments"]', { timeout: 10_000 });
    await page.click('[data-stage="segments"]');

    await page.click('[data-scope="segments"][data-fmt="csv"]');

    await expect(page.locator("#exp-segments-result")).toContainText("✓", { timeout: 15_000 });
  });
});
