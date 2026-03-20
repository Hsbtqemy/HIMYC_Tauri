"""Utilitaires timecodes SRT pour l'onglet Préparer."""

from __future__ import annotations

import re

TIMECODE_RE = re.compile(r"^\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*$")


def parse_srt_time_to_ms(value: str) -> int:
    """Parse un timecode SRT `HH:MM:SS,mmm` (ou `.`) en millisecondes."""
    raw = (value or "").strip()
    m = TIMECODE_RE.match(raw)
    if not m:
        raise ValueError(f"Timecode invalide: {value!r}")
    hh, mm, ss, ms = (int(m.group(i)) for i in range(1, 5))
    if mm > 59 or ss > 59:
        raise ValueError(f"Timecode invalide: {value!r}")
    return ((hh * 60 + mm) * 60 + ss) * 1000 + ms


def format_ms_to_srt_time(ms: int) -> str:
    """Formatte des millisecondes en `HH:MM:SS,mmm`."""
    s, ms_rem = divmod(int(ms), 1000)
    m, s_rem = divmod(s, 60)
    h, m_rem = divmod(m, 60)
    return f"{h:02d}:{m_rem:02d}:{s_rem:02d},{ms_rem:03d}"

