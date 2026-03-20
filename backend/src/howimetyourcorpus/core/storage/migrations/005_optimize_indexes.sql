-- Phase 6: Optimisation index et performance

-- Index sur status pour filtrage rapide (UI refresh, pipeline)
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);

-- Index composite season+episode pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_episodes_season_episode ON episodes(season, episode);

-- Index sur speaker_explicit pour recherche locuteurs (filtré NULL)
CREATE INDEX IF NOT EXISTS idx_segments_speaker ON segments(speaker_explicit) 
  WHERE speaker_explicit IS NOT NULL AND trim(speaker_explicit) != '';

-- Index sur lang pour comptage rapide des sous-titres par langue
CREATE INDEX IF NOT EXISTS idx_subtitle_cues_lang ON subtitle_cues(lang);

-- Index composite pour requêtes d'alignement fréquentes (filtrage par épisode+statut)
CREATE INDEX IF NOT EXISTS idx_align_links_episode_status ON align_links(episode_id, status);

-- Index sur role pour filtrage liens pivot vs target
CREATE INDEX IF NOT EXISTS idx_align_links_role ON align_links(role);

UPDATE schema_version SET version = 5;
