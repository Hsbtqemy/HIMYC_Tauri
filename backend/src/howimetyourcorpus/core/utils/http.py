"""Utilitaires HTTP : requêtes avec timeout, retry, backoff, rate limit, cache disque optionnel."""

import hashlib
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# Dernière requête (monotonic) pour rate limit global entre appels get_html
_last_get_html_time: Optional[float] = None

# En-têtes navigateur à utiliser pour les sites protégés par Cloudflare / anti-bot
BROWSER_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}


def _cache_path(url: str, cache_dir: Path) -> Path:
    """Retourne le chemin du fichier cache pour une URL (hash SHA256)."""
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    return cache_dir / f"{h}.html"


def _cache_path_json(url: str, cache_dir: Path) -> Path:
    """Retourne le chemin du fichier cache JSON pour une URL (hash SHA256)."""
    h = hashlib.sha256(url.encode()).hexdigest()[:16]
    return cache_dir / f"{h}.json"


def get_html(
    url: str,
    *,
    timeout_s: float = 30.0,
    user_agent: Optional[str] = None,
    extra_headers: Optional[dict[str, str]] = None,
    retries: int = 3,
    backoff_s: float = 2.0,
    min_interval_s: Optional[float] = None,
    cache_dir: Optional[Path] = None,
    cache_ttl_s: float = 7 * 24 * 3600,  # 7 jours par défaut
) -> str:
    """
    Récupère le contenu HTML d'une URL avec retry, backoff et cache disque optionnel.

    Args:
        url: URL à récupérer.
        timeout_s: Timeout en secondes.
        user_agent: User-Agent (optionnel).
        retries: Nombre de tentatives en cas d'échec.
        backoff_s: Délai de base entre tentatives (backoff exponentiel).
        min_interval_s: Délai minimal en secondes entre le début de deux appels
            successifs (rate limit). Si fourni, attend avant la requête pour
            respecter l'intervalle depuis le dernier appel (politesse en boucle).
        cache_dir: Répertoire cache (optionnel). Si fourni et valide (TTL), retourne
            le contenu depuis le cache. Sinon, fetch et écrit le cache.
        cache_ttl_s: Durée de validité du cache en secondes (default 7 jours).

    Returns:
        Contenu de la réponse en texte.

    Raises:
        httpx.HTTPError: Si toutes les tentatives échouent.
    """
    global _last_get_html_time

    # Vérifier le cache
    if cache_dir and cache_dir.is_dir():
        cache_file = _cache_path(url, cache_dir)
        if cache_file.exists():
            age = time.time() - cache_file.stat().st_mtime
            if age < cache_ttl_s:
                return cache_file.read_text(encoding="utf-8")

    headers: dict[str, str] = {}
    if extra_headers:
        headers.update(extra_headers)
    if user_agent:
        headers["User-Agent"] = user_agent

    if min_interval_s is not None and min_interval_s > 0 and _last_get_html_time is not None:
        elapsed = time.monotonic() - _last_get_html_time
        if elapsed < min_interval_s:
            time.sleep(min_interval_s - elapsed)

    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            _last_get_html_time = time.monotonic()
            with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
                resp = client.get(url, headers=headers or None)
                
                # Gestion spécifique 429 (Too Many Requests)
                if resp.status_code == 429:
                    retry_after = resp.headers.get("Retry-After")
                    wait_time = 60.0  # Default 60s si pas de header
                    if retry_after:
                        try:
                            wait_time = float(retry_after)
                        except ValueError as exc:
                            logger.debug(
                                "Invalid Retry-After header for %s: %r (%s)",
                                url,
                                retry_after,
                                exc,
                            )
                    if attempt < retries - 1:
                        time.sleep(wait_time)
                        continue
                
                resp.raise_for_status()
                # Prefer UTF-8 for HTML when charset is missing or dubious
                if resp.encoding in (None, "ascii", "ISO-8859-1"):
                    resp.encoding = "utf-8"
                
                # Écrire le cache
                if cache_dir and cache_dir.is_dir():
                    cache_file = _cache_path(url, cache_dir)
                    cache_file.write_text(resp.text, encoding="utf-8")
                
                return resp.text
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            last_exc = e
            if attempt < retries - 1:
                time.sleep(backoff_s * (2**attempt))
    raise last_exc  # type: ignore


def get_json(
    url: str,
    *,
    timeout_s: float = 30.0,
    user_agent: Optional[str] = None,
    extra_headers: Optional[dict[str, str]] = None,
    retries: int = 3,
    backoff_s: float = 2.0,
    min_interval_s: Optional[float] = None,
    cache_dir: Optional[Path] = None,
    cache_ttl_s: float = 7 * 24 * 3600,  # 7 jours par défaut
) -> Any:
    """
    Récupère le contenu JSON d'une URL avec retry, backoff et cache disque optionnel.

    Args:
        url: URL à récupérer (doit retourner du JSON).
        timeout_s: Timeout en secondes.
        user_agent: User-Agent (optionnel).
        retries: Nombre de tentatives en cas d'échec.
        backoff_s: Délai de base entre tentatives (backoff exponentiel).
        min_interval_s: Délai minimal en secondes entre deux appels (rate limit).
        cache_dir: Répertoire cache (optionnel). Si fourni et valide (TTL), retourne
            le contenu depuis le cache. Sinon, fetch et écrit le cache.
        cache_ttl_s: Durée de validité du cache en secondes (default 7 jours).

    Returns:
        Objet Python (dict/list) parsé depuis JSON.

    Raises:
        httpx.HTTPError: Si toutes les tentatives échouent.
        json.JSONDecodeError: Si la réponse n'est pas du JSON valide.
    """
    global _last_get_html_time

    # Vérifier le cache
    if cache_dir and cache_dir.is_dir():
        cache_file = _cache_path_json(url, cache_dir)
        if cache_file.exists():
            age = time.time() - cache_file.stat().st_mtime
            if age < cache_ttl_s:
                return json.loads(cache_file.read_text(encoding="utf-8"))

    headers: dict[str, str] = {}
    if extra_headers:
        headers.update(extra_headers)
    if user_agent:
        headers["User-Agent"] = user_agent

    if min_interval_s is not None and min_interval_s > 0 and _last_get_html_time is not None:
        elapsed = time.monotonic() - _last_get_html_time
        if elapsed < min_interval_s:
            time.sleep(min_interval_s - elapsed)

    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            _last_get_html_time = time.monotonic()
            with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
                resp = client.get(url, headers=headers or None)
                
                # Gestion spécifique 429 (Too Many Requests)
                if resp.status_code == 429:
                    retry_after = resp.headers.get("Retry-After")
                    wait_time = 60.0  # Default 60s si pas de header
                    if retry_after:
                        try:
                            wait_time = float(retry_after)
                        except ValueError as exc:
                            logger.debug(
                                "Invalid Retry-After header for %s: %r (%s)",
                                url,
                                retry_after,
                                exc,
                            )
                    if attempt < retries - 1:
                        time.sleep(wait_time)
                        continue
                
                resp.raise_for_status()
                data = resp.json()
                
                # Écrire le cache
                if cache_dir and cache_dir.is_dir():
                    cache_file = _cache_path_json(url, cache_dir)
                    cache_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                
                return data
        except (httpx.HTTPError, httpx.TimeoutException, json.JSONDecodeError) as e:
            last_exc = e
            if attempt < retries - 1:
                time.sleep(backoff_s * (2**attempt))
    raise last_exc  # type: ignore
