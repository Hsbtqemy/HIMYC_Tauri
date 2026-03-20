"""Tests de l'adapteur TVMaze."""

from __future__ import annotations

from pathlib import Path

import pytest

from howimetyourcorpus.core.adapters.base import AdapterRegistry
from howimetyourcorpus.core.adapters.tvmaze import TvmazeAdapter


def test_tvmaze_adapter_registered() -> None:
    adapter = AdapterRegistry.get("tvmaze")
    assert adapter is not None
    assert adapter.id == "tvmaze"


def test_tvmaze_fetch_episode_html_accepts_pipeline_kwargs() -> None:
    adapter = TvmazeAdapter()
    with pytest.raises(NotImplementedError):
        adapter.fetch_episode_html(
            "https://www.tvmaze.com/episodes/1/example",
            user_agent="HowIMetYourCorpus/1.0",
            rate_limit_s=1.0,
            cache_dir=Path("."),
        )
