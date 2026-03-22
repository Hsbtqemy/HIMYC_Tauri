# CLAUDE.md — HIMYC_Tauri (monorepo)

Guide de référence pour agents IA travaillant sur ce dépôt.

---

## Vue d'ensemble

Monorepo contenant le frontend Tauri **et** le backend Python FastAPI de HIMYC.
- **Frontend** : TypeScript / Vite / Tauri — `src/`, `src-tauri/`
- **Backend** : Python FastAPI — `backend/`
- Serveur HTTP sur `http://127.0.0.1:8765`
- 42+ routes backend couplées au frontend (dont `POST /project/init_corpus_db` pour créer `corpus.db` si absent)
- Base de données SQLite avec FTS5, 8 migrations
- Le backend est lancé automatiquement par Tauri via `python3 -m uvicorn howimetyourcorpus.api.server:app`

**Dépôt GitHub** : `https://github.com/Hsbtqemy/HIMYC_Tauri`
**Branche principale** : `main`

> ⚠️ Tous les commits et push se font uniquement sur ce dépôt. Le dépôt `Hsbtqemy/HIMYC` est obsolète.

---

## Architecture

```
HIMYC_Tauri/
├── src/                        # Frontend TypeScript
│   ├── api.ts                  # Fonctions fetch vers le backend (41+ endpoints)
│   ├── main.ts                 # Point d'entrée, routing modules
│   ├── shell.ts                # Shell UI (sidebar, navigation)
│   ├── context.ts              # ShellContext partagé
│   ├── modules/                # Vues : hub, concordancier, constituer, exporter, aligner (pas d’inspecter)
│   ├── features/               # Composants réutilisables (metaPanel, etc.)
│   ├── ui/                     # Utilitaires DOM
│   └── guards.ts               # Gardes métier
├── src-tauri/
│   └── src/main.rs             # Rust : spawn uvicorn, sidecar_fetch_loopback
├── backend/                    # Backend Python FastAPI
│   ├── src/howimetyourcorpus/
│   │   ├── __init__.py         # __version__ via importlib.metadata
│   │   ├── api/
│   │   │   ├── server.py       # FastAPI : 41+ routes, CORS, Pydantic models
│   │   │   └── jobs.py         # File de jobs async (normalize, segment, align)
│   │   └── core/
│   │       ├── constants.py    # TOUTES les constantes (langues, ports, noms fichiers)
│   │       ├── models.py       # Dataclasses partagées
│   │       ├── export_utils.py # Fonctions d'export (CSV, TSV, JSON, DOCX, JSONL, HTML)
│   │       ├── storage/        # ProjectStore : lecture/écriture corpus.db + fichiers
│   │       ├── pipeline/       # Orchestrateur normalize → segment → align
│   │       ├── normalize/      # Profils de normalisation texte
│   │       ├── segment/        # Segmentation en utterances
│   │       ├── align/          # Algorithme d'alignement transcript ↔ sous-titres
│   │       ├── subtitles/      # Parsers SRT / VTT
│   │       ├── adapters/       # TVMaze API, Subslikescript scraper
│   │       ├── preparer/       # Préparation sources (DB)
│   │       └── utils/          # Utilitaires texte, timecodes, HTTP
│   ├── tests/
│   │   ├── test_e2e_pipeline.py  # Tests pytest (TestClient) — pipeline complet
│   │   └── test_*.py             # ~40 fichiers de tests unitaires
│   └── pyproject.toml          # Source de vérité pour la version backend
├── index.html
├── package.json
├── start-dev.sh                # Runbook lancement dev
└── CLAUDE.md                   # Ce fichier
```

---

## Commandes de développement

```bash
# Installation backend (première fois)
cd backend && pip install -e ".[api,dev]" && cd ..

# Lancer le backend (dev, avec reload)
HIMYC_PROJECT_PATH=/chemin/vers/projet uvicorn howimetyourcorpus.api.server:app \
  --host 127.0.0.1 --port 8765 --reload

# Lancer le frontend Tauri (dev)
npm install   # première fois
npm run tauri dev

# Tests backend (tous)
cd backend && pytest tests/ -v

# Tests E2E pipeline uniquement
cd backend && pytest tests/test_e2e_pipeline.py -v

# Coverage
cd backend && pytest tests/ --cov=src/howimetyourcorpus --cov-report=term-missing
```

---

## Variables d'environnement

| Variable | Défaut | Usage |
|---|---|---|
| `HIMYC_PROJECT_PATH` | _(obligatoire)_ | Chemin racine du projet corpus |
| `HIMYC_API_PORT` | `8765` | Port d'écoute FastAPI |

---

## Routes API — 41+ endpoints

Principales familles :
- **Config** : `GET/PUT /config`, `GET/PUT /series_index`
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

8 migrations dans `backend/src/howimetyourcorpus/core/storage/` :

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

1. **`backend/src/howimetyourcorpus/api/server.py`** : ajouter le modèle Pydantic + la route
2. **`src/api.ts`** : ajouter l'interface + la fonction fetch correspondante
3. Committer les deux fichiers dans le même commit sur `main`

---

## Constantes centralisées

**`backend/src/howimetyourcorpus/core/constants.py`** — toujours importer depuis ici :

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

## Nomenclature importante

- **`speaker`** (pas `personnage`) — unifié dans tout le code
- **`speaker_explicit`** — colonne dans `segments_fts` pour la recherche sur speaker
- **`align_run`** / **`align_link`** — jamais `run` seul (table orpheline supprimée en migration 007)
- **`episode_id`** — clé string type `"s01e01"`, pas d'entier autoincrement

---

## Workflow commit

```bash
# Changements frontend uniquement
git add src/ index.html && git commit -m "feat: ..."

# Changements backend uniquement
git add backend/ && git commit -m "fix: ..."

# Changements couplés frontend + backend
git add src/ backend/ && git commit -m "feat: ..."

# Puis push
git push
```

---

## Tests E2E pipeline (`test_e2e_pipeline.py`)

Tests pytest utilisant `httpx.TestClient` — couvrent le pipeline complet :
- Import transcript → roundtrip lecture
- Normalize → `clean.txt` + `prep_status=clean`
- Segment → `segments.jsonl` + indexation DB
- Export TXT, CSV, corpus vide (pas de 500)

Ne nécessitent pas de backend uvicorn lancé — utilisent TestClient directement.

---

## FastAPI docs

http://127.0.0.1:8765/docs (disponible en dev avec `--reload`)
