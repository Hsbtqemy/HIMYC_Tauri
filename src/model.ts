/**
 * model.ts — Modèle données source-centric HIMYC (MX-004)
 *
 * Instancie le mapping défini dans MX-016 (NOTE_DESIGN_MX016_MAPPING_DOC_EPISODE_SOURCE.md).
 *
 * Règles clés :
 * - doc_id  = "{episode_id}:{source_key}"  (string composite, frontend uniquement)
 * - doc_role = "original" (transcript) | "translation" (srt_<lang>) | "standalone" (srt-only pivot)
 * - doc_relations = dérivées à la demande depuis EpisodesResponse, pas stockées en DB
 * - pivot/target = concepts exclusifs au mode Aligner (MX-009)
 */

import type { Episode, EpisodeSource, EpisodesResponse } from "./api";

// ── Types canoniques (MX-016) ──────────────────────────────────────────────

export type SourceState =
  | "unknown"
  | "raw"
  | "normalized"
  | "segmented"
  | "ready_for_alignment";

export type DocRole = "original" | "translation" | "standalone";

export interface HimycDoc {
  /** "{episode_id}:{source_key}" — identifiant composite, frontend uniquement */
  doc_id: string;
  episode_key: string;
  source_key: string;
  language: string;
  doc_role: DocRole;
  title: string;
  state: SourceState;
  /** Métadonnées optionnelles selon source_key */
  nb_cues?: number;
  format?: string;
}

export interface HimycDocRelation {
  doc_id: string;
  relation_type: "translation_of";
  target_doc_id: string;
}

// ── Helpers canoniques ─────────────────────────────────────────────────────

/**
 * Construit le doc_id composite pour une source donnée.
 * ex: docId("S01E01", "srt_en") → "S01E01:srt_en"
 */
export function docId(episodeKey: string, sourceKey: string): string {
  return `${episodeKey}:${sourceKey}`;
}

/**
 * Décode un doc_id composite en ses parties constitutives.
 * Retourne null si le format est invalide.
 */
export function parseDocId(
  id: string,
): { episodeKey: string; sourceKey: string } | null {
  const colon = id.indexOf(":");
  if (colon <= 0 || colon === id.length - 1) return null;
  return { episodeKey: id.slice(0, colon), sourceKey: id.slice(colon + 1) };
}

/**
 * Résout la langue d'une source depuis son source_key ou le champ language.
 * transcript → "en" par convention (ou "" si non renseigné)
 * srt_en → "en", srt_fr → "fr", etc.
 */
export function resolveLanguage(source: EpisodeSource): string {
  if (source.language) return source.language;
  if (source.source_key.startsWith("srt_")) {
    return source.source_key.slice(4); // "srt_en" → "en"
  }
  return "";
}

/**
 * Détermine le doc_role d'une source dans le contexte d'un épisode.
 *
 * Règles (MX-016) :
 * - transcript → "original" (s'il existe, il est toujours pivot)
 * - srt_<lang> quand transcript existe → "translation"
 * - srt_<lang> quand transcript absent :
 *     - la première langue listée (pivot primaire) → "standalone"
 *     - les autres → "translation"
 */
export function resolveDocRole(
  source: EpisodeSource,
  allSources: EpisodeSource[],
): DocRole {
  if (source.source_key === "transcript") return "original";

  const hasTranscript = allSources.some(
    (s) => s.source_key === "transcript" && s.available,
  );
  if (hasTranscript) return "translation";

  // srt-only : premier SRT disponible = standalone (pivot langue primaire)
  const availableSrts = allSources.filter(
    (s) => s.source_key.startsWith("srt_") && s.available,
  );
  if (availableSrts.length > 0 && availableSrts[0].source_key === source.source_key) {
    return "standalone";
  }
  return "translation";
}

// ── Fonctions de projection MX-016 ────────────────────────────────────────

/**
 * Projette une (episode, source) en HimycDoc canonique.
 */
export function episodeSourceToDoc(
  episode: Episode,
  source: EpisodeSource,
): HimycDoc {
  const seriesTitle = ""; // fourni séparément depuis EpisodesResponse si nécessaire
  const title = `${episode.title} — ${episode.episode_id}`;
  const language = resolveLanguage(source);
  const doc_role = resolveDocRole(source, episode.sources);
  const state: SourceState = (source.state as SourceState) ?? "unknown";

  return {
    doc_id: docId(episode.episode_id, source.source_key),
    episode_key: episode.episode_id,
    source_key: source.source_key,
    language,
    doc_role,
    title,
    state,
    nb_cues: source.nb_cues,
    format: source.format,
  };
}

/**
 * Dérive les relations inter-sources d'un épisode (MX-016).
 *
 * Relations calculées à la demande — pas stockées en DB.
 *
 * Cas 1 — transcript + srt_<lang> : srt_<lang> "translation_of" transcript
 * Cas 2 — srt-only : srt_<lang> (non-pivot) "translation_of" srt_<pivot>
 * Cas 3 — transcript seul : 0 relation
 */
export function deriveDocRelations(episode: Episode): HimycDocRelation[] {
  const available = episode.sources.filter((s) => s.available);
  const transcript = available.find((s) => s.source_key === "transcript");

  if (transcript) {
    // Cas 1 : toutes les SRT sont "translation_of" transcript
    return available
      .filter((s) => s.source_key.startsWith("srt_"))
      .map((s) => ({
        doc_id: docId(episode.episode_id, s.source_key),
        relation_type: "translation_of" as const,
        target_doc_id: docId(episode.episode_id, "transcript"),
      }));
  }

  // Cas 2 : srt-only — pivot = premier SRT disponible
  const srts = available.filter((s) => s.source_key.startsWith("srt_"));
  if (srts.length < 2) return []; // 0 ou 1 SRT → pas de relation à exprimer

  const [pivot, ...others] = srts;
  return others.map((s) => ({
    doc_id: docId(episode.episode_id, s.source_key),
    relation_type: "translation_of" as const,
    target_doc_id: docId(episode.episode_id, pivot.source_key),
  }));
}

/**
 * Projette une EpisodesResponse complète en tableau de HimycDoc.
 * Ne retourne que les sources disponibles (available=true).
 */
export function episodesToDocs(response: EpisodesResponse): HimycDoc[] {
  const docs: HimycDoc[] = [];
  for (const episode of response.episodes) {
    for (const source of episode.sources) {
      if (source.available) {
        docs.push(episodeSourceToDoc(episode, source));
      }
    }
  }
  return docs;
}

/**
 * Vérifie qu'un source_key est valide (canonique).
 * Valeurs acceptées : "transcript", "srt_<2-5 chars alphanum>".
 */
export function isValidSourceKey(key: string): boolean {
  if (key === "transcript") return true;
  return /^srt_[a-z]{2,5}$/.test(key);
}

/**
 * Résout le pivot SRT pour un épisode srt-only.
 * Retourne le source_key du pivot (premier SRT disponible) ou null.
 */
export function resolveSrtPivot(episode: Episode): string | null {
  const hasTranscript = episode.sources.some(
    (s) => s.source_key === "transcript" && s.available,
  );
  if (hasTranscript) return null; // pas srt-only

  const first = episode.sources.find(
    (s) => s.source_key.startsWith("srt_") && s.available,
  );
  return first?.source_key ?? null;
}
