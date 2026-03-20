/**
 * global-setup.ts — Crée le répertoire de projet HIMYC pour les tests E2E.
 *
 * Appelé une seule fois avant le lancement des webServers Playwright.
 * Le backend démarre avec HIMYC_PROJECT_PATH=/tmp/himyc-e2e.
 */

import fs   from "node:fs";
import path from "node:path";

const E2E_PROJECT_DIR = "/tmp/himyc-e2e";

export default async function globalSetup(): Promise<void> {
  const episodesDir = path.join(E2E_PROJECT_DIR, "episodes", "S01E01");
  fs.mkdirSync(episodesDir, { recursive: true });

  const seriesIndex = {
    series_title: "How I Met Your Mother",
    series_url:   "",
    episodes: [
      { episode_id: "S01E01", season: 1, episode: 1, title: "Pilot", url: "" },
    ],
  };

  fs.writeFileSync(
    path.join(E2E_PROJECT_DIR, "series_index.json"),
    JSON.stringify(seriesIndex, null, 2),
    "utf-8",
  );
}
