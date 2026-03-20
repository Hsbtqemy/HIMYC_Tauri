-- Migration 007 : suppression de la table `runs` (orpheline, jamais utilisée — AUD-07)
-- La table `align_runs` (migration 004) couvre tous les besoins de traçabilité.

DROP TABLE IF EXISTS runs;

UPDATE schema_version SET version = 7;
