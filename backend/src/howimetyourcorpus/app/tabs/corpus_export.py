"""Helpers d'export pour l'onglet Corpus."""

from __future__ import annotations

from pathlib import Path

from howimetyourcorpus.core.export_utils import (
    export_corpus_csv,
    export_corpus_docx,
    export_corpus_json,
    export_corpus_phrases_csv,
    export_corpus_phrases_jsonl,
    export_corpus_txt,
    export_corpus_utterances_csv,
    export_corpus_utterances_jsonl,
)
from howimetyourcorpus.core.models import EpisodeRef


def build_clean_episodes_data(
    *,
    store,
    episodes: list[EpisodeRef],
    selected_ids: set[str] | None = None,
) -> list[tuple[EpisodeRef, str]]:
    """Construit la liste `(EpisodeRef, clean_text)` pour export corpus."""
    only_selection = selected_ids is not None
    out: list[tuple[EpisodeRef, str]] = []
    for ref in episodes:
        if only_selection and ref.episode_id not in selected_ids:
            continue
        if not store.has_episode_clean(ref.episode_id):
            continue
        text = store.load_episode_text(ref.episode_id, kind="clean")
        out.append((ref, text))
    return out


def export_corpus_by_filter(
    episodes_data: list[tuple[EpisodeRef, str]],
    path: Path,
    selected_filter: str,
) -> bool:
    """Exporte le corpus selon extension/filtre; retourne False si format non reconnu."""
    selected_filter = selected_filter or ""
    suffix = path.suffix.lower()
    if suffix == ".txt" or selected_filter.startswith("TXT"):
        export_corpus_txt(episodes_data, path)
        return True
    if "JSONL - Utterances" in selected_filter:
        export_corpus_utterances_jsonl(episodes_data, path)
        return True
    if "JSONL - Phrases" in selected_filter:
        export_corpus_phrases_jsonl(episodes_data, path)
        return True
    if "CSV - Utterances" in selected_filter:
        export_corpus_utterances_csv(episodes_data, path)
        return True
    if "CSV - Phrases" in selected_filter:
        export_corpus_phrases_csv(episodes_data, path)
        return True
    if suffix == ".csv" or selected_filter.startswith("CSV"):
        export_corpus_csv(episodes_data, path)
        return True
    if suffix == ".json" or "JSON" in selected_filter:
        export_corpus_json(episodes_data, path)
        return True
    if suffix == ".docx" or "Word" in selected_filter:
        export_corpus_docx(episodes_data, path)
        return True
    return False
