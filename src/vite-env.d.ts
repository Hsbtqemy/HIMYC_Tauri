/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Défini à "true" pour les tests E2E Playwright — bypass Tauri invoke. */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
