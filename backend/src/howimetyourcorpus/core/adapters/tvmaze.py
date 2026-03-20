"""Adapteur TVMaze API : discover_series par nom de série."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import quote_plus

from howimetyourcorpus.core.adapters.base import AdapterRegistry
from howimetyourcorpus.core.models import EpisodeRef, SeriesIndex

logger = logging.getLogger(__name__)


class TvmazeAdapter:
    """Adapteur pour TVMaze API. Recherche par nom de série."""

    id = "tvmaze"

    def normalize_episode_id(self, season: int, episode: int) -> str:
        return f"S{season:02d}E{episode:02d}"

    def discover_series(
        self,
        series_name: str,
        *,
        user_agent: str | None = None,
        rate_limit_s: float | None = None,
        cache_dir: Path | None = None,
    ) -> SeriesIndex:
        """
        Recherche une série par nom et retourne la liste complète des épisodes.
        
        Args:
            series_name: Nom de la série (ex: "Breaking Bad", "The Wire")
            user_agent: User-Agent HTTP (optionnel)
            rate_limit_s: Délai entre requêtes (optionnel, TVMaze rate limit: 20 req/10s)
            cache_dir: Dossier cache pour les requêtes HTTP (optionnel)
        
        Returns:
            SeriesIndex avec tous les épisodes de la série
        
        Raises:
            ValueError: Si la série n'est pas trouvée ou si l'API retourne une erreur
        """
        from howimetyourcorpus.core.utils.http import get_json
        
        if not series_name or not series_name.strip():
            raise ValueError("Le nom de la série ne peut pas être vide.")
        
        series_name = series_name.strip()
        logger.info(f"TVMaze: recherche de la série '{series_name}'")
        
        # Étape 1 : Recherche de la série via /singlesearch/shows
        search_url = f"https://api.tvmaze.com/singlesearch/shows?q={quote_plus(series_name)}"
        
        try:
            show_data = get_json(
                search_url,
                user_agent=user_agent or "HowIMetYourCorpus/1.0 (research)",
                min_interval_s=rate_limit_s or 0.5,  # TVMaze: 20 req/10s = 0.5s minimum
                cache_dir=cache_dir,
            )
        except Exception as e:
            logger.error(f"TVMaze: erreur lors de la recherche de '{series_name}': {e}")
            raise ValueError(
                f"Série '{series_name}' introuvable sur TVMaze. "
                f"Vérifiez l'orthographe ou essayez un nom différent."
            ) from e
        
        if not show_data or not isinstance(show_data, dict):
            raise ValueError(f"Réponse invalide de l'API TVMaze pour '{series_name}'")
        
        show_id = show_data.get("id")
        show_name = show_data.get("name", series_name)
        
        if not show_id:
            raise ValueError(f"ID de série manquant dans la réponse TVMaze pour '{series_name}'")
        
        logger.info(f"TVMaze: série trouvée - ID={show_id}, Nom='{show_name}'")
        
        # Étape 2 : Récupérer tous les épisodes via /shows/{id}/episodes
        episodes_url = f"https://api.tvmaze.com/shows/{show_id}/episodes"
        
        try:
            episodes_data = get_json(
                episodes_url,
                user_agent=user_agent or "HowIMetYourCorpus/1.0 (research)",
                min_interval_s=rate_limit_s or 0.5,
                cache_dir=cache_dir,
            )
        except Exception as e:
            logger.error(f"TVMaze: erreur lors de la récupération des épisodes pour ID={show_id}: {e}")
            raise ValueError(
                f"Impossible de récupérer les épisodes pour '{show_name}' (ID={show_id})"
            ) from e
        
        if not episodes_data or not isinstance(episodes_data, list):
            raise ValueError(f"Liste d'épisodes invalide pour '{show_name}' (ID={show_id})")
        
        # Étape 3 : Construire la liste des EpisodeRef
        episode_refs = []
        for ep_data in episodes_data:
            season = ep_data.get("season")
            episode = ep_data.get("number")
            
            # Ignorer les épisodes sans numéro de saison/épisode (ex: specials mal formatés)
            if season is None or episode is None:
                logger.debug(f"TVMaze: épisode ignoré (season/number manquant): {ep_data.get('name', 'unknown')}")
                continue
            
            episode_id = self.normalize_episode_id(season, episode)
            title = ep_data.get("name", "")
            url = ep_data.get("url", "")  # URL TVMaze de l'épisode (non utilisé pour fetch, juste pour info)
            
            episode_refs.append(
                EpisodeRef(
                    episode_id=episode_id,
                    season=season,
                    episode=episode,
                    title=title,
                    url=url,
                    source_id=self.id,
                )
            )
        
        if not episode_refs:
            raise ValueError(f"Aucun épisode trouvé pour '{show_name}' (ID={show_id})")
        
        logger.info(f"TVMaze: {len(episode_refs)} épisodes récupérés pour '{show_name}'")
        
        return SeriesIndex(
            series_title=show_name,
            series_url=f"https://www.tvmaze.com/shows/{show_id}",  # URL informative
            episodes=episode_refs,
        )

    def fetch_episode_html(
        self,
        episode_url: str,
        *,
        user_agent: str | None = None,
        rate_limit_s: float | None = None,
        cache_dir: Path | None = None,
    ) -> str:
        """
        TVMaze ne fournit pas de transcripts. Cette méthode n'est pas utilisée.
        Les transcripts doivent provenir d'une autre source (ex: subslikescript).
        """
        _ = (episode_url, user_agent, rate_limit_s, cache_dir)
        raise NotImplementedError(
            "TVMaze ne fournit pas de transcripts. "
            "Utilisez TVMaze pour découvrir les épisodes, "
            "puis téléchargez les transcripts depuis une autre source (ex: subslikescript) "
            "ou importez des sous-titres SRT."
        )

    def parse_episode(self, html: str, episode_url: str) -> tuple[str, dict]:
        """
        TVMaze ne fournit pas de transcripts. Cette méthode n'est pas utilisée.
        """
        raise NotImplementedError(
            "TVMaze ne fournit pas de transcripts. Utilisez une autre source pour les transcripts."
        )


# Enregistrement automatique de l'adapteur
_adapter = TvmazeAdapter()
AdapterRegistry.register(_adapter)
