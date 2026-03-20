# CLAUDE.md — himyc-tauri

Guide de référence pour agents IA travaillant sur ce dépôt.

---

## Vue d'ensemble

Frontend desktop **Tauri 2 + TypeScript vanilla** pour l'application HIMYC.
- Aucun framework UI (pas de React/Vue) — DOM vanilla organisé en modules
- Communique avec un backend FastAPI Python (dépôt séparé : `HIMYC/`)
- Le backend est lancé automatiquement par Rust au démarrage de l'app

**Dépôt GitHub** : `https://github.com/Hsbtqemy/HIMYC_Tauri`
**Backend Python** : `/Users/hsmy/Dev/HIMYC/` (GitHub : `Hsbtqemy/HIMYC`)

---

## Architecture

```
himyc-tauri/
├── src/                        # TypeScript frontend
│   ├── main.ts                 # Point d'entrée : startup overlay + IS_TAURI detection
│   ├── shell.ts                # Initialise la navigation (tabs, modules)
│   ├── api.ts                  # Toutes les fonctions fetch vers le backend
│   ├── constants.ts            # API_PORT=8765, SUPPORTED_LANGUAGES, etc.
│   ├── model.ts                # Interfaces TypeScript (Episode, AlignLink, etc.)
│   ├── guards.ts               # Type guards (isEpisode, isAlignLink, etc.)
│   ├── context.ts              # Contexte navigation partagé entre modules
│   ├── perf.ts                 # Virtual scroll et optimisations DOM
│   ├── modules/
│   │   ├── hubModule.ts        # Onglet Hub : KPIs projet, gate QA, onboarding
│   │   ├── constituerModule.ts # Onglet Constituer : épisodes, sources, personnages
│   │   ├── inspecterModule.ts  # Onglet Inspecter : raw/clean, normalize/segment
│   │   ├── alignerModule.ts    # Onglet Aligner : configuration run, progression
│   │   ├── exporterModule.ts   # Onglet Exporter : exports + propagation personnages
│   │   └── concordancierModule.ts  # Onglet Concordancier : KWIC FTS5
│   ├── features/
│   │   └── metaPanel.ts        # Panneau méta (audit view intégré)
│   └── ui/
│       ├── dom.ts              # Helpers DOM ($, $$, createElement, etc.)
│       └── copyUtils.ts        # Copie presse-papier
├── src-tauri/
│   ├── src/main.rs             # Rust : BackendState, spawn_uvicorn, commandes Tauri
│   ├── Cargo.toml              # Dépendances Rust (tauri, reqwest, serde_json)
│   ├── tauri.conf.json         # Config Tauri : identifier, version, bundle, icons
│   ├── capabilities/
│   │   └── default.json        # Permissions Tauri (fs, dialog, http loopback)
│   └── icons/                  # icon.ico, icon.icns, 32x32.png, 128x128.png
├── tests/
│   ├── e2e/                    # Tests Playwright (VITE_E2E=true)
│   └── *.test.ts               # Tests Vitest (model, guards, perf)
├── index.html                  # Startup overlay + #shell-header + #app
├── package.json
├── vite.config.ts
├── .github/workflows/
│   ├── release.yml             # Build release sur tag v* (macOS/Windows/Linux)
│   └── e2e.yml                 # Tests Playwright sur push/PR
└── CLAUDE.md                   # Ce fichier
```

---

## Commandes de développement

```bash
# Installation (première fois)
npm install

# Dev avec hot-reload (nécessite le backend Python lancé séparément)
npm run tauri dev

# Vérification TypeScript sans compilation
npx tsc --noEmit

# Tests unitaires Vitest
npm test

# Tests E2E Playwright (backend doit tourner sur port 8765)
VITE_E2E=true npm run test:e2e

# Build release local (macOS → .app + .dmg)
npm run tauri build
# ou
./build-release.sh

# Vérification prérequis build
./build-release.sh --check
```

---

## Mécanisme de communication avec le backend

**Problème** : Tauri 2 bloque les requêtes HTTP sortantes via CSP, même vers loopback.

**Solution** : commande Rust `sidecar_fetch_loopback` dans `main.rs`.
- Tous les appels API passent par `invoke("sidecar_fetch_loopback", { url, method, body, headers })`
- Restreint aux hôtes `127.0.0.1`, `localhost`, `::1`
- Wrappé dans `api.ts` via les fonctions `apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`

**En mode dev Vite** (`VITE_E2E=true` ou sans `__TAURI_INTERNALS__`) : utilise `fetch()` natif directement.

---

## Backend auto-launch (main.rs)

Au démarrage de l'app Tauri :
1. `.setup()` lit `{app_data_dir}/himyc_config.json` (`{ "project_path": "..." }`)
2. Si un chemin est sauvegardé → `spawn_uvicorn(path)` lance `python3 -m uvicorn howimetyourcorpus.api.server:app --host 127.0.0.1 --port 8765`
3. `RunEvent::Exit` → `kill_backend()` tue proprement le process

**Commandes Tauri exposées** :
- `get_project_path()` → `Option<String>`
- `set_project_path(path: String)` → kill ancien process + sauvegarde + relance uvicorn

**Frontend (`main.ts`)** :
- `IS_TAURI = "__TAURI_INTERNALS__" in window && VITE_E2E !== "true"`
- `pollHealth()` — poll `GET /health` toutes les 500ms × 60 (30s max)
- `startupTauri()` — lit le chemin sauvegardé, lance ou affiche le picker

---

## Startup overlay (index.html)

Éléments DOM utilisés par `main.ts` :
- `#startup-overlay` — fond plein écran (caché par `hideOverlay()` quand prêt)
- `#startup-status` — message texte d'état
- `#startup-spinner` — animation spin CSS
- `#startup-error` — message d'erreur (rouge)
- `#startup-pick-btn` — bouton "Choisir un projet…"
- `#startup-retry-btn` — bouton "↺ Réessayer"

---

## Ajout d'une nouvelle route API

1. **`src/api.ts`** : ajouter interface + fonction `apiGet/apiPost/…`
2. **Module concerné** (`src/modules/*.ts`) : appeler la fonction, gérer le rendu
3. **`HIMYC/src/howimetyourcorpus/api/server.py`** : implémenter le endpoint
4. **`HIMYC/AUDIT_2026-03.md`** : mettre à jour le tableau des routes (section A)

---

## Release (CI GitHub Actions)

Déclenchement : `git tag vX.Y.Z && git push origin vX.Y.Z`

Le workflow `.github/workflows/release.yml` build sur 3 plateformes :

| Platform | Runner | Args | Artefacts |
|---|---|---|---|
| macOS | `macos-latest` | `--target universal-apple-darwin` | `.dmg` (arm64+x86) |
| Windows | `windows-latest` | _(aucun)_ | `_x64-setup.exe`, `.msi` |
| Linux | `ubuntu-22.04` | _(aucun)_ | `.AppImage`, `.deb` |

**Avant de tagger** :
- Bumper `version` dans `src-tauri/tauri.conf.json`
- Bumper `version` dans `src-tauri/Cargo.toml`
- Committer, puis tagger

**Pièges connus** :
- `--target` ne peut être passé qu'une fois → utiliser `--target universal-apple-darwin` pour macOS universel
- `tauri.conf.json` : le tableau `icon` doit être rempli (32x32.png, 128x128.png, icns, ico) sinon Windows échoue
- `ubuntu-22.04` : `apt-get update` parfois flaky → retry intégré dans le workflow
- `com.himyc.app` : l'identifiant Tauri se termine par `.app` — macOS le tolère mais si ça pose problème à l'avenir, changer en `com.himyc.desktop`

---

## Constantes centralisées

**`src/constants.ts`** — modifier ici en priorité, jamais hardcoder :
- `API_PORT = 8765`
- `API_BASE = "http://localhost:8765"`
- `TAURI_SIDECAR_CMD = "sidecar_fetch_loopback"`
- `SUPPORTED_LANGUAGES = ["en", "fr", "it"]`

---

## Tests

| Suite | Commande | Environnement |
|---|---|---|
| Vitest (unit) | `npm test` | Node, pas de Tauri |
| Playwright E2E | `VITE_E2E=true npm run test:e2e` | Chromium, backend réel requis |

En mode `VITE_E2E=true` :
- `IS_TAURI = false` → `fetch()` natif au lieu de `sidecar_fetch_loopback`
- L'overlay de démarrage est caché directement (`hideOverlay()`)
- Le backend Python doit tourner sur `127.0.0.1:8765`

---

## Liens utiles

- Backend Python (FastAPI) : `/Users/hsmy/Dev/HIMYC/` — voir son propre `CLAUDE.md`
- Audit routes : `HIMYC/AUDIT_2026-03.md`
- Changelog : `HIMYC/CHANGELOG.md`
- Tauri 2 docs : https://v2.tauri.app
