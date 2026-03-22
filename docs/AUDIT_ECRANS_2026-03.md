# AUDIT ÉCRANS — HIMYC Tauri (écran par écran)

**Périmètre** : analyse statique du code frontend (`src/`, `index.html`, `main.ts`) — document de référence produit / revue.  
**Date initiale** : mars 2026 · **Révision** : mars 2026 (alignement Concordancier, toolchain Vite 8, détail API).

Ce compte-rendu décrit **chaque surface utilisateur réellement montée par le shell**, les **branchements** (conditions, navigation, API, état persistant) et les **pièces connexes** (code présent mais non branché).

**Toolchain** (dev) : **Vite 8** · Vitest 3 · TypeScript 5 — `npm audit` : 0 vulnérabilité au moment de la révision.

---

## 1. Architecture globale de navigation

### 1.1 Shell (`src/shell.ts`)

| Élément | Comportement |
|--------|----------------|
| **Modes montés** | `hub` \| `concordancier` \| `constituer` \| `exporter` \| `aligner` (sous-vue). **Pas** de mode `inspecter` dans `MODE_CONFIGS`. |
| **Layout** | Header fixe 44px (`#shell-header`), sidebar fixe 192px (`#shell-sidebar`), contenu `#app` avec `padding-top` + `padding-left`. |
| **Démarrage module** | `initShell()` appelle **toujours** `MODE_CONFIGS["hub"].mount`** — le hub est la page d’accueil à chaque chargement (commentaire explicite : pas de restauration `localStorage` du dernier mode dans cette version). |
| **Sidebar** | Trois entrées : Concordancier, Constituer, Exporter — chacune appelle `_navigateTo(mode)`. |
| **Brand « HIMYC »** | Clic → `_navigateTo("hub")`. |
| **Sous-vue Aligner** | `SUB_VIEWS = { aligner }` : header avec « ← Retour » + fil d’Ariane `\<Mode précédent\> › Aligner` ; retour restaure `_prevNavMode` (dernier onglet sidebar utilisé avant d’ouvrir l’aligneur). |
| **Projet (Tauri)** | Zone projet + `changeProject()` → `invoke("set_project_path")` + poll `/health` + toast ; puis **`_navigateTo("hub")`** pour recharger le contexte. |
| **Santé API** | `_checkHealth()` au init + `setInterval` 30s ; mise à jour point + libellé version ; toasts passage online/offline. |

### 1.2 Contrat `ShellContext` (`src/context.ts`)

| Méthode | Rôle |
|---------|------|
| `navigateTo` | Vers `hub` \| `concordancier` \| `constituer` \| `exporter` \| `aligner`. |
| `getHandoff` / `setHandoff` | **Aligner** : `getHandoff()` **consomme** le handoff (une lecture vide le tampon). |
| `changeProject` | Sélecteur de dossier Tauri (no-op hors Tauri). |

**Note** : les commentaires dans `context.ts` évoquent encore « Inspecter → Aligner » ; dans l’application actuelle, le handoff est principalement alimenté depuis **Constituer → Actions → Alignement** (`setHandoff` + `navigateTo("aligner")`).

### 1.3 Matrice navigation (résumé)

```
                    ┌───────────┐
   Startup overlay  │  (main)   │
                    └─────┬─────┘
                          │ hideOverlay → initShell() → Hub
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  HUB  ──► Concordancier | Constituer | Exporter (cartes + sidebar)     │
└──────────────────────────────────────────────────────────────────────┘
       │              │                    │
       │              │                    └──► Exporter (module dédié)
       │              └──► Constituer (5 sections internes + Actions/Align)
       └──► Concordancier (KWIC)

Constituer → Actions → Alignement → [→ Aligner] ──► sous-vue Aligner (shell)
```

---

## 2. Écran : démarrage / overlay (`index.html` + `main.ts`)

### 2.1 Rôle

Bloquer l’UI tant que le backend n’est pas joignable (mode Tauri), ou passer directement au shell (E2E / dev Vite sans Tauri).

### 2.2 Branchements

| Condition | Comportement |
|-----------|--------------|
| `VITE_E2E === "true"` ou pas `__TAURI_INTERNALS__` | `hideOverlay()` immédiat → `initShell()`. |
| Tauri + `get_project_path` vide | Message bienvenue, bouton « Choisir un projet… », pas de poll tant que pas de chemin. |
| Tauri + chemin sauvegardé | `set_project_path` puis `pollHealth` (500 ms × 60) ; image hero `/ted-barney.png` opacité progressive ; succès → overlay caché → `initShell()` avec **fallback UI** si `initShell` throw (plein écran erreur). |
| Échec poll 30 s | Affichage erreur ; tentative `get_backend_log` ; boutons pick + retry. |

### 2.3 API

`fetchHealth()` → `GET /health`.

### 2.4 Points de jonction vers le reste

Une fois le shell actif, l’utilisateur est **toujours** sur le **Hub** (cf. `initShell`).

---

## 3. Écran : Hub (`src/modules/hubModule.ts`)

### 3.1 Rôle

Point d’entrée après startup : navigation vers les trois grands domaines + vue synthétique du projet.

### 3.2 Structure UI

- Hero : image **`ted-barney.png` en arrière-plan** (calque plein écran, `cover`, dégradé lisibilité) + titre HIMYC et sous-titre **par-dessus** (plus d’image inline à côté du titre).
- **Responsive** (`hubModule.ts`) : **≤900px** — padding réduit, `background-position` ajusté ; **≤640px** — cartes en **colonne** pleine largeur (max ~360px), projet / onboarding / KPI adaptés ; **≤380px** — KPI en grille 2 colonnes, typo cartes réduite.
- **Trois cartes** : `data-mode` = `concordancier` | `constituer` | `exporter` — clic → `ctx.navigateTo(mode)`.
- Section **Projet actif** : nom (`fetchConfig`) + bouton **Changer…** → `ctx.changeProject()`.
- Bandeau **onboarding** si `!series_url?.trim() && languages.length === 0` : CTA → `navigateTo("constituer")`.
- **KPI strip** (si backend online) : `fetchQaReport("lenient")` + `fetchCharacters()` — épisodes, segmentés, SRT, runs align., personnages, gate QA.
- **Statut backend** : pastille + libellé ; `onStatusChange` recharge les infos.

### 3.3 Branchements notables

- Échec `fetchConfig` / KPIs : `.catch(() => {})` — pas de message d’erreur visible (nom projet / KPIs peuvent rester vides).
- Sidebar (shell) : les trois mêmes destinations sans repasser par le hub.

---

## 4. Écran : Concordancier (`src/modules/concordancierModule.ts`)

### 4.1 Rôle

Recherche plein texte **KWIC** sur le corpus indexé (segments, cues SRT, ou niveau épisode « documents »).

### 4.2 Variables d’état principales

- `_scope` : `"segments"` \| `"cues"` \| `"episodes"` — onglets **Segments / Sous-titres / Documents**.
- `_builderMode` : simple \| phrase \| and \| or \| near (+ near-N).
- `_hits`, `_page`, `_hasMore`, `_facets`, `_searchToken` (anti-race).
- Options : fenêtre de contexte, aligné / parallèle, filtres (tiroir), casse, historique localStorage.

### 4.3 Flux recherche (`runSearch`)

1. Construction requête FTS via `buildFtsQuery(raw, mode, nearN)`.
2. `POST /query` avec `scope`, `limit`, **`offset`** (0 sur une recherche initiale), filtres `kind` / `lang` / `episode_id` / `speaker` selon `_scope` — **filtres épisode et locuteur appliqués côté backend** (segments / cues ; scope documents sans locuteur).
3. Succès → `renderResults`, `updateChips`, historique ; `has_more` pilote la barre de résultats et le bouton **Charger plus**.
4. **Charger plus** : nouvelle requête avec `offset = _hits.length`, `limit` par tranche (append), **concaténation** des hits ; **pas** de second appel `POST /query/facets` (les facettes restent celles du premier chargement).
5. **Facettes** (recherche initiale uniquement) : `POST /query/facets` en parallèle ; si échec → **repli client** `buildFacetsFromHits` (pas d’erreur affichée pour les facets seules).
6. Erreur principale → bandeau erreur avec `ApiError` ou `String(e)`.

### 4.4 Branchements par scope

| Scope | Filtres actifs dans la requête |
|-------|-------------------------------|
| segments | `kind` (select UI), `episode_id`, `speaker` (sous-chaîne locuteur côté API) |
| cues | `lang`, `episode_id`, `speaker` (locuteur dérivé du texte de cue côté API) |
| episodes | pas de `kind` / `lang` (champs masqués dans l’UI via `kindGroup` / `langGroup`) ; `episode_id` possible ; **pas de filtre locuteur** au niveau documents |

### 4.5 Sorties

- Export CSV / JSONL (menus dédiés).
- Reset global : état + UI remis à zéro.
- **Pas** de navigation vers Constituer/Aligner depuis ce module (isolement fonctionnel).

### 4.6 Limites volume (côté produit)

- Plafond cumulé **~2000** hits chargés côté client (steps « Charger plus ») ; au-delà, **affinez** la requête (filtres, terme).

---

## 5. Écran : Constituer (`src/modules/constituerModule.ts`)

Vue **la plus volumineuse** : sidebar interne + **cinq sections** + sous-arbre **Actions** avec **quatre sous-vues** + **écran d’audit** imbriqué.

### 5.1 Persistance locale

- `cons-nav-collapsed`, `cons-active-section`, `cons-active-subview`.

### 5.2 Section **Importer**

**Montage** : `renderImporterSection` au premier accès (lazy si placeholder).

**Fonctions typiques** :

- Carte **Projet** : `fetchConfig` + `fetchSeriesIndex` en parallèle ; résumé de l’**index série** ; préremplissage URL ; **origine** (`source_id`) affichée en lecture seule (remplie automatiquement lors de l’enregistrement de la structure dans **Sources web**) — pas de sélecteur « source » dans cette carte ; après **Enregistrer la structure**, synchro `saveConfig` (`series_url`, `source_id`) puis rafraîchissement.
- **Fichiers locaux** : sélecteur épisode (`fetchEpisodes`), import transcript / SRT via Tauri dialog + API (`importTranscript`, `importSrt`).
- Découverte **TVMaze** / **Subslikescript** : boutons discover + fetch transcript (API web du backend).

**Branchements** : erreurs souvent affichées dans des zones `.cons-error` ou `formatApiError` / alertes ; sélecteur épisode peut rester vide si `fetchEpisodes` échoue silencieusement (`.catch` sur certains chemins).

---

### 5.3 Section **Documents**

**Montage** : `renderDocumentsSection` → `loadDocuments` → `fetchEpisodes`.

**UI** : filtre saison, recherche texte, stats agrégées (brut / normalisé / segmenté), liste groupée d’épisodes avec panneau latéral détail par source.

**Branchement clé — vers Curation** :

- Pour chaque **source disponible**, bouton **« → Curation »** :
  1. `_pendingCurationEpisodeId = ep.episode_id`
  2. Clic programmatique sur `.cons-nav-tree-link[data-subview="curation"]` → active **Actions → Curation**
  3. Au prochain `renderCurationEpList`, si `_pendingCurationEpisodeId` est défini, **simulation de clic** sur l’item épisode correspondant (scroll + chargement preview).

**Autres actions** : suppression transcript/SRT, import fichier, Subslikescript si URL compatible — avec `confirm` / `alert` selon les handlers.

**Note** : le code et l’UI ne routent **plus** vers un module shell « Inspecter » ; la lecture/édition de sources se fait dans **Curation** (et modules Actions).

---

### 5.4 Section **Actions** — vue **Hub** (`data-subview="hub"`)

Trois cartes : **Curation**, **Segmentation**, **Alignement** — chaque clic appelle `activateSubView("curation"|"segmentation"|"alignement")`.

**Branchement** : entrer dans **Actions** via l’onglet sidebar « Actions » appelle aussi `activateSubView("hub")` pour afficher le hub pipeline (cf. `activateSection("actions")`).

---

### 5.5 Sous-vue **Curation**

**Données** : `loadAndRender` → `fetchEpisodes` ; liste épisodes avec états ; panneau central preview (modes côte à côte / brut / normalisé / diff) ; colonne diagnostics + jobs inline.

**Normalisation** :

- Profil : `saveConfig` sur changement de liste déroulante.
- **Aperçu** : logique mixte **client** (`normalizeTextClient`, debounce) et/ou **`fetchNormalizePreview`** → `POST /normalize/preview` selon l’implémentation branchée sur les onglets de mode.
- **Jobs** : `createJob("normalize_transcript", …)` avec options ; polling jobs (`fetchJobs`, `startJobPoll`).
- Batch **Normaliser tout** : `guardBatchNormalize` + file de jobs.

**Garde** : `guards.ts` pour imports batch si applicable.

**Connexion** : `_pendingCurationEpisodeId` depuis Documents (ci-dessus).

---

### 5.6 Sous-vue **Segmentation**

**Chargement** : `loadAndRenderSegmentation` si table en état `cons-loading`.

**Colonne épisodes** : sélecteur de **saison** + champ **recherche** (filtre client sur `episode_id` et titre) ; liste dérivée de `fetchEpisodes` mise en cache (`_segEpisodesAll`).

**Paramètres** : portée (normalisés / tous), type utterance vs phrase.

**Vues** : toggle **Table** | **Texte** | **Traduction** — certaines vues lazy (conteneurs affichés/masqués).

**API typiques** : `fetchEpisodeSegments`, jobs `segment_transcript`, etc. (selon handlers dans le fichier).

---

### 5.7 Sous-vue **Alignement** (dans Constituer)

**Liste épisodes** : `loadAndRenderAlignement` — même barre **saison** + **recherche** que la segmentation ; cache `_alignEpisodesAll` + carte des langues alignées par épisode. État segmenté + SRT requis pour bouton **→ Aligner**.

**Branchement vers shell Aligner** :

- Clic **→ Aligner** sur une ligne éligible :
  - Lecture des paramètres batch depuis le DOM (`#hub-align-seg-kind`, `#hub-align-lang`, `#hub-align-conf`, `#hub-align-sim`) — **attention** : ids « hub » dans une vue Constituer (héritage de naming).
  - Construction objet `AlignerHandoff` (pivot `transcript`, `target_keys` = pistes SRT, `transcript_first`, `segment_kind`, `pivot_lang`, `target_langs`, `min_confidence`, `use_similarity_for_cues`).
  - `_ctx.setHandoff(handoff)` puis `_ctx.navigateTo("aligner")`.

**Historique par épisode** : clic ligne (hors bouton) → `loadAlignmentRunHistory` → cartes de runs.

**Audit** : interaction sur une carte run → `openAuditView(panel, epId, epTitle, runId)` :

- Écran plein panneau avec onglets **Liens**, **Collisions**, **Concordancier** (lazy).
- Bulk actions sur liens, export HTML/JSON, minimap, filtres statut, etc.
- API : `fetchAlignRunStats`, `fetchAuditLinks`, `fetchAlignCollisions`, `fetchConcordance`, `patch` / bulk statuts, etc.

**Retour** : bouton retour dans l’audit restaure la liste des runs (logique interne au panneau).

---

### 5.8 Section **Personnages**

**Montage lazy** : `renderPersonnagesSection`.

**Fonctions** : chargement `fetchCharacters` / `fetchAssignments`, édition tableau, `saveCharacters`, `saveAssignments`, `autoAssignCharacters`, `propagateCharacters` selon l’UI — branchements sur erreurs avec messages dans le panneau.

---

### 5.9 Section **Exporter** (embarquée dans Constituer)

**Montage** : `renderExporterSection`.

**Rôle** : raccourcis d’export **sans quitter** Constituer — **chevauchement fonctionnel** avec le module **Exporter** top-level (mêmes familles d’exports, parcours utilisateur différent).

---

## 6. Écran : Exporter (`src/modules/exporterModule.ts`)

### 6.1 Rôle

Exports « bureau » depuis un module dédié : corpus, segments, alignements, SRT enrichi, personnages, QA, jobs.

### 6.2 Onglets (`data-stage`)

| Onglet | Comportement |
|--------|----------------|
| corpus / segments / personnages / jobs | Boutons format → `runExport` avec scope/format. |
| alignements | **Lazy** au premier clic : `loadAlignmentsTab` → `fetchAllAlignmentRuns`, `exportAlignments`. |
| srt | **Lazy** : `propagateCharacters`, `fetchEpisodeSource`, etc. |
| qa | `fetchQaReport` avec politique lenient/strict ; export JSON client des données QA. |

### 6.3 KPI header

Remplis via QA report + config projet (`fetchConfig`) — échecs partiels possibles en silence sur le badge.

---

## 7. Écran : Aligner — sous-vue shell (`src/modules/alignerModule.ts`)

### 7.1 Rôle

Configurer et lancer un **job** `align` pour un épisode ; afficher préconditions si bloqué ; historique des runs.

### 7.2 Entrées

| Source | Comportement |
|--------|----------------|
| `getHandoff()` au mount | Préremplit épisode / pivot / cibles / `segment_kind` / paramètres MX-037 si présents dans le handoff. **Une seule lecture** — navigation ultérieure sans repasser par Constituer = pas de handoff. |
| Navigation directe | Sélection manuelle d’épisode dans le formulaire (chargement `fetchEpisodes`). |

### 7.3 Garde métier

- `guardAlignEpisode` : si refus, affichage **checklist** `getAlignPreconditions` à la place du formulaire.
- Sinon : formulaire avec cases à cocher des cibles SRT, lancement `createJob("align", …)`.

### 7.4 Suivi job

- `startPoll` → `fetchJobs` toutes les 2 s jusqu’à done/error ; `formatJobError` sur erreur worker.
- `loadRuns` pour historique après succès.

### 7.5 Retour

Bouton shell **← Retour** → `_prevNavMode` (souvent Constituer si l’utilisateur venait de là).

---

## 8. Fichiers présents mais non montés par le shell

| Fichier | Observation |
|---------|-------------|
| ~~`inspecterModule.ts`~~ | **Supprimé** — Curation + Distribution couvrent le flux. |
| `src/features/metaPanel.ts` | **`openMetaPanel`** depuis le Concordancier (bouton ℹ sur chaque hit). |

**Écart documentation** : le commentaire en tête de `shell.ts` mentionne encore « Inspecter / Aligner » comme sous-vues ; seul **Aligner** est une sous-vue réelle dans cette version.

---

## 9. Synthèse des branchements critiques (checklist revue)

1. **Handoff Aligner** : unique consommation — l’utilisateur ne doit pas s’attendre à retrouver le formulaire prérempli après un aller-retour sans nouveau `setHandoff`.
2. **Documents → Curation** : dépend de `_pendingCurationEpisodeId` + clic simulé sur l’item liste — si l’épisode a disparu de la liste, la sélection peut échouer silencieusement.
3. **Concordancier facets** : échec réseau → facets approximatives **sans** bandeau explicite.
4. **Hub KPIs / config** : échecs API **silencieux** sur certaines promesses.
5. **Deux chemins d’export** : Constituer section Exporter vs module Exporter — même backend, UX à clarifier côté produit.

---

## 10. Index des fichiers sources par écran

| Écran | Fichier(s) principal(aux) |
|-------|---------------------------|
| Startup | `index.html`, `main.ts` |
| Shell layout | `shell.ts` |
| Hub | `modules/hubModule.ts` |
| Concordancier | `modules/concordancierModule.ts` |
| Constituer | `modules/constituerModule.ts` |
| Exporter | `modules/exporterModule.ts` |
| Aligner | `modules/alignerModule.ts` |
| API | `api.ts` |
| Règles métier | `guards.ts`, `model.ts` |
| Mort / latent | — (`metaPanel` branché Concordancier) |

---

## 11. Révision documentaire (résumé)

| Sujet | État documenté |
|-------|----------------|
| **Build** | Vite 8 — sortie bundle peut inclure des chunks aux noms générés (ex. runtime) ; comportement inchangé pour l’utilisateur. |
| **Concordancier** | Pagination serveur **offset** + append client ; facettes figées après le 1er chargement ; filtres **episode_id** / **speaker** sur segments & cues via API. |
| **Tests** | `npm test` (Vitest) ; backend Python `pytest` — section *Tests* du `CHANGELOG.md` du dépôt **HIMYC** (Python). |

---

**Voir aussi** : [comparaison détaillée HIMYC × AGRAFES](./AUDIT_COMPARAISON_HIMYC_AGRAFES_2026-03.md) · [audit éléments non branchés / plan d’action](./AUDIT_NON_BRANCHES_2026-03.md) · [audit UI panneaux](./AUDIT_UI_2026-03.md).

---

*Fin du document.*
