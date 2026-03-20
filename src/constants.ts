/**
 * constants.ts — Constantes globales frontend HIMYC
 *
 * Centralise les valeurs qui étaient hardcodées dans les modules
 * (HC-02 — audit valeurs hardcodées 2026-03-20).
 */

/** Port d'écoute du backend FastAPI. */
export const API_PORT = 8765;

/** URL de base du backend (loopback Tauri). */
export const API_BASE = `http://localhost:${API_PORT}`;

/** Commande Tauri pour les requêtes loopback (contournement CSP). */
export const TAURI_SIDECAR_CMD = "sidecar_fetch_loopback";

/** Code d'erreur par défaut quand la réponse n'est pas parseable. */
export const DEFAULT_ERROR_CODE = "UNKNOWN";

/** Langues supportées par le corpus. */
export const SUPPORTED_LANGUAGES = ["en", "fr", "it"] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];
