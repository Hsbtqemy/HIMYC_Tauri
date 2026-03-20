-- Schéma SQLite + FTS5 pour le corpus (MVP)

-- Épisodes (métadonnées + statut)
CREATE TABLE IF NOT EXISTS episodes (
  episode_id TEXT PRIMARY KEY,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  fetched_at TEXT,
  normalized_at TEXT
);

-- Documents (texte normalisé par épisode)
CREATE TABLE IF NOT EXISTS documents (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(episode_id),
  clean_text TEXT NOT NULL
);

-- FTS5 pour la recherche plein texte
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  content='documents',
  content_rowid='rowid',
  episode_id,
  clean_text,
  tokenize='unicode61'
);

-- Triggers pour maintenir FTS à jour
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, episode_id, clean_text) VALUES (new.rowid, new.episode_id, new.clean_text);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, episode_id, clean_text) VALUES('delete', old.rowid, old.episode_id, old.clean_text);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, episode_id, clean_text) VALUES('delete', old.rowid, old.episode_id, old.clean_text);
  INSERT INTO documents_fts(rowid, episode_id, clean_text) VALUES (new.rowid, new.episode_id, new.clean_text);
END;

-- Runs (métadonnées d'exécution, optionnel MVP)
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_version TEXT,
  timestamp_utc TEXT,
  params TEXT,
  notes TEXT
);

-- Version du schéma (migrations)
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
