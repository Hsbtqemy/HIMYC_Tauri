"""
Constantes globales du projet HIMYC.

Centralise toutes les valeurs qui étaient hardcodées dans les modules
(HC-01 — audit valeurs hardcodées 2026-03-20).
"""

from __future__ import annotations

# ── Langues ──────────────────────────────────────────────────────────────────

SUPPORTED_LANGUAGES: list[str] = ["en", "fr", "it"]
"""Langues prises en charge par le corpus (pivot + cibles)."""

DEFAULT_PIVOT_LANG: str = "en"
"""Langue pivot par défaut si non spécifiée dans un run d'alignement."""

# ── Noms de fichiers / répertoires ───────────────────────────────────────────

CORPUS_DB_FILENAME:      str = "corpus.db"
RAW_TEXT_FILENAME:       str = "raw.txt"
CLEAN_TEXT_FILENAME:     str = "clean.txt"
SEGMENTS_JSONL_FILENAME: str = "segments.jsonl"
ALIGN_REPORT_FILENAME:   str = "report.json"
EXPORTS_DIR_NAME:        str = "exports"
EPISODES_DIR_NAME:       str = "episodes"

# ── Normalisation ─────────────────────────────────────────────────────────────

DEFAULT_NORMALIZE_PROFILE: str = "default_en_v1"
"""Profil de normalisation utilisé si aucun n'est spécifié."""

# ── Réseau ────────────────────────────────────────────────────────────────────

import os as _os

API_PORT: int = int(_os.environ.get("HIMYC_API_PORT", 8765))
"""Port d'écoute du serveur FastAPI (override via env var HIMYC_API_PORT)."""

# ── Pagination et limites de requête ─────────────────────────────────────────

DEFAULT_AUDIT_LIMIT: int = 50
"""Nombre de liens audit retournés par page par défaut."""

MAX_AUDIT_LIMIT: int = 200
"""Nombre maximum de liens audit par page."""

MAX_KWIC_HITS: int = 2000
"""Nombre maximum de résultats KWIC retournés en une requête."""

FACETS_FETCH_LIMIT: int = 5000
"""Limite interne pour l'agrégation des facettes (avant dédoublonnage)."""

DEFAULT_CUES_LIMIT: int = 20
"""Nombre de cues retournées par défaut dans les requêtes de voisinage."""

DEFAULT_CUES_WINDOW: int = 10
"""Fenêtre de voisinage (±N cues) par défaut pour la recherche de cues."""

MAX_CUES_LIMIT: int = 100
"""Nombre maximum de cues retournées dans une recherche de retargeting."""

# ── KWIC — fenêtre de contexte ────────────────────────────────────────────────

KWIC_CONTEXT_WINDOW: int = 45
"""Nombre de caractères de contexte de chaque côté du match KWIC."""

KWIC_FACETS_WINDOW: int = 5
"""Fenêtre KWIC réduite utilisée pour les agrégations de facettes."""

KWIC_ELLIPSIS: str = "…"
"""Marqueur de troncature dans le contexte KWIC."""

# ── SQLite ────────────────────────────────────────────────────────────────────

SQLITE_BULK_CHUNK_SIZE: int = 500
"""Taille des lots pour les mises à jour bulk (contournement SQLITE_LIMIT_VARIABLE_NUMBER ≈ 999)."""

SQLITE_CACHE_SIZE_KB: int = -64_000
"""PRAGMA cache_size en KB (négatif = KB) — 64 MB."""

SQLITE_MMAP_SIZE: int = 268_435_456
"""PRAGMA mmap_size en octets — 256 MB pour accès mémoire FTS5."""

# ── Valeurs métier ────────────────────────────────────────────────────────────

ALIGN_STATUS_VALUES: tuple[str, ...] = ("auto", "accepted", "rejected", "ignored")
SEGMENT_KIND_VALUES: tuple[str, ...] = ("sentence", "utterance")
QA_POLICY_VALUES:    tuple[str, ...] = ("strict", "lenient")
EXPORT_FORMAT_VALUES: tuple[str, ...] = ("csv", "tsv")

SOURCE_KEY_TRANSCRIPT: str = "transcript"
SOURCE_KEY_SRT_PREFIX:  str = "srt_"
