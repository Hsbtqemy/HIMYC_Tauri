-- Phase 2: segments (phrases + tours de parole) + FTS segments

-- Segments (sentence / utterance)
CREATE TABLE IF NOT EXISTS segments (
  segment_id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  text TEXT NOT NULL,
  speaker_explicit TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_segments_episode_kind_n ON segments(episode_id, kind, n);

-- FTS5 sur segments
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  content='segments',
  content_rowid='rowid',
  segment_id,
  episode_id,
  kind,
  text,
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, segment_id, episode_id, kind, text) VALUES (new.rowid, new.segment_id, new.episode_id, new.kind, new.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, segment_id, episode_id, kind, text) VALUES('delete', old.rowid, old.segment_id, old.episode_id, old.kind, old.text);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, segment_id, episode_id, kind, text) VALUES('delete', old.rowid, old.segment_id, old.episode_id, old.kind, old.text);
  INSERT INTO segments_fts(rowid, segment_id, episode_id, kind, text) VALUES (new.rowid, new.segment_id, new.episode_id, new.kind, new.text);
END;

UPDATE schema_version SET version = 2;
