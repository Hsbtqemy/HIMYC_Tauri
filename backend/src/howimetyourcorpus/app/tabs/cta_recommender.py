"""Moteur de recommandation CTA Inspecteur — US-302.

Source de vérité : US-301_MATRICE_CTA.md (gelée avant Sprint 3).
Aucune règle ad hoc ne doit être ajoutée ici sans mise à jour préalable de la matrice.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Modes de travail (colonnes de la matrice)
# ---------------------------------------------------------------------------

class CtaMode:
    TRANSCRIPT_FIRST = "transcript-first"
    SRT_ONLY = "srt-only"
    SIMILARITY = "similarity"
    ALIGNED = "aligned"
    INCOMPLETE = "incomplete"


# ---------------------------------------------------------------------------
# Entrée : état de l'épisode
# ---------------------------------------------------------------------------

@dataclass
class EpisodeState:
    """État observable de l'épisode courant, dérivé des données réelles."""
    has_raw: bool = False
    has_clean: bool = False
    has_segments: bool = False
    has_tracks: bool = False
    has_alignment_run: bool = False
    use_similarity: bool = False

    def missing(self) -> list[str]:
        """Liste des éléments manquants pour l'alignement complet."""
        items = []
        if not self.has_clean:
            items.append("CLEAN")
        if not self.has_segments:
            items.append("segments")
        if not self.has_tracks:
            items.append("tracks SRT")
        return items


# ---------------------------------------------------------------------------
# Sortie : recommandation
# ---------------------------------------------------------------------------

@dataclass
class CtaRecommendation:
    """Recommandation CTA résultant de l'application de la matrice."""
    action_id: str
    label: str
    detail: str
    mode: str
    missing: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Matrice — US-301 (gelée)
# ---------------------------------------------------------------------------

def recommend(state: EpisodeState) -> CtaRecommendation:
    """Applique la matrice CTA US-301 et retourne la prochaine action recommandée.

    Règles (par priorité décroissante) :
      1. Déjà aligné → consulter/exporter.
      2. Mode similarité activé + tracks → lancer par similarité.
      3. Transcript-first complet (clean + segments + tracks) → lancer alignement.
      4. CLEAN + segments, pas de tracks → importer SRT.
      5. CLEAN présent, pas de segments (avec ou sans tracks) → segmenter.
      6. Tracks seuls, pas de transcript → SRT-only.
      7. RAW seul, pas de CLEAN → normaliser.
      8. Rien → démarrer (télécharger transcript ou importer SRT).
    """
    # 1. Déjà aligné
    if state.has_alignment_run:
        return CtaRecommendation(
            action_id="consult_alignment",
            label="Consulter ou exporter l'alignement",
            detail="Un run d'alignement existe. Ouvrez l'onglet Alignement pour consulter ou exporter.",
            mode=CtaMode.ALIGNED,
        )

    # 2. Mode similarité + tracks présents
    if state.use_similarity and state.has_tracks:
        return CtaRecommendation(
            action_id="run_alignment_similarity",
            label="Lancer l'alignement par similarité",
            detail="Mode similarité activé. Ignorez les timecodes : l'alignement apparie EN↔cible par similarité textuelle.",
            mode=CtaMode.SIMILARITY,
        )

    # 3. Transcript-first complet
    if state.has_clean and state.has_segments and state.has_tracks:
        return CtaRecommendation(
            action_id="run_alignment_transcript_first",
            label="Lancer l'alignement transcript-first",
            detail="Épisode complet (CLEAN + segments + SRT). Ouvrez l'onglet Alignement → Lancer alignement.",
            mode=CtaMode.TRANSCRIPT_FIRST,
        )

    # 4. CLEAN + segments mais pas de tracks
    if state.has_clean and state.has_segments and not state.has_tracks:
        return CtaRecommendation(
            action_id="import_srt",
            label="Importer des SRT",
            detail="Transcript segmenté présent. Il manque les pistes SRT. Cliquez « Outils SRT ▸ » en haut de l'Inspecteur pour importer.",
            mode=CtaMode.INCOMPLETE,
            missing=["tracks SRT"],
        )

    # 5. CLEAN présent, pas de segments (avec ou sans tracks)
    if state.has_clean and not state.has_segments:
        if state.has_tracks:
            return CtaRecommendation(
                action_id="segment_or_srt_only",
                label="Segmenter le transcript ou lancer en mode SRT-only",
                detail="CLEAN présent + SRT importés. Option A : segmenter (Inspecteur) puis aligner transcript-first. "
                       "Option B : lancer directement en mode SRT-only (cue↔cue) depuis l'onglet Alignement.",
                mode=CtaMode.SRT_ONLY,
            )
        return CtaRecommendation(
            action_id="segment_episode",
            label="Segmenter l'épisode",
            detail="CLEAN présent mais pas de segments. Inspecteur → bloc Produire → Segmenter l'épisode.",
            mode=CtaMode.INCOMPLETE,
            missing=["segments"],
        )

    # 6. Tracks seuls, pas de CLEAN ni de segments → SRT-only
    if state.has_tracks and not state.has_clean and not state.has_segments:
        return CtaRecommendation(
            action_id="run_alignment_srt_only",
            label="Lancer l'alignement SRT-only",
            detail="Pas de transcript segmenté. Alignement cue↔cue pivot/cible disponible. "
                   "Ouvrez l'onglet Alignement → Lancer alignement.",
            mode=CtaMode.SRT_ONLY,
        )

    # 7. RAW seul, pas de CLEAN
    if state.has_raw and not state.has_clean:
        return CtaRecommendation(
            action_id="normalize_episode",
            label="Normaliser le transcript",
            detail="RAW présent mais pas de CLEAN. Inspecteur → Normaliser cet épisode.",
            mode=CtaMode.INCOMPLETE,
            missing=["CLEAN", "segments", "tracks SRT"],
        )

    # 8. Rien de disponible
    return CtaRecommendation(
        action_id="start",
        label="Démarrer : télécharger le transcript ou importer des SRT",
        detail="Aucune donnée pour cet épisode. Option A : télécharger le transcript (onglet Projet → Corpus). "
               "Option B : importer des SRT via « Outils SRT ▸ » en haut de l'Inspecteur.",
        mode=CtaMode.INCOMPLETE,
        missing=["CLEAN", "segments", "tracks SRT"],
    )
