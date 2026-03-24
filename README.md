# HIMYC — How I Met Your Corpus

Application desktop de constitution et d'exploration de corpus multilingues (transcriptions + sous-titres).

- **Frontend** : Tauri / TypeScript / Vite
- **Backend** : Python FastAPI (uvicorn, port 8765)
- **Base de données** : SQLite avec FTS5

---

## Installer l'application

Télécharge le fichier correspondant à ta plateforme sur la [page Releases](https://github.com/Hsbtqemy/HIMYC_Tauri/releases/latest) :

| Plateforme | Fichier à télécharger | Prérequis |
|---|---|---|
| **Windows** | `HIMYC_x.y.z_x64-setup.exe` | Aucun |
| **macOS (Apple Silicon)** | `HIMYC_x.y.z_universal.dmg` | Aucun |
| **macOS (Intel)** | `HIMYC_x.y.z_universal.dmg` | `pip install howimetyourcorpus` |
| **Linux** | `HIMYC_x.y.z_amd64.AppImage` | Aucun |

### Windows

Double-clic sur le `.exe`. Si Windows affiche une alerte SmartScreen, clique **"Informations complémentaires" → "Exécuter quand même"** (l'app n'est pas signée avec un certificat commercial).

> Si une version précédente est déjà installée et en cours d'exécution, ferme-la avant de lancer le setup (ou termine le processus `himyc-backend.exe` dans le gestionnaire des tâches).

### macOS

Ouvre le `.dmg` et glisse HIMYC dans `Applications`. Au premier lancement, macOS bloque l'app car elle n'est pas signée. Deux options :
- **Clic-droit → Ouvrir** sur l'icône, puis confirmer.
- Ou en terminal : `xattr -cr /Applications/HIMYC.app`

### Linux (AppImage)

```bash
chmod +x HIMYC_x.y.z_amd64.AppImage
./HIMYC_x.y.z_amd64.AppImage
```

---

## Workflow de développement

### Prérequis

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/) stable
- Python ≥ 3.11
- [Tauri CLI](https://tauri.app/start/prerequisites/) (dépendances système selon la plateforme)

### Installation (première fois)

```bash
# 1. Cloner le dépôt
git clone https://github.com/Hsbtqemy/HIMYC_Tauri.git
cd HIMYC_Tauri

# 2. Dépendances frontend
npm install

# 3. Dépendances backend (dans l'environnement Python qui sera utilisé par py -3 / python3)
cd backend
py -3 -m pip install -e ".[api,dev]"   # Windows
# python3 -m pip install -e ".[api,dev]"  # macOS / Linux
cd ..
```

> **Windows** : utilise `py -3` (Python Launcher) — c'est ce même interpréteur que Tauri trouve au lancement de l'app en mode dev.

### Lancer en mode développement

```bash
npm run tauri dev
```

Cela démarre simultanément :
- le serveur Vite (frontend, hot-reload)
- l'application Tauri (fenêtre native)

Au premier lancement avec un projet, l'app demande de sélectionner un dossier corpus. Le backend uvicorn est lancé automatiquement par Tauri (depuis le Python système en dev).

### Lancer le backend seul (optionnel, pour déboguer l'API)

```bash
HIMYC_PROJECT_PATH=/chemin/vers/projet uvicorn howimetyourcorpus.api.server:app \
  --host 127.0.0.1 --port 8765 --reload
```

Documentation Swagger disponible sur `http://127.0.0.1:8765/docs`.

### Tests

```bash
# Tous les tests
cd backend && pytest tests/ -v

# Pipeline complet uniquement (E2E, ne nécessite pas uvicorn)
cd backend && pytest tests/test_e2e_pipeline.py -v

# Coverage
cd backend && pytest tests/ --cov=src/howimetyourcorpus --cov-report=term-missing
```

---

## Workflow de release

### Via GitHub Actions (recommandé)

Pousser un tag `v*` suffit à déclencher le build sur les 3 plateformes :

```bash
git tag v0.8.0
git push origin v0.8.0
```

GitHub Actions :
1. **Windows** — compile `himyc-backend.exe` (PyInstaller) puis `tauri build` → `.exe` + `.msi`
2. **macOS** — compile `himyc-backend` (PyInstaller arm64) puis `tauri build --target universal-apple-darwin` → `.dmg`
3. **Linux** — compile `himyc-backend` (PyInstaller) puis `tauri build` → `.AppImage` + `.deb`

Les artefacts sont automatiquement publiés sur la GitHub Release créée par le tag.

### Build local Windows (sans CI)

```powershell
.\scripts\build-sidecar.ps1
```

Ce script :
1. Installe PyInstaller si absent
2. Compile `backend/dist/himyc-backend.exe` via `backend/himyc-backend.spec`
3. Lance `npm run tauri build --config src-tauri/tauri.release.conf.json`

Les installeurs sont produits dans `src-tauri/target/release/bundle/`.

### Mettre à jour la version

La version est définie à **deux endroits à synchroniser** :

| Fichier | Clé |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `backend/pyproject.toml` | `version` |

---

## Architecture technique

```
HIMYC_Tauri/
├── src/                     # Frontend TypeScript / Vite
│   ├── api.ts               # 41+ fonctions fetch vers le backend
│   ├── main.ts              # Point d'entrée, routing
│   ├── shell.ts             # Shell UI (sidebar, navigation)
│   └── modules/             # Vues métier (hub, concordancier, constituer…)
├── src-tauri/
│   ├── src/main.rs          # Rust : détection sidecar, spawn backend, fetch loopback
│   ├── tauri.conf.json      # Config Tauri principale
│   ├── tauri.release.conf.json       # Resources Windows (sidecar .exe)
│   └── tauri.release.unix.conf.json  # Resources Unix (sidecar sans extension)
├── backend/
│   ├── src/howimetyourcorpus/
│   │   ├── api/server.py    # FastAPI : routes, modèles Pydantic
│   │   ├── api/jobs.py      # File de jobs async
│   │   └── core/            # Pipeline, storage, normalize, segment, align…
│   ├── himyc_server.py      # Point d'entrée PyInstaller
│   ├── himyc-backend.spec   # Spec PyInstaller
│   └── pyproject.toml
├── scripts/
│   └── build-sidecar.ps1   # Build release local (Windows)
└── .github/workflows/
    └── release.yml          # CI : PyInstaller + Tauri sur 3 plateformes
```

### Comment fonctionne le lancement du backend

```
Tauri démarre
    │
    ├─► find_sidecar() cherche himyc-backend[.exe] dans resource_dir
    │       │
    │       ├─ Trouvé (build release) ──► spawn sidecar PyInstaller
    │       │
    │       └─ Non trouvé (mode dev) ──► python_candidates() :
    │                                    py -3, python, python3…
    │                                    ──► python -m uvicorn …
    │
    └─► Backend écoute sur 127.0.0.1:8765
```

Le sidecar PyInstaller embarque : uvicorn, FastAPI, Starlette, httpx, beautifulsoup4, python-docx, rapidfuzz, et l'ensemble du package `howimetyourcorpus` avec ses fichiers SQL de migration.

---

## Contribuer

```bash
# Toute modification : travailler sur main, pas de branches de feature
git add src/ backend/          # selon les fichiers modifiés
git commit -m "feat|fix|chore: description"
git push
```

Les endpoints API couplés frontend/backend doivent toujours être commités ensemble (`src/api.ts` + `backend/src/howimetyourcorpus/api/server.py`).
