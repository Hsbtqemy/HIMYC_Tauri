-- Phase 3: sous-titres SRT/VTT multi-langues (tracks + cues + FTS)

-- Pistes sous-titres par épisode/langue
CREATE TABLE IF NOT EXISTS subtitle_tracks (
  track_id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  format TEXT NOT NULL,
  source_path TEXT,
  imported_at TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_subtitle_tracks_episode ON subtitle_tracks(episode_id);

-- Cues (sous-titres timecodés)
CREATE TABLE IF NOT EXISTS subtitle_cues (
  cue_id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  n INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text_raw TEXT,
  text_clean TEXT NOT NULL,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_subtitle_cues_track ON subtitle_cues(track_id);
CREATE INDEX IF NOT EXISTS idx_subtitle_cues_episode_lang ON subtitle_cues(episode_id, lang);

-- FTS5 sur cues (text_clean)
CREATE VIRTUAL TABLE IF NOT EXISTS cues_fts USING fts5(
  content='subtitle_cues',
  content_rowid='rowid',
  cue_id,
  episode_id,
  lang,
  text_clean,
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS subtitle_cues_ai AFTER INSERT ON subtitle_cues BEGIN
  INSERT INTO cues_fts(rowid, cue_id, episode_id, lang, text_clean) VALUES (new.rowid, new.cue_id, new.episode_id, new.lang, new.text_clean);
END;
CREATE TRIGGER IF NOT EXISTS subtitle_cues_ad AFTER DELETE ON subtitle_cues BEGIN
  INSERT INTO cues_fts(cues_fts, rowid, cue_id, episode_id, lang, text_clean) VALUES('delete', old.rowid, old.cue_id, old.episode_id, old.lang, old.text_clean);
END;
CREATE TRIGGER IF NOT EXISTS subtitle_cues_au AFTER UPDATE ON subtitle_cues BEGIN
  INSERT INTO cues_fts(cues_fts, rowid, cue_id, episode_id, lang, text_clean) VALUES('delete', old.rowid, old.cue_id, old.episode_id, old.lang, old.text_clean);
  INSERT INTO cues_fts(rowid, cue_id, episode_id, lang, text_clean) VALUES (new.rowid, new.cue_id, new.episode_id, new.lang, new.text_clean);
END;

UPDATE schema_version SET version = 3;
