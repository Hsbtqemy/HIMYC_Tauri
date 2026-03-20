-- Migration 008 : ajout de speaker_explicit dans segments_fts (AUD-08)
-- Permet la recherche KWIC filtrée par locuteur.

DROP TRIGGER IF EXISTS segments_au;
DROP TRIGGER IF EXISTS segments_ad;
DROP TRIGGER IF EXISTS segments_ai;
DROP TABLE IF EXISTS segments_fts;

CREATE VIRTUAL TABLE segments_fts USING fts5(
  content='segments',
  content_rowid='rowid',
  segment_id,
  episode_id,
  kind,
  text,
  speaker_explicit,
  tokenize='unicode61'
);

INSERT INTO segments_fts(segments_fts) VALUES('rebuild');

CREATE TRIGGER segments_ai AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts(rowid, segment_id, episode_id, kind, text, speaker_explicit)
  VALUES (new.rowid, new.segment_id, new.episode_id, new.kind, new.text, new.speaker_explicit);
END;

CREATE TRIGGER segments_ad AFTER DELETE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, segment_id, episode_id, kind, text, speaker_explicit)
  VALUES ('delete', old.rowid, old.segment_id, old.episode_id, old.kind, old.text, old.speaker_explicit);
END;

CREATE TRIGGER segments_au AFTER UPDATE ON segments BEGIN
  INSERT INTO segments_fts(segments_fts, rowid, segment_id, episode_id, kind, text, speaker_explicit)
  VALUES ('delete', old.rowid, old.segment_id, old.episode_id, old.kind, old.text, old.speaker_explicit);
  INSERT INTO segments_fts(rowid, segment_id, episode_id, kind, text, speaker_explicit)
  VALUES (new.rowid, new.segment_id, new.episode_id, new.kind, new.text, new.speaker_explicit);
END;

UPDATE schema_version SET version = 8;
