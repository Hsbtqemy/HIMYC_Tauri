/**
 * context.ts — ShellContext interface HIMYC
 *
 * Contrat minimal passé du shell vers chaque module.
 * Les modules accèdent au backend exclusivement via ce contrat,
 * restés découplés des internals du shell.
 */

export interface BackendStatus {
  online: boolean;
  version?: string;
}

/**
 * Données de handoff vers l'Aligner (MX-009) — alimentées depuis Constituer → Actions → Alignement.
 *
 * Cas transcript-first : pivot_key = "transcript", target_keys = ["srt_en", ...]
 * Cas srt-only         : pivot_key = "srt_en",     target_keys = ["srt_fr", ...]
 */
export interface AlignerHandoff {
  episode_id: string;
  episode_title: string;
  /** source_key du pivot : "transcript" ou premier SRT disponible */
  pivot_key: string;
  /** source_keys des cibles SRT */
  target_keys: string[];
  /** "transcript_first" | "srt_only" */
  mode: "transcript_first" | "srt_only";
  /** segment_kind pour AlignEpisodeStep */
  segment_kind: "sentence" | "utterance";
  /** Langue du pivot (ex: "fr", "en") — MX-037 */
  pivot_lang?: string;
  /** Langues cibles (ex: ["en", "it"]) — MX-037 */
  target_langs?: string[];
  /** Seuil de confiance minimum (0.1–0.95) — MX-037 */
  min_confidence?: number;
  /** Utiliser la similarité textuelle pour les cues — MX-037 */
  use_similarity_for_cues?: boolean;
}

export interface ShellContext {
  /** URL de base de l'API backend HIMYC (ex: "http://localhost:8765"). */
  getApiBase(): string;

  /** Statut courant du backend (online/offline). */
  getBackendStatus(): BackendStatus;

  /**
   * S'abonner aux changements de statut backend.
   * Retourne une fonction de désabonnement à appeler dans dispose().
   */
  onStatusChange(cb: (status: BackendStatus) => void): () => void;

  /**
   * Naviguer programmatiquement vers un mode.
   * hub/concordancier/constituer/exporter = modes top-level.
   * aligner = sous-vue (pas d'onglet top-level, MX-020).
   */
  navigateTo(mode: "hub" | "concordancier" | "constituer" | "exporter" | "aligner"): void;

  /**
   * Stocker les données de handoff vers la sous-vue Aligner (MX-009).
   * L'Aligner lit ces données à son montage (lecture unique via getHandoff).
   */
  setHandoff(data: AlignerHandoff | null): void;

  /** Lire les données de handoff (null si navigation directe). */
  getHandoff(): AlignerHandoff | null;

  /**
   * Ouvre le sélecteur de dossier Tauri pour changer de projet.
   * No-op en mode non-Tauri (dev Vite / E2E).
   */
  changeProject(): void;

  /**
   * Identifiant stable du projet courant (chemin absolu sur disque).
   * Utilisé comme préfixe pour les clés localStorage afin d'isoler
   * les préférences par projet. Retourne "" si aucun projet n'est ouvert.
   */
  getProjectId(): string;
}
