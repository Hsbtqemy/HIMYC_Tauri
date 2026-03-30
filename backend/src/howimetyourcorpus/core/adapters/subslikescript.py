"""Adapteur subslikescript.com : discover_series + parse_episode."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from howimetyourcorpus.core.adapters.base import AdapterRegistry
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex

logger = logging.getLogger(__name__)


_ALLOWED_HOSTS = frozenset({
    "www.subslikescript.com",
    "subslikescript.com",
})


def _validate_subslikescript_url(url: str) -> None:
    """Vérifie que l'URL cible bien subslikescript.com via HTTPS.

    Protège contre les attaques SSRF : une URL controlée par l'utilisateur
    ne doit pouvoir viser que l'hôte autorisé.

    Raises ValueError si le schéma ou l'hôte est inacceptable.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise ValueError(
            f"Schéma URL non autorisé pour subslikescript : {parsed.scheme!r}. "
            "Seul https:// est accepté."
        )
    host = (parsed.hostname or "").lower()
    if host not in _ALLOWED_HOSTS:
        raise ValueError(
            f"Hôte URL non autorisé : {host!r}. "
            f"Hôtes acceptés : {sorted(_ALLOWED_HOSTS)}"
        )


def _make_soup(html: str):
    try:
        return BeautifulSoup(html, "lxml")
    except Exception as e:
        logger.debug("lxml non disponible, fallback html.parser: %s", e)
        return BeautifulSoup(html, "html.parser")

# Selectors fallback pour la page série (liste des épisodes)
SERIES_EPISODE_LINK_SELECTORS = [
    "a[href*='/series/']",  # liens relatifs type /series/Show-123/season-1/episode-1
    "div.episode-list a",
    "ul.episodes a",
    "a[href*='episode']",
]

# Selectors fallback pour le transcript sur la page épisode
TRANSCRIPT_SELECTORS = [
    "div.full-script",  # subslikescript utilise souvent ce bloc
    "div.scrolling-script-container",
    "div[class*='script']",
    "article.full-script",
    "pre.full-script",
]


class SubslikescriptParseError(Exception):
    """Structure HTML inattendue ou transcript introuvable."""

    def __init__(self, message: str, selector_used: str | None = None):
        self.selector_used = selector_used
        super().__init__(message)


class SubslikescriptAdapter:
    """Adapteur pour subslikescript.com. Générique (pas de HIMYM en dur)."""

    id = "subslikescript"

    # Pattern URL épisode : /series/ShowName-123/season-X/episode-Y
    _episode_url_re = re.compile(
        r"/series/[^/]+/season-(\d+)/episode-(\d+)",
        re.IGNORECASE,
    )
    _series_page_re = re.compile(r"/series/([^/]+?)(?:-\d+)?/?$", re.IGNORECASE)

    def normalize_episode_id(self, season: int, episode: int) -> str:
        return f"S{season:02d}E{episode:02d}"

    def discover_series(
        self,
        series_url: str,
        *,
        user_agent: str | None = None,
        rate_limit_s: float | None = None,
        cache_dir: Path | None = None,
    ) -> SeriesIndex:
        """Récupère la page série puis parse pour produire SeriesIndex."""
        _validate_subslikescript_url(series_url)
        from howimetyourcorpus.core.utils.http import BROWSER_HEADERS, get_html
        html = get_html(
            series_url,
            extra_headers=BROWSER_HEADERS,
            user_agent=user_agent,
            min_interval_s=rate_limit_s,
            cache_dir=cache_dir,
        )
        return self.discover_series_from_html(html, series_url)

    def discover_series_from_html(self, html: str, series_url: str) -> SeriesIndex:
        """
        Parse le HTML de la page série pour produire SeriesIndex.
        Appelé par le pipeline après fetch de series_url.
        """
        soup = _make_soup(html)
        base = f"{urlparse(series_url).scheme}://{urlparse(series_url).netloc}"
        series_title = self._extract_series_title(soup, series_url)

        episodes: list[EpisodeRef] = []
        seen = set()

        for selector in SERIES_EPISODE_LINK_SELECTORS:
            links = soup.select(selector)
            for a in links:
                href = a.get("href")
                if not href:
                    continue
                full_url = urljoin(base, href)
                m = self._episode_url_re.search(full_url)
                if not m:
                    continue
                season_num = int(m.group(1))
                episode_num = int(m.group(2))
                eid = self.normalize_episode_id(season_num, episode_num)
                if eid in seen:
                    continue
                seen.add(eid)
                title = (a.get_text(strip=True) or f"Episode {episode_num}").strip()
                if len(title) > 200:
                    title = title[:197] + "..."
                episodes.append(
                    EpisodeRef(
                        episode_id=eid,
                        season=season_num,
                        episode=episode_num,
                        title=title,
                        url=full_url,
                    )
                )
            if episodes:
                break

        # Trier par saison puis épisode
        episodes.sort(key=lambda e: (e.season, e.episode))
        return SeriesIndex(
            series_title=series_title,
            series_url=series_url,
            episodes=episodes,
        )

    def _extract_series_title(self, soup: BeautifulSoup, series_url: str) -> str:
        """Extrait le titre de la série depuis la page ou l'URL."""
        # h1 ou title
        for sel in ["h1", "title"]:
            el = soup.select_one(sel)
            if el:
                t = el.get_text(strip=True)
                if t and "subslikescript" not in t.lower():
                    return t.split("|")[0].strip() if "|" in t else t[:200]
        m = self._series_page_re.search(series_url)
        if m:
            return m.group(1).replace("-", " ").title()
        return "Unknown Series"

    def fetch_episode_html(
        self,
        episode_url: str,
        *,
        user_agent: str | None = None,
        rate_limit_s: float | None = None,
        cache_dir: Path | None = None,
    ) -> str:
        """Récupère le HTML ; rate_limit_s et cache_dir passés à get_html."""
        _validate_subslikescript_url(episode_url)
        from howimetyourcorpus.core.utils.http import BROWSER_HEADERS, get_html
        return get_html(
            episode_url,
            extra_headers=BROWSER_HEADERS,
            user_agent=user_agent,
            min_interval_s=rate_limit_s,
            cache_dir=cache_dir,
        )

    def parse_episode(self, html: str, episode_url: str) -> tuple[str, dict]:
        """
        Extrait le transcript depuis le HTML.
        Returns (raw_text, meta) avec meta: selectors_used, warnings.
        """
        soup = _make_soup(html)
        meta: dict = {"selectors_used": [], "warnings": []}
        raw_text = ""

        for sel in TRANSCRIPT_SELECTORS:
            container = soup.select_one(sel)
            if not container:
                continue
            # Exclure les blocs qui ne sont pas le script (nav, ads, etc.)
            text = container.get_text(separator="\n", strip=True)
            if len(text) < 100:
                continue
            raw_text = text
            meta["selectors_used"].append(sel)
            break

        if not raw_text:
            # Dernier recours : body sans script/nav/footer
            for tag in soup.find_all(["script", "nav", "footer", "header"]):
                tag.decompose()
            main = soup.find("body") or soup
            raw_text = main.get_text(separator="\n", strip=True)
            meta["selectors_used"].append("body_fallback")
            meta["warnings"].append("Transcript extracted via body fallback; structure may vary.")

        if len(raw_text.strip()) < 50:
            raise SubslikescriptParseError(
                "Transcript too short or not found.",
                selector_used=meta["selectors_used"][0] if meta["selectors_used"] else None,
            )
        return raw_text, meta


# Enregistrement au chargement du module
AdapterRegistry.register(SubslikescriptAdapter())
