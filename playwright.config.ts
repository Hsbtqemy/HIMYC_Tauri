import { defineConfig } from "@playwright/test";
import path from "node:path";

const HIMYC_ROOT      = path.resolve(__dirname, "../HIMYC");
const BACKEND_PORT    = 8765;
const FRONTEND_PORT   = 1421;
/** Répertoire de projet isolé pour les tests E2E. */
const E2E_PROJECT_DIR = "/tmp/himyc-e2e";

export default defineConfig({
  testDir:    "./tests/e2e",
  timeout:    60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL:     `http://localhost:${FRONTEND_PORT}`,
    /* Capture screenshot + trace en cas d'échec */
    screenshot:  "only-on-failure",
    trace:       "on-first-retry",
  },
  webServer: [
    {
      // Backend FastAPI — projet E2E isolé
      command: `HIMYC_PROJECT_PATH=${E2E_PROJECT_DIR} python -m uvicorn howimetyourcorpus.api.server:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      url:     `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      cwd:     HIMYC_ROOT,
      stdout:  "pipe",
      stderr:  "pipe",
    },
    {
      // Frontend Vite en mode E2E (bypass Tauri invoke → fetch natif)
      command: `VITE_E2E=true npx vite --port ${FRONTEND_PORT} --strictPort`,
      port:    FRONTEND_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
