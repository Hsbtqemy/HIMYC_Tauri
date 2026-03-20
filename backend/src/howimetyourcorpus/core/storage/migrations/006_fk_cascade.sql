-- Phase 6: triggers CASCADE DELETE pour simuler les FK manquantes (AUD-06)
--
-- SQLite ne permet pas ALTER TABLE ADD CONSTRAINT FOREIGN KEY sur tables existantes.
-- Ces triggers simulent un ON DELETE CASCADE sur episodes et subtitle_tracks.
-- PRAGMA foreign_keys = ON est déjà activé dans _conn() (db.py).

-- Suppression en cascade depuis episodes ──────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS fk_cascade_delete_documents
BEFORE DELETE ON episodes BEGIN
  DELETE FROM documents WHERE episode_id = OLD.episode_id;
END;

CREATE TRIGGER IF NOT EXISTS fk_cascade_delete_segments
BEFORE DELETE ON episodes BEGIN
  DELETE FROM segments WHERE episode_id = OLD.episode_id;
END;

CREATE TRIGGER IF NOT EXISTS fk_cascade_delete_subtitle_tracks
BEFORE DELETE ON episodes BEGIN
  DELETE FROM subtitle_tracks WHERE episode_id = OLD.episode_id;
END;

CREATE TRIGGER IF NOT EXISTS fk_cascade_delete_align_runs
BEFORE DELETE ON episodes BEGIN
  DELETE FROM align_runs WHERE episode_id = OLD.episode_id;
END;

-- Suppression en cascade depuis subtitle_tracks ───────────────────────────────
-- (subtitle_cues n'a pas de FK déclarée vers subtitle_tracks)

CREATE TRIGGER IF NOT EXISTS fk_cascade_delete_subtitle_cues
BEFORE DELETE ON subtitle_tracks BEGIN
  DELETE FROM subtitle_cues WHERE track_id = OLD.track_id;
END;

-- Suppression en cascade depuis align_runs ────────────────────────────────────
-- (en complément de la FK déclarée dans 004_align.sql qui n'a pas CASCADE)

CREATE TRIGGER IF NOT EXISTS fk_cascade_delete_align_links
BEFORE DELETE ON align_runs BEGIN
  DELETE FROM align_links WHERE align_run_id = OLD.align_run_id;
END;

UPDATE schema_version SET version = 6;
