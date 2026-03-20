-- Phase 4: alignement transcript (segments) ↔ cues EN ↔ cues FR/IT

-- Runs d'alignement (un par épisode / paramètres)
CREATE TABLE IF NOT EXISTS align_runs (
  align_run_id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  pivot_lang TEXT NOT NULL,
  params_json TEXT,
  created_at TEXT,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_align_runs_episode ON align_runs(episode_id);

-- Liens (segment↔cue pivot ou cue pivot↔cue target)
CREATE TABLE IF NOT EXISTS align_links (
  link_id TEXT PRIMARY KEY,
  align_run_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  segment_id TEXT,
  cue_id TEXT,
  cue_id_target TEXT,
  lang TEXT,
  role TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL DEFAULT 'auto',
  meta_json TEXT,
  FOREIGN KEY (align_run_id) REFERENCES align_runs(align_run_id)
);

CREATE INDEX IF NOT EXISTS idx_align_links_run ON align_links(align_run_id);
CREATE INDEX IF NOT EXISTS idx_align_links_segment ON align_links(segment_id);
CREATE INDEX IF NOT EXISTS idx_align_links_cue ON align_links(cue_id);
CREATE INDEX IF NOT EXISTS idx_align_links_episode ON align_links(episode_id);

UPDATE schema_version SET version = 4;
