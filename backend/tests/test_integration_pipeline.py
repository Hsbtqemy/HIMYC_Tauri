"""Test d'intégration : pipeline (store + steps) sans GUI.

Vérifie qu'un mini-projet peut être initialisé, qu'un épisode avec clean.txt
est indexé par BuildDbIndexStep, et que la DB contient l'épisode indexé.
"""
from __future__ import annotations

import tempfile
from pathlib import Path


from howimetyourcorpus.core.models import EpisodeRef, ProjectConfig, SeriesIndex
from howimetyourcorpus.core.pipeline.tasks import BuildDbIndexStep
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore


def test_pipeline_init_project_and_build_db_index():
    """Initialise un projet minimal, crée un épisode avec clean.txt, exécute BuildDbIndexStep (synchrone)."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        config = ProjectConfig(
            project_name="test_integ",
            root_dir=root,
            source_id="subslikescript",
            series_url="",
        )
        ProjectStore.init_project(config)
        store = ProjectStore(config.root_dir)

        index = SeriesIndex(
            series_title="Test",
            series_url="",
            episodes=[
                EpisodeRef(
                    episode_id="S01E01",
                    season=1,
                    episode=1,
                    title="Pilot",
                    url="",
                ),
            ],
        )
        store.save_series_index(index)

        ep_dir = root / "episodes" / "S01E01"
        ep_dir.mkdir(parents=True, exist_ok=True)
        (ep_dir / "clean.txt").write_text("Hello world.\nSecond line.", encoding="utf-8")

        db_path = store.get_db_path()
        db = CorpusDB(db_path)
        db.init()

        context = {"config": config, "store": store, "db": db}
        step = BuildDbIndexStep()
        result = step.run(context)

        assert result.success
        assert "S01E01" in db.get_episode_ids_indexed()
