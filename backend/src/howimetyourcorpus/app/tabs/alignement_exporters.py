"""Helpers d'export pour l'onglet Alignement."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.export_utils import (
    export_parallel_concordance_csv,
    export_parallel_concordance_docx,
    export_parallel_concordance_html,
    export_parallel_concordance_jsonl,
    export_parallel_concordance_tsv,
    export_parallel_concordance_txt,
)

_ALLOWED_PARALLEL_EXTENSIONS = (".csv", ".tsv", ".txt", ".html", ".jsonl", ".docx")


def normalize_parallel_export_path(path: str, selected_filter: str | None = None) -> Path:
    """Normalise le chemin d'export parallèle selon le filtre choisi."""
    normalized = Path(path)
    chosen_filter = (selected_filter or "").strip()
    if normalized.suffix.lower() != ".docx" and chosen_filter.startswith("Word"):
        normalized = normalized.with_suffix(".docx")
    if normalized.suffix.lower() not in _ALLOWED_PARALLEL_EXTENSIONS:
        normalized = normalized.with_suffix(".csv")
    return normalized


def export_parallel_rows(rows: list[dict[str, Any]], path: Path, title: str) -> None:
    """Exporte des lignes parallèles selon l'extension du fichier."""
    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        export_parallel_concordance_jsonl(rows, path)
    elif suffix == ".tsv":
        export_parallel_concordance_tsv(rows, path)
    elif suffix == ".txt":
        export_parallel_concordance_txt(rows, path)
    elif suffix == ".html":
        export_parallel_concordance_html(rows, path, title=title)
    elif suffix == ".docx":
        export_parallel_concordance_docx(rows, path)
    else:
        export_parallel_concordance_csv(rows, path)


def export_alignment_links(path: Path, links: list[dict[str, Any]]) -> None:
    """Exporte les liens d'alignement en CSV ou JSONL."""
    if path.suffix.lower() == ".jsonl":
        with path.open("w", encoding="utf-8") as handle:
            for row in links:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return

    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "link_id",
                "segment_id",
                "cue_id",
                "cue_id_target",
                "lang",
                "role",
                "confidence",
                "status",
                "meta",
            ]
        )
        for row in links:
            meta = row.get("meta")
            meta_str = json.dumps(meta, ensure_ascii=False) if meta else ""
            writer.writerow(
                [
                    row.get("link_id"),
                    row.get("segment_id"),
                    row.get("cue_id"),
                    row.get("cue_id_target"),
                    row.get("lang"),
                    row.get("role"),
                    row.get("confidence"),
                    row.get("status"),
                    meta_str,
                ]
            )
