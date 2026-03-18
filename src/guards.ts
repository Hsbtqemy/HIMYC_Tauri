/**
 * guards.ts — Gardes métier et messages de guidance (MX-008)
 *
 * Source unique de vérité pour toutes les questions "peut-on faire X ?".
 *
 * Utilisé à deux niveaux :
 *   1. UI — masquer / griser les boutons selon le résultat
 *   2. Handler — rejeter l'action même si appelée directement (bouton caché cliqué,
 *      race condition, appel programmatique) — « pas seulement l'UI »
 *
 * Règle : chaque garde retourne { allowed, reason? }.
 *   - allowed = true  → action autorisée
 *   - allowed = false → action bloquée, reason = message actionnable
 */

import type { Episode, EpisodeSource } from "./api";

// ── Type résultat ──────────────────────────────────────────────────────────

export interface GuardResult {
  allowed: boolean;
  /** Message actionnable affiché à l'utilisateur quand allowed=false. */
  reason?: string;
}

const OK: GuardResult = { allowed: true };
const block = (reason: string): GuardResult => ({ allowed: false, reason });

// ── Gardes source transcript ────────────────────────────────────────────────

/**
 * Normaliser un transcript : source doit être disponible, état raw ou unknown.
 * Bloqué si déjà normalisé, segmenté ou prêt.
 */
export function guardNormalizeTranscript(
  src: EpisodeSource | undefined,
): GuardResult {
  if (!src || !src.available) {
    return block("Importez d'abord un transcript avant de normaliser.");
  }
  const s = src.state ?? "unknown";
  if (s === "normalized") {
    return block("Transcript déjà normalisé. Lancez la segmentation pour continuer.");
  }
  if (s === "segmented" || s === "ready_for_alignment") {
    return block("Transcript déjà normalisé et segmenté — aucune action nécessaire.");
  }
  return OK;
}

/**
 * Segmenter un transcript : source doit être disponible, état normalized.
 * Bloqué si raw/unknown (normaliser d'abord) ou déjà segmenté.
 */
export function guardSegmentTranscript(
  src: EpisodeSource | undefined,
): GuardResult {
  if (!src || !src.available) {
    return block("Importez et normalisez un transcript avant de segmenter.");
  }
  const s = src.state ?? "unknown";
  if (s === "raw" || s === "unknown") {
    return block("Normalisez le transcript avant de segmenter.");
  }
  if (s === "segmented" || s === "ready_for_alignment") {
    return block("Transcript déjà segmenté — aucune action nécessaire.");
  }
  return OK;
}

/**
 * Normaliser une piste SRT : source doit être disponible, état raw ou unknown.
 */
export function guardNormalizeSrt(
  src: EpisodeSource | undefined,
): GuardResult {
  if (!src || !src.available) {
    return block("Importez d'abord la piste SRT avant de normaliser.");
  }
  const s = src.state ?? "unknown";
  if (s === "normalized" || s === "segmented" || s === "ready_for_alignment") {
    return block("Piste SRT déjà normalisée.");
  }
  return OK;
}

// ── Gardes import ───────────────────────────────────────────────────────────

/**
 * Importer un transcript : toujours possible (écrasement autorisé en pilote).
 * Retourne un avertissement si un transcript existe déjà (allowed=true, reason=hint).
 */
export function guardImportTranscript(
  src: EpisodeSource | undefined,
): GuardResult {
  if (src?.available) {
    return {
      allowed: true,
      reason: "Un transcript existe déjà — il sera écrasé par l'import.",
    };
  }
  return OK;
}

/**
 * Importer un SRT : toujours possible.
 * Avertissement si piste déjà présente.
 */
export function guardImportSrt(
  episode: Episode,
  lang: string,
): GuardResult {
  const existing = episode.sources.find(
    (s) => s.source_key === `srt_${lang}` && s.available,
  );
  if (existing) {
    return {
      allowed: true,
      reason: `Piste SRT ${lang.toUpperCase()} déjà présente — elle sera écrasée par l'import.`,
    };
  }
  return OK;
}

// ── Garde batch normalisation ───────────────────────────────────────────────

/**
 * Normaliser par lot : au moins un épisode doit avoir un transcript raw/unknown.
 */
export function guardBatchNormalize(episodes: Episode[]): GuardResult {
  const eligible = episodes.filter((ep) => {
    const t = ep.sources.find((s) => s.source_key === "transcript");
    return t?.available && (t.state === "raw" || t.state === "unknown");
  });
  if (eligible.length === 0) {
    return block(
      "Aucun transcript en état brut à normaliser. " +
      "Importez des transcripts ou vérifiez l'état des sources.",
    );
  }
  return { allowed: true, reason: `${eligible.length} transcript(s) à normaliser.` };
}

// ── Garde alignement ────────────────────────────────────────────────────────

/**
 * Lancer un alignement : l'épisode doit avoir au moins une paire aligneable.
 *
 * Cas 1 — transcript + srt_<lang> : transcript doit être segmenté.
 * Cas 2 — srt-only : 2+ pistes SRT disponibles.
 */
export function guardAlignEpisode(episode: Episode): GuardResult {
  const transcript = episode.sources.find(
    (s) => s.source_key === "transcript" && s.available,
  );
  const srts = episode.sources.filter(
    (s) => s.source_key.startsWith("srt_") && s.available,
  );

  if (transcript) {
    if (srts.length === 0) {
      return block(
        "Aucune piste SRT disponible pour l'alignement. " +
        "Importez au moins une piste SRT.",
      );
    }
    const s = transcript.state ?? "unknown";
    if (s === "raw" || s === "unknown") {
      return block("Normalisez et segmentez le transcript avant d'aligner.");
    }
    if (s === "normalized") {
      return block("Segmentez le transcript avant d'aligner.");
    }
    return OK;
  }

  // srt-only
  if (srts.length < 2) {
    return block(
      "Mode SRT-only : importez au moins 2 pistes SRT pour activer l'alignement.",
    );
  }
  return OK;
}

// ── Préconditions structurées alignement (MX-010) ─────────────────────────

/**
 * Une précondition individuelle pour l'alignement.
 * `met = true` → condition satisfaite.
 * `hint`       → action à effectuer pour la satisfaire (si non satisfaite).
 */
export interface AlignPrecondition {
  id: string;
  label: string;
  met: boolean;
  hint?: string;
}

/**
 * Retourne la liste structurée des préconditions pour aligner un épisode.
 *
 * Utilisé dans l'Aligner pour afficher un feedback clair et actionnable
 * (checklist) au lieu d'un message d'erreur plat.
 *
 * Cas transcript-first : 4 préconditions.
 * Cas srt-only         : 1 précondition.
 */
export function getAlignPreconditions(episode: Episode): AlignPrecondition[] {
  const transcript = episode.sources.find(
    (s) => s.source_key === "transcript" && s.available,
  );
  const srts = episode.sources.filter(
    (s) => s.source_key.startsWith("srt_") && s.available,
  );

  if (transcript) {
    // Mode transcript-first
    const state = transcript.state ?? "unknown";
    const isNorm  = state === "normalized" || state === "segmented" || state === "ready_for_alignment";
    const isSeg   = state === "segmented" || state === "ready_for_alignment";

    return [
      {
        id: "transcript_available",
        label: "Transcript importé",
        met: true, // si on est ici, transcript est available
      },
      {
        id: "transcript_normalized",
        label: "Transcript normalisé",
        met: isNorm,
        hint: isNorm ? undefined : "Normalisez le transcript via l'onglet Inspecter.",
      },
      {
        id: "transcript_segmented",
        label: "Transcript segmenté",
        met: isSeg,
        hint: isSeg ? undefined : (
          isNorm
            ? "Segmentez le transcript via l'onglet Inspecter."
            : "Normalisez puis segmentez le transcript via l'onglet Inspecter."
        ),
      },
      {
        id: "srt_available",
        label: "Au moins 1 piste SRT importée",
        met: srts.length > 0,
        hint: srts.length > 0 ? undefined : "Importez une piste SRT via l'onglet Constituer.",
      },
    ];
  }

  // Mode srt-only
  return [
    {
      id: "srt_count",
      label: "Au moins 2 pistes SRT disponibles",
      met: srts.length >= 2,
      hint: srts.length >= 2
        ? undefined
        : `${srts.length} piste(s) SRT détectée(s). Importez au moins 2 pistes SRT via l'onglet Constituer.`,
    },
  ];
}

// ── Normalisation messages d'erreur job (MX-010) ───────────────────────────

/**
 * Traduit un message d'erreur technique Python en message actionnable.
 *
 * Les erreurs issues du worker (RuntimeError, StepResult.message) peuvent
 * contenir des détails techniques non pertinents pour l'utilisateur.
 * Cette fonction mappe les cas connus en messages clairs.
 */
export function formatJobError(errorMsg: string | null | undefined): string {
  if (!errorMsg) return "Erreur inconnue — consultez les logs backend.";

  // Préconditions manquantes (MX-008 backend messages)
  if (errorMsg.includes("RAW introuvable") || errorMsg.includes("No raw text")) {
    return "Transcript brut introuvable. Importez un transcript avant de lancer ce job.";
  }
  if (errorMsg.includes("normalisé introuvable") || errorMsg.includes("has_episode_clean")) {
    return "Transcript normalisé introuvable. Normalisez d'abord le transcript.";
  }
  if (errorMsg.includes("SRT") && errorMsg.includes("introuvable")) {
    return "Piste SRT introuvable. Importez la piste SRT avant de normaliser.";
  }
  if (errorMsg.includes("No segments") || errorMsg.includes("no segments")) {
    return "Aucun segment trouvé. Segmentez le transcript avant d'aligner.";
  }
  if (errorMsg.includes("No DB") || errorMsg.includes("corpus.db introuvable")) {
    return "Base de données corpus introuvable. Indexez d'abord le projet (BuildDbIndexStep).";
  }
  if (errorMsg.includes("Profile not found")) {
    return "Profil de normalisation introuvable. Vérifiez la configuration du projet (normalize_profile).";
  }
  if (errorMsg.includes("Cancelled")) {
    return "Job annulé.";
  }
  // Message déjà lisible (pas de traceback Python)
  if (!errorMsg.includes("Traceback") && !errorMsg.includes("  File ")) {
    return errorMsg;
  }
  // Traceback Python brut → message générique
  return "Erreur interne — consultez les logs backend pour le détail.";
}

// ── Wrapper exécution gardée ────────────────────────────────────────────────

/**
 * Exécute fn() seulement si guard.allowed.
 * Si bloqué, appelle onBlocked(reason) et retourne undefined.
 */
export async function guardedAction<T>(
  guard: GuardResult,
  fn: () => Promise<T>,
  onBlocked: (reason: string) => void,
): Promise<T | undefined> {
  if (!guard.allowed) {
    onBlocked(guard.reason ?? "Action non autorisée dans cet état.");
    return undefined;
  }
  return fn();
}
