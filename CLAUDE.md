# CLAUDE.md — HIMYC (backend Python)

Guide de référence pour agents IA travaillant sur ce dépôt.

---

## Vue d'ensemble

Backend Python **FastAPI** pour l'application HIMYC — corpus de transcriptions + sous-titres.
- Serveur HTTP sur `http://127.0.0.1:8765`
- 41 routes couplées au frontend Tauri (`himyc-tauri/`)
- Base de données SQLite avec FTS5, 8 migrations
- Lancé automatiquement par le frontend Tauri via `python3 -m uvicorn howimetyourcorpus.api.server:app`

**Dépôt GitHub** : `https://github.com/Hsbtqemy/HIMYC`
**Frontend Tauri** : `/Users/hsmy/Dev/himyc-tauri/` (GitHub : `Hsbtqemy/HIMYC_Tauri`)
**Branche principale** : `master`

---

## Architecture

```
HIMYC/
├── src/howimetyourcorpus/
│   ├── __init__.py             # __version__ via importlib.metadata
│   ├── api/
│   │   ├── server.py           # FastAPI : 41 routes, CORS, Pydantic models
│   │   └── jobs.py             # File de jobs async (normalize, segment, align)
│   └── core/
│       ├── constants.py        # TOUTES les constantes (langues, ports, noms fichiers)
│       ├── models.py           # Dataclasses partagées
│       ├── export_utils.py     # Fonctions d'export (CSV, TSV, JSON, DOCX, JSONL, HTML)
│       ├── storage/            # ProjectStore : lecture/écriture corpus.db + fichiers
│       ├── pipeline/           # Orchestrateur normalize → segment → align
│       ├── normalize/          # Profils de normalisation texte
│       ├── segment/            # Segmentation en utterances
│       ├── align/              # Algorithme d'alignement transcript ↔ sous-titres
│       ├── subtitles/          # Parsers SRT / VTT
│       ├── adapters/           # TVMaze API, Subslikescript scraper
│       ├── preparer/           # Préparation sources (DB)
│       └── utils/              # Utilitaires texte, timecodes, etc.
├── tests/
│   ├── test_e2e_pipeline.py    # 9 tests pytest (TestClient) — pipeline complet
│   └── test_*.py               # ~40 fichiers de tests unitaires
├── pyproject.toml              # Source de vérité pour la version
├── AUDIT_2026-03.md            # Audit complet : routes, DB, exports, frontend
├── CHANGELOG.md                # Historique des releases
└── CLAUDE.md                   # Ce fichier
```

---

## Commandes de développement

```bash
# Installation
pip install -e ".[dev]"

# Lancer le backend (dev, avec reload)
cd /Users/hsmy/Dev/HIMYC
HIMYC_PROJECT_PATH=/chemin/vers/projet uvicorn howimetyourcorpus.api.server:app \
  --host 127.0.0.1 --port 8765 --reload

# Lancer le backend (production, sans reload)
HIMYC_PROJECT_PATH=/chemin/vers/projet uvicorn howimetyourcorpus.api.server:app \
  --host 127.0.0.1 --port 8765 --no-access-log

# Tests (tous)
pytest tests/ -v

# Tests E2E pipeline uniquement
pytest tests/test_e2e_pipeline.py -v

# Coverage
pytest tests/ --cov=src/howimetyourcorpus --cov-report=term-missing
```

---

## Variables d'environnement

| Variable | Défaut | Usage |
|---|---|---|
| `HIMYC_PROJECT_PATH` | _(obligatoire)_ | Chemin racine du projet corpus |
| `HIMYC_API_PORT` | `8765` | Port d'écoute FastAPI |

---

## Routes API — 41 endpoints

Voir `AUDIT_2026-03.md` section A pour la liste complète.

Principales familles :
- **Config** : `GET/PUT /config`, `PUT /series_index`
- **Episodes** : `GET /episodes`, `GET/POST/DELETE/PATCH /episodes/{id}/sources/{key}`
- **Jobs** : `GET/POST /jobs`, `GET/DELETE /jobs/{id}`
- **Alignement** : `GET /alignment_runs`, `GET /episodes/{id}/alignment_runs`, `PATCH /alignment_links/{id}`, bulk, retarget, stats, concordance
- **Personnages** : `GET/PUT /characters`, `GET/PUT /assignments`, `POST /assignments/auto`, `POST /episodes/{id}/propagate_characters`
- **Export** : `POST /export` (scopes: corpus, segments, jobs, characters, assignments), `GET /export/qa`, `GET /export/alignments`
- **Concordancier** : `POST /query`, `POST /query/facets`
- **Web** : `POST /web/tvmaze/discover`, `POST /web/subslikescript/discover`, `POST /web/subslikescript/fetch_transcript`
- **Health** : `GET /health`

---

## Base de données SQLite

8 migrations dans `src/howimetyourcorpus/core/storage/` :

| # | Fichier | Tables créées |
|---|---------|---------------|
| 1 | `schema.sql` | `episodes`, `documents`, `documents_fts` |
| 2 | `002_segments.sql` | `segments`, `segments_fts` |
| 3 | `003_subtitles.sql` | `subtitle_tracks`, `subtitle_cues`, `cues_fts` |
| 4 | `004_align.sql` | `align_runs`, `align_links` |
| 5 | `005_optimize_indexes.sql` | Index composites perf |
| 6 | `006_fk_cascade.sql` | Triggers CASCADE DELETE |
| 7 | `007_drop_runs.sql` | DROP TABLE `runs` (orpheline) |
| 8 | `008_speaker_explicit_fts.sql` | Rebuild `segments_fts` + colonne `speaker_explicit` |

**Règle absolue** : toutes les requêtes `conn.execute()` utilisent des placeholders `?` — jamais d'interpolation de chaînes.

---

## Ajout d'un endpoint

1. **`api/server.py`** : ajouter le modèle Pydantic + la route décorée `@app.get/post/…`
2. **`AUDIT_2026-03.md`** : ajouter une ligne dans le tableau section A, mettre à jour le compteur
3. **`CHANGELOG.md`** : documenter dans la section de la version en cours
4. **`himyc-tauri/src/api.ts`** : ajouter l'interface + la fonction fetch correspondante

---

## Constantes centralisées

**`core/constants.py`** — toujours importer depuis ici, jamais hardcoder :

```python
from howimetyourcorpus.core.constants import (
    SUPPORTED_LANGUAGES,        # ["en", "fr", "it"]
    DEFAULT_PIVOT_LANG,         # "en"
    DEFAULT_NORMALIZE_PROFILE,  # "default_en_v1"
    API_PORT,                   # 8765 (ou HIMYC_API_PORT env)
    CORPUS_DB_FILENAME,         # "corpus.db"
    RAW_TEXT_FILENAME,          # "raw.txt"
    CLEAN_TEXT_FILENAME,        # "clean.txt"
    SEGMENTS_JSONL_FILENAME,    # "segments.jsonl"
    EPISODES_DIR_NAME,          # "episodes"
    EXPORTS_DIR_NAME,           # "exports"
    DEFAULT_AUDIT_LIMIT,        # 50
    MAX_AUDIT_LIMIT,            # 200
    MAX_KWIC_HITS,              # 2000
)
```

---

## Scopes d'export (`POST /export`)

| scope | Formats | Contenu |
|---|---|---|
| `corpus` | TXT, CSV, JSON, DOCX, JSONL | Utterances du corpus |
| `segments` | TXT, CSV, TSV, DOCX | Segments normalisés |
| `jobs` | JSONL, JSON | Historique des jobs |
| `characters` | JSON, CSV | Catalogue personnages (id, canonical, name_<lang>..., aliases) |
| `assignments` | JSON, CSV | Assignations (character_id, speaker_label, episode_id, segment_id, cue_id) |

`GET /export/alignments` : CSV/TSV avec fieldnames dynamiques selon `pivot_lang`.

---

## Nomenclature importante

- **`speaker`** (pas `personnage`) — unifié dans tout le code (AUD-04)
- **`speaker_explicit`** — colonne dans `segments_fts` pour la recherche sur speaker
- **`align_run`** / **`align_link`** — jamais `run` seul (table orpheline supprimée en migration 007)
- **`episode_id`** — clé string type `"s01e01"`, pas d'entier autoincrement

---

## Gestion des branches

- **`master`** — branche principale stable
- Les features se font sur des branches `feature/...`
- Le frontend Tauri est sur `https://github.com/Hsbtqemy/HIMYC_Tauri` (branche `main`)

**Workflow commit standard** :
```bash
# Backend seul
git add src/ tests/ && git commit -m "feat(mx-XXX): description"

# Avec mise à jour audit
git add src/ tests/ AUDIT_2026-03.md CHANGELOG.md && git commit -m "feat(mx-XXX): ..."
```

---

## Tests E2E pipeline (`test_e2e_pipeline.py`)

9 tests pytest utilisant `httpx.TestClient` — couvrent le pipeline complet :
- Import transcript → roundtrip lecture
- Normalize → `clean.txt` + `prep_status=clean`
- Segment → `segments.jsonl` + indexation DB
- Export TXT, CSV, corpus vide (pas de 500)

Ne nécessitent pas de backend uvicorn lancé — utilisent TestClient directement.

---

## Liens utiles

- Frontend Tauri : `/Users/hsmy/Dev/himyc-tauri/` — voir son propre `CLAUDE.md`
- Audit complet : `AUDIT_2026-03.md`
- Changelog : `CHANGELOG.md`
- FastAPI docs : http://127.0.0.1:8765/docs (disponible en dev)
