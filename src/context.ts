/**
 * context.ts — ShellContext interface HIMYC
 *
 * Contrat minimal passe du shell vers chaque module.
 * Les modules acces au backend exclusivement via ce contrat,
 * restes decouples des internals du shell.
 */

export interface BackendStatus {
  online: boolean;
  version?: string;
}

export interface ShellContext {
  /** URL de base de l API backend HIMYC (ex: "http://localhost:8765"). */
  getApiBase(): string;

  /** Statut courant du backend (online/offline). */
  getBackendStatus(): BackendStatus;

  /**
   * S abonner aux changements de statut backend.
   * Retourne une fonction de desabonnement a appeler dans dispose().
   */
  onStatusChange(cb: (status: BackendStatus) => void): () => void;
}
