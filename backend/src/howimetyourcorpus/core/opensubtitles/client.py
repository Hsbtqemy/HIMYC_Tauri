"""Client REST pour l'API OpenSubtitles (api.opensubtitles.com/api/v1)."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.opensubtitles.com/api/v1"
USER_AGENT = "HowIMetYourCorpus/0.5 (research)"


class OpenSubtitlesError(Exception):
    """Erreur API OpenSubtitles (quota, auth, réseau)."""

    pass


@dataclass
class OpenSubtitlesSearchHit:
    """Un résultat de recherche : sous-titre téléchargeable."""

    file_id: int
    subtitle_id: str
    release_name: str
    language: str
    download_count: int = 0


class OpenSubtitlesClient:
    """
    Client pour recherche et téléchargement de sous-titres.
    Headers : Api-Key (requis), User-Agent.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = BASE_URL,
        user_agent: str = USER_AGENT,
        timeout_s: float = 30.0,
    ):
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.user_agent = user_agent
        self.timeout_s = timeout_s

    def _headers(self) -> dict[str, str]:
        return {
            "Api-Key": self.api_key,
            "User-Agent": self.user_agent,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def search(
        self,
        imdb_id: str,
        season: int,
        episode: int,
        language: str,
    ) -> list[OpenSubtitlesSearchHit]:
        """
        Recherche des sous-titres pour un épisode (série).
        imdb_id : IMDb ID de la série (ex. tt0460649 pour HIMYM).
        language : code ISO 639-2 (en, fr, etc.).
        """
        if not self.api_key:
            raise OpenSubtitlesError("Clé API OpenSubtitles manquante.")
        imdb_clean = imdb_id.strip().lower()
        if imdb_clean.startswith("tt"):
            pass
        else:
            imdb_clean = f"tt{imdb_clean}"
        lang_clean = language.strip().lower()[:3]
        url = f"{self.base_url}/subtitles"
        params: dict[str, Any] = {
            "imdb_id": imdb_clean,
            "type": "episode",
            "season_number": season,
            "episode_number": episode,
            "languages": lang_clean,
        }
        try:
            with httpx.Client(timeout=self.timeout_s) as client:
                r = client.get(url, params=params, headers=self._headers())
                r.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise OpenSubtitlesError("Clé API OpenSubtitles invalide ou expirée.") from e
            if e.response.status_code == 429:
                raise OpenSubtitlesError("Quota OpenSubtitles dépassé. Réessayez plus tard.") from e
            raise OpenSubtitlesError(f"API OpenSubtitles: {e.response.status_code}") from e
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            raise OpenSubtitlesError(f"Réseau OpenSubtitles: {e!s}") from e

        data = r.json()
        hits: list[OpenSubtitlesSearchHit] = []
        for item in data.get("data") or []:
            attrs = item.get("attributes") or {}
            files = attrs.get("files") or []
            if not files:
                continue
            fid = files[0].get("file_id")
            if fid is None:
                continue
            hits.append(
                OpenSubtitlesSearchHit(
                    file_id=int(fid),
                    subtitle_id=str(item.get("id", "")),
                    release_name=files[0].get("file_name") or "",
                    language=attrs.get("language") or lang_clean,
                    download_count=int(attrs.get("download_count") or 0),
                )
            )
        return hits

    def download(self, file_id: int) -> str:
        """
        Télécharge le fichier sous-titre et retourne son contenu (texte SRT).
        """
        if not self.api_key:
            raise OpenSubtitlesError("Clé API OpenSubtitles manquante.")
        url = f"{self.base_url}/download"
        body = {"file_id": file_id}
        try:
            with httpx.Client(timeout=self.timeout_s, follow_redirects=True) as client:
                r = client.post(url, json=body, headers=self._headers())
                r.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise OpenSubtitlesError("Clé API OpenSubtitles invalide ou expirée.") from e
            if e.response.status_code == 429:
                raise OpenSubtitlesError("Quota téléchargement dépassé.") from e
            raise OpenSubtitlesError(f"API OpenSubtitles download: {e.response.status_code}") from e
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            raise OpenSubtitlesError(f"Réseau OpenSubtitles: {e!s}") from e

        info = r.json()
        link = info.get("link")
        if not link:
            raise OpenSubtitlesError("Réponse OpenSubtitles sans lien de téléchargement.")
        try:
            r2 = httpx.get(link, timeout=self.timeout_s)
            r2.raise_for_status()
            return r2.text
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            raise OpenSubtitlesError(f"Téléchargement fichier: {e!s}") from e
