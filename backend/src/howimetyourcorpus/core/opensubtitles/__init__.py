"""Client OpenSubtitles (api.opensubtitles.com) : recherche et téléchargement de sous-titres."""

from howimetyourcorpus.core.opensubtitles.client import (
    OpenSubtitlesClient,
    OpenSubtitlesError,
    OpenSubtitlesSearchHit,
)

__all__ = ["OpenSubtitlesClient", "OpenSubtitlesError", "OpenSubtitlesSearchHit"]
