"""Tests de l'adapteur subslikescript (discover + parse) avec fixtures HTML."""

import pytest
from pathlib import Path

from howimetyourcorpus.core.adapters.subslikescript import (
    SubslikescriptAdapter,
    SubslikescriptParseError,
)
from howimetyourcorpus.core.adapters.base import AdapterRegistry


@pytest.fixture
def adapter():
    return SubslikescriptAdapter()


@pytest.fixture
def series_html(fixtures_dir: Path) -> str:
    path = fixtures_dir / "subslikescript_series.html"
    return path.read_text(encoding="utf-8")


@pytest.fixture
def episode_html(fixtures_dir: Path) -> str:
    path = fixtures_dir / "subslikescript_episode.html"
    return path.read_text(encoding="utf-8")


def test_adapter_registered():
    """L'adapteur subslikescript est enregistré."""
    ad = AdapterRegistry.get("subslikescript")
    assert ad is not None
    assert ad.id == "subslikescript"


def test_normalize_episode_id(adapter: SubslikescriptAdapter):
    assert adapter.normalize_episode_id(1, 1) == "S01E01"
    assert adapter.normalize_episode_id(2, 10) == "S02E10"


def test_adapter_subslikescript_discover(
    adapter: SubslikescriptAdapter, series_html: str
):
    """À partir du HTML fixture, vérifier extraction épisodes + ids SxxEyy."""
    index = adapter.discover_series_from_html(series_html, "https://subslikescript.com/series/How_I_Met_Your_Mother-460649")
    assert index.series_title
    assert "How I Met Your Mother" in index.series_title or "Mother" in index.series_title
    assert len(index.episodes) >= 3
    ids = [e.episode_id for e in index.episodes]
    assert "S01E01" in ids
    assert "S01E02" in ids
    assert "S02E01" in ids
    assert index.episodes[0].title == "Pilot"
    assert index.episodes[0].season == 1 and index.episodes[0].episode == 1


def test_adapter_subslikescript_parse_episode(
    adapter: SubslikescriptAdapter, episode_html: str
):
    """Extraction du transcript depuis la fixture épisode."""
    raw_text, meta = adapter.parse_episode(
        episode_html, "https://subslikescript.com/series/Show-1/season-1/episode-1"
    )
    assert "story of how I met your mother" in raw_text
    assert "Ted:" in raw_text
    assert "Marshall:" in raw_text
    assert "Legendary" in raw_text
    assert "MacLaren's Bar" in raw_text
    assert meta.get("selectors_used")
    assert len(raw_text) > 100


def test_adapter_parse_episode_too_short_raises(adapter: SubslikescriptAdapter):
    """HTML sans transcript lève SubslikescriptParseError."""
    html = "<html><body><p>No script here.</p></body></html>"
    with pytest.raises(SubslikescriptParseError) as exc_info:
        adapter.parse_episode(html, "http://example.com/ep")
    assert "short" in str(exc_info.value).lower() or "not found" in str(exc_info.value).lower()


def test_adapter_parse_episode_script_div_too_short_raises(adapter: SubslikescriptAdapter):
    """HTML avec bloc script mais texte trop court (< 50 car) lève SubslikescriptParseError."""
    html = "<html><body><div class=\"full-script\">Hi.</div></body></html>"
    with pytest.raises(SubslikescriptParseError) as exc_info:
        adapter.parse_episode(html, "http://example.com/ep")
    assert "short" in str(exc_info.value).lower() or "not found" in str(exc_info.value).lower()


def test_adapter_discover_broken_html_returns_empty_episodes(adapter: SubslikescriptAdapter):
    """HTML sans structure série (pas de liens épisodes) → liste épisodes vide, pas de crash."""
    html = "<html><head><title>Error 404</title></head><body><p>Page not found.</p></body></html>"
    index = adapter.discover_series_from_html(html, "https://subslikescript.com/series/Unknown-999")
    assert index.episodes == []
    assert index.series_title  # dérivé du title ou URL
    assert "Unknown" in index.series_title or "999" in index.series_title or "Error" in index.series_title


def test_adapter_discover_series_links_changed_returns_empty_episodes(
    adapter: SubslikescriptAdapter, fixtures_dir: Path
):
    """Non-régression scraping : si le site change la structure des liens (ex. data-* au lieu de href),
    discover retourne 0 épisodes sans crasher."""
    path = fixtures_dir / "subslikescript_series_links_changed.html"
    html = path.read_text(encoding="utf-8")
    index = adapter.discover_series_from_html(
        html, "https://subslikescript.com/series/How_I_Met_Your_Mother-460649"
    )
    assert index.episodes == []
    assert "How I Met Your Mother" in index.series_title or "Mother" in index.series_title


def test_adapter_parse_episode_structure_changed_raises(
    adapter: SubslikescriptAdapter, fixtures_dir: Path
):
    """Non-régression scraping : si le transcript est dans un bloc non reconnu (ex. header retiré au fallback),
    parse_episode lève SubslikescriptParseError."""
    path = fixtures_dir / "subslikescript_episode_structure_changed.html"
    html = path.read_text(encoding="utf-8")
    with pytest.raises(SubslikescriptParseError) as exc_info:
        adapter.parse_episode(
            html, "https://subslikescript.com/series/Show-1/season-1/episode-1"
        )
    assert "short" in str(exc_info.value).lower() or "not found" in str(exc_info.value).lower()
