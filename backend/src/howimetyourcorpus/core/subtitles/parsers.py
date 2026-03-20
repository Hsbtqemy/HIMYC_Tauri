"""
Parsing SRT / VTT (Phase 3).
Cue dataclass + parse_srt / parse_vtt avec normalisation minimaliste (text_clean).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# SRT: HH:MM:SS,MMM --> HH:MM:SS,MMM
SRT_TIMECODE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,](\d{3})"
)
# VTT: HH:MM:SS.MMM --> HH:MM:SS.MMM (ou MM:SS.MMM)
VTT_TIMECODE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.](\d{3})"
)
VTT_TIMECODE_SHORT = re.compile(
    r"(\d{2}):(\d{2})[.](\d{3})\s*-->\s*(\d{2}):(\d{2})[.](\d{3})"
)
# Tags VTT à supprimer : <v Name>, </v>, <i>, </i>, <b>, </b>, <u>, </u>, <c>, </c>
VTT_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
# Espaces multiples
MULTI_SPACE = re.compile(r"\s+")


def _timecode_to_ms(h: int, m: int, s: int, ms: int) -> int:
    return ((h * 60 + m) * 60 + s) * 1000 + ms


def _normalize_cue_text(raw: str) -> str:
    """Normalisation minimaliste : suppression tags, espaces, sauts de ligne."""
    if not raw:
        return ""
    t = VTT_TAG.sub(" ", raw)
    t = t.replace("\n", " ").replace("\r", " ")
    t = MULTI_SPACE.sub(" ", t).strip()
    return t


@dataclass
class Cue:
    """
    Une cue sous-titre (timecodée).
    cue_id = "{episode_id}:{lang}:{n}" (à définir côté appelant si episode_id/lang connu).
    """

    episode_id: str = ""
    lang: str = "en"
    n: int = 0
    start_ms: int = 0
    end_ms: int = 0
    text_raw: str = ""
    text_clean: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def cue_id(self) -> str:
        if self.episode_id and self.lang:
            return f"{self.episode_id}:{self.lang}:{self.n}"
        return f":{self.lang}:{self.n}"


def parse_srt(content: str, source_path: str = "") -> list[Cue]:
    """
    Parse le contenu SRT. Retourne une liste de Cue (text_clean normalisé).
    """
    cues: list[Cue] = []
    meta: dict[str, Any] = {}
    if source_path:
        meta["source_path"] = source_path
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    n = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        m = SRT_TIMECODE.match(line)
        if m:
            h1, m1, s1, ms1 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            h2, m2, s2, ms2 = int(m.group(5)), int(m.group(6)), int(m.group(7)), int(m.group(8))
            start_ms = _timecode_to_ms(h1, m1, s1, ms1)
            end_ms = _timecode_to_ms(h2, m2, s2, ms2)
            i += 1
            text_lines: list[str] = []
            while i < len(lines):
                stripped = lines[i].strip()
                if not stripped:
                    i += 1
                    break
                if SRT_TIMECODE.match(stripped) or stripped.isdigit():
                    break
                text_lines.append(stripped)
                i += 1
            text_raw = "\n".join(text_lines)
            text_clean = _normalize_cue_text(text_raw)
            cues.append(
                Cue(
                    n=n,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    text_raw=text_raw,
                    text_clean=text_clean,
                    meta=dict(meta),
                )
            )
            n += 1
        else:
            i += 1
    return cues


def parse_vtt(content: str, source_path: str = "") -> list[Cue]:
    """
    Parse le contenu VTT (WEBVTT). Ignore NOTE/STYLE/REGION. Retourne une liste de Cue.
    """
    cues: list[Cue] = []
    meta: dict[str, Any] = {}
    if source_path:
        meta["source_path"] = source_path
    text = content.replace("\r\n", "\n").replace("\r", "\n")
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = text.split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip().upper().startswith("WEBVTT"):
        i += 1
    if i < len(lines):
        i += 1
    n = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.upper().startswith("NOTE") or line.upper().startswith("STYLE") or line.upper().startswith("REGION"):
            i += 1
            while i < len(lines) and lines[i].strip():
                i += 1
            continue
        m = VTT_TIMECODE.match(line)
        if not m:
            m = VTT_TIMECODE_SHORT.match(line)
            if m:
                m1, s1, ms1 = int(m.group(1)), int(m.group(2)), int(m.group(3))
                m2, s2, ms2 = int(m.group(4)), int(m.group(5)), int(m.group(6))
                start_ms = (m1 * 60 + s1) * 1000 + ms1
                end_ms = (m2 * 60 + s2) * 1000 + ms2
            else:
                i += 1
                continue
        else:
            h1, m1, s1, ms1 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            h2, m2, s2, ms2 = int(m.group(5)), int(m.group(6)), int(m.group(7)), int(m.group(8))
            start_ms = _timecode_to_ms(h1, m1, s1, ms1)
            end_ms = _timecode_to_ms(h2, m2, s2, ms2)
        i += 1
        text_lines = []
        while i < len(lines) and lines[i].strip():
            text_lines.append(lines[i].strip())
            i += 1
        text_raw = "\n".join(text_lines)
        text_clean = _normalize_cue_text(text_raw)
        cues.append(
            Cue(
                n=n,
                start_ms=start_ms,
                end_ms=end_ms,
                text_raw=text_raw,
                text_clean=text_clean,
                meta=dict(meta),
            )
        )
        n += 1
    return cues


def parse_subtitle_content(content: str, source_path: str = "") -> tuple[list[Cue], str]:
    """
    Parse le contenu déjà lu (SRT ou VTT). Détecte le format par extension ou en-tête WEBVTT.
    Retourne (cues, "srt"|"vtt"). À privilégier pour éviter de lire le fichier deux fois.
    """
    if "WEBVTT" in content[:20]:
        return parse_vtt(content, source_path), "vtt"
    return parse_srt(content, source_path), "srt"


# Encodages à essayer à l'import (fichiers Windows / utilisateur)
_SUBTITLE_ENCODINGS = ("utf-8", "cp1252", "latin-1")


def read_subtitle_file_content(path: Path) -> str:
    """
    Lit le contenu d'un fichier SRT/VTT en essayant utf-8, puis cp1252, puis latin-1.
    Retourne la chaîne en Unicode (à écrire en UTF-8 côté projet si besoin).
    """
    last_error: Exception | None = None
    for enc in _SUBTITLE_ENCODINGS:
        try:
            return path.read_text(encoding=enc)
        except (UnicodeDecodeError, LookupError) as e:
            last_error = e
            continue
    if last_error:
        return path.read_text(encoding="utf-8", errors="replace")
    return path.read_text(encoding="utf-8", errors="replace")


def parse_subtitle_file(path: Path, lang_hint: str = "en") -> tuple[list[Cue], str]:
    """
    Détecte le format (SRT/VTT) et parse. Retourne (cues, format "srt"|"vtt").
    lang_hint réservé pour usage futur (ex. métadonnées).
    Utilise un fallback d'encodage (utf-8 → cp1252 → latin-1) pour les fichiers Windows.
    """
    content = read_subtitle_file_content(path)
    suffix = path.suffix.lower()
    if suffix == ".vtt":
        cues = parse_vtt(content, str(path))
        return cues, "vtt"
    if suffix == ".srt":
        cues = parse_srt(content, str(path))
        return cues, "srt"
    return parse_subtitle_content(content, str(path))


def _ms_to_srt_time(ms: int) -> str:
    """Convertit des millisecondes en timecode SRT HH:MM:SS,mmm."""
    s, ms_rem = divmod(ms, 1000)
    m, s_rem = divmod(s, 60)
    h, m_rem = divmod(m, 60)
    return f"{h:02d}:{m_rem:02d}:{s_rem:02d},{ms_rem:03d}"


def cues_to_srt(cues: list[dict]) -> str:
    """
    Sérialise une liste de cues (dict avec start_ms, end_ms, text_clean, n) en contenu SRT.
    Utilisé pour réécrire les fichiers SRT après propagation des noms de personnages (§8).
    """
    blocks: list[str] = []
    for c in sorted(cues, key=lambda x: (x.get("n", 0), x.get("start_ms", 0))):
        n = c.get("n", 0)
        start_ms = int(c.get("start_ms", 0))
        end_ms = int(c.get("end_ms", 0))
        text = (c.get("text_clean") or c.get("text_raw") or "").strip()
        blocks.append(f"{n}\n{_ms_to_srt_time(start_ms)} --> {_ms_to_srt_time(end_ms)}\n{text}")
    return "\n\n".join(blocks) + "\n" if blocks else ""


def cues_to_audit_rows(cues: list[Cue]) -> list[dict[str, Any]]:
    """Convertit une liste de `Cue` en lignes JSON auditables/persistables."""
    return [
        {
            "cue_id": c.cue_id,
            "n": c.n,
            "start_ms": c.start_ms,
            "end_ms": c.end_ms,
            "text_raw": c.text_raw,
            "text_clean": c.text_clean,
        }
        for c in cues
    ]
