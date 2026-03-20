"""
Alignement segment ↔ cues EN et cues EN ↔ cues target (Phase 4).
Stratégie heuristique : similarité textuelle (segment↔EN), recouvrement temporel (EN↔target).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from howimetyourcorpus.core.align.similarity import text_similarity


@dataclass
class AlignLink:
    """Un lien d'alignement (segment↔cue ou cue↔cue)."""
    link_id: str = ""
    segment_id: str | None = None
    cue_id: str | None = None
    cue_id_target: str | None = None
    lang: str = ""
    role: str = "pivot"  # "pivot" | "target"
    confidence: float = 0.0
    status: str = "auto"  # "auto" | "accepted" | "rejected"
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, link_id: str = "") -> dict:
        """Pour upsert en DB."""
        return {
            "link_id": link_id or self.link_id,
            "segment_id": self.segment_id,
            "cue_id": self.cue_id,
            "cue_id_target": self.cue_id_target,
            "lang": self.lang,
            "role": self.role,
            "confidence": self.confidence,
            "status": self.status,
            "meta": self.meta,
        }


def align_segments_to_cues(
    segments: list[dict],
    cues_en: list[dict],
    max_cues_per_segment: int = 5,
    min_confidence: float = 0.3,
    on_progress: Callable[[int, int], None] | None = None,
    monotonic: bool = True,
) -> list[AlignLink]:
    """
    Aligne les segments (phrases) aux cues EN par similarité textuelle.
    Chaque segment est comparé à chaque cue (et à des concaténations de 1..K cues).
    Retourne une liste de AlignLink (segment_id, cue_id, role=pivot, confidence).

    Si monotonic=True (défaut), les liens respectent l'ordre : un segment ne peut s'aligner
    qu'à une cue d'index >= dernière cue utilisée, ce qui évite les croisements (segment 1 ↔ cue 45).

    Choix métier : une même cue peut être liée à plusieurs segments (une ligne de
    sous-titre peut couvrir plusieurs phrases). used_cue_indices est maintenu pour
    une évolution future (bijection partielle) mais n'est pas utilisé pour filtrer.
    
    Args:
        on_progress: callback(current, total) pour progression granulaire (optionnel).
        monotonic: si True, contrainte d'ordre (pas de réorganisation en croix).
    """
    links: list[AlignLink] = []
    used_cue_indices: set[int] = set()  # Réservé pour évolution (bijection partielle)
    last_used_cue_index: int = -1  # Pour contrainte monotone
    total_segments = len(segments)
    for idx, seg in enumerate(segments):
        seg_id = seg.get("segment_id") or ""
        seg_text = (seg.get("text") or "").strip()
        if not seg_text:
            continue
        best_score = min_confidence
        best_cue_id: str | None = None
        best_n = 0
        best_cue_index = -1
        # Si monotonic : ne considérer que les cues à partir de last_used_cue_index + 1
        start_i = (last_used_cue_index + 1) if monotonic else 0
        for i in range(start_i, len(cues_en)):
            cue = cues_en[i]
            cue_text = (cue.get("text_clean") or cue.get("text_raw") or "").strip()
            score = text_similarity(seg_text, cue_text)
            if score > best_score:
                best_score = score
                best_cue_id = cue.get("cue_id")
                best_n = 1
                best_cue_index = i
            for n in range(2, min(max_cues_per_segment + 1, len(cues_en) - i + 1)):
                combined = " ".join(
                    (c.get("text_clean") or c.get("text_raw") or "").strip()
                    for c in cues_en[i : i + n]
                )
                s = text_similarity(seg_text, combined)
                if s > best_score:
                    best_score = s
                    best_cue_id = cue.get("cue_id")
                    best_n = n
                    best_cue_index = i
        if best_cue_id and best_score >= min_confidence:
            used_cue_indices.add(next(j for j, c in enumerate(cues_en) if c.get("cue_id") == best_cue_id))
            if monotonic and best_cue_index >= 0:
                last_used_cue_index = max(last_used_cue_index, best_cue_index + best_n - 1)
            links.append(
                AlignLink(
                    segment_id=seg_id,
                    cue_id=best_cue_id,
                    lang="en",
                    role="pivot",
                    confidence=round(best_score, 4),
                    status="auto",
                    meta={"n_cues": best_n},
                )
            )
        # Émettre progression
        if on_progress:
            on_progress(idx + 1, total_segments)
    return links


def cues_have_timecodes(cues: list[dict]) -> bool:
    """
    True si au moins une cue a des timecodes utilisables (start_ms < end_ms).
    Utilisé pour choisir align_cues_by_time vs align_cues_by_order.
    """
    if not cues:
        return False
    for c in cues:
        start = int(c.get("start_ms") or 0)
        end = int(c.get("end_ms") or 0)
        if end > start:
            return True
    return False


def align_cues_by_similarity(
    cues_pivot: list[dict],
    cues_target: list[dict],
    min_confidence: float = 0.3,
) -> list[AlignLink]:
    """
    Aligne les cues pivot (EN) aux cues target (FR) par similarité textuelle.
    Utilisé quand les timecodes sont absents ou peu fiables.
    Chaque cue pivot est appariée à la cue target la plus similaire (greedy, une cible au plus une fois).
    """
    links: list[AlignLink] = []
    lang = cues_target[0].get("lang", "") if cues_target else ""
    used_target_indices: set[int] = set()
    for cp in cues_pivot:
        p_text = (cp.get("text_clean") or cp.get("text_raw") or "").strip()
        if not p_text:
            continue
        best_score = min_confidence
        best_idx = -1
        for j, ct in enumerate(cues_target):
            if j in used_target_indices:
                continue
            t_text = (ct.get("text_clean") or ct.get("text_raw") or "").strip()
            score = text_similarity(p_text, t_text)
            if score > best_score:
                best_score = score
                best_idx = j
        if best_idx >= 0:
            used_target_indices.add(best_idx)
            ct = cues_target[best_idx]
            pid = cp.get("cue_id")
            tid = ct.get("cue_id")
            if pid and tid:
                links.append(
                    AlignLink(
                        cue_id=pid,
                        cue_id_target=tid,
                        lang=lang,
                        role="target",
                        confidence=round(best_score, 4),
                        status="auto",
                        meta={"align": "by_similarity"},
                    )
                )
    return links


def align_cues_by_order(
    cues_pivot: list[dict],
    cues_target: list[dict],
) -> list[AlignLink]:
    """
    Aligne les cues pivot aux cues target par indice : cue i ↔ cue i.
    Utilisé quand les timecodes sont absents ou tous à zéro (fichiers parallèles).
    Retourne une liste de AlignLink (cue_id=pivot, cue_id_target=target, role=target, confidence=1.0).
    """
    links: list[AlignLink] = []
    lang = cues_target[0].get("lang", "") if cues_target else ""
    for i, cp in enumerate(cues_pivot):
        if i >= len(cues_target):
            break
        ct = cues_target[i]
        pid = cp.get("cue_id")
        tid = ct.get("cue_id")
        if pid and tid:
            links.append(
                AlignLink(
                    cue_id=pid,
                    cue_id_target=tid,
                    lang=lang,
                    role="target",
                    confidence=1.0,
                    status="auto",
                    meta={"align": "by_order", "index": i},
                )
            )
    return links


def align_cues_by_time(
    cues_pivot: list[dict],
    cues_target: list[dict],
    overlap_ms_threshold: int = 100,
) -> list[AlignLink]:
    """
    Aligne les cues pivot (EN) aux cues target (FR) par recouvrement temporel.
    Deux cues s'alignent si [start_ms, end_ms] se recouvrent d'au moins overlap_ms_threshold ms.
    Retourne une liste de AlignLink (cue_id=pivot, cue_id_target=target, role=target, confidence).
    """
    links: list[AlignLink] = []
    for cp in cues_pivot:
        pid = cp.get("cue_id")
        p_start = int(cp.get("start_ms") or 0)
        p_end = int(cp.get("end_ms") or 0)
        best_overlap = 0
        best_target_id: str | None = None
        for ct in cues_target:
            t_start = int(ct.get("start_ms") or 0)
            t_end = int(ct.get("end_ms") or 0)
            overlap = max(0, min(p_end, t_end) - max(p_start, t_start))
            if overlap >= overlap_ms_threshold and overlap > best_overlap:
                best_overlap = overlap
                best_target_id = ct.get("cue_id")
        if best_target_id:
            dur = max(1, p_end - p_start)
            confidence = min(1.0, best_overlap / dur)
            links.append(
                AlignLink(
                    cue_id=pid,
                    cue_id_target=best_target_id,
                    lang=cues_target[0].get("lang", "") if cues_target else "",
                    role="target",
                    confidence=round(confidence, 4),
                    status="auto",
                    meta={"overlap_ms": best_overlap},
                )
            )
    return links
