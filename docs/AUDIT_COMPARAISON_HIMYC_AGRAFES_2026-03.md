# Comparaison détaillée — HIMYC Tauri × AGRAFES

**Objectif** : comparer les deux applications **sur la base des audits écran par écran** ([`AUDIT_ECRANS_2026-03.md`](./AUDIT_ECRANS_2026-03.md) pour HIMYC ; équivalent dans le dépôt AGRAFES) et des structures réelles du code, en **argumentant** ressemblances, différences et implications pour chaque vue / sous-vue.

**Date** : mars 2026.

**Mémo dérivé (pistes d’emprunt ciblées)** : [`MEMO_EMPRUNTS_AGRAFES_VERS_HIMYC_2026-03.md`](./MEMO_EMPRUNTS_AGRAFES_VERS_HIMYC_2026-03.md).

---

## 1. Positionnement des deux produits

| Critère | **HIMYC Tauri** | **AGRAFES (shell unifié)** |
|--------|------------------|----------------------------|
| **Domaine** | Corpus **séries TV** : transcriptions, sous-titres, alignement transcript ↔ SRT, personnages par locuteur. | Corpus **documentaire multilingue** (TEI / multicorpus) : recherche, préparation, **publication** (packages TEI, etc.). |
| **Backend** | FastAPI **monolithique** sur `127.0.0.1:8765`, projet = **dossier** (`HIMYC_PROJECT_PATH`). | **Sidecar Python** par **base SQLite** ouverte ; contrat HTTP documenté (`SIDECAR_API_CONTRACT` côté AGRAFES). |
| **Identité données** | **Épisode** (`s01e01`), sources par épisode, pipeline normalize → segment → align. | **Documents / unités** dans une DB SQLite partagée ; modèle plus générique (langues, rôles, ressources). |
| **Frontend** | **Un seul paquet** Tauri/Vite : modules dans `src/modules/*`. | **Multi-paquets** : `tauri-shell` + **embed** `tauri-app` (Explorer) et `tauri-prep` (Constituer) via imports dynamiques. |

**Ressemblance structurelle** : les deux proposent une **coque** (shell) qui enchaîne un **concordancier** et un **atelier de constitution** du corpus, avec une **zone de contexte** (projet vs fichier `.db`).

---

## 2. Shell : navigation, persistance, cycle de vie

### 2.1 Modèle de navigation

| Aspect | HIMYC | AGRAFES |
|--------|-------|---------|
| **Page d’accueil** | **Hub** : 3 cartes (Concordancier, Constituer, Exporter). Sidebar identique (3 entrées). **Pas** de 4ᵉ carte « Publier ». | **Home** : 3 cartes (Explorer, Constituer, **Publier**). Header : onglets **Explorer** et **Constituer** seulement ; **Publier** via carte home ou **⌘/Ctrl+3**. |
| **Modes top-level** | `hub` \| `concordancier` \| `constituer` \| `exporter` + sous-vue `aligner`. | `home` \| `explorer` \| `constituer` \| `publish`. |
| **Sous-vues shell** | **Aligner** uniquement (`SUB_VIEWS`) : retour restaure `_prevNavMode`. | **Aucune** sous-vue shell du type « Aligner » : l’alignement vit **dans** Prep (Actions). **Publier** est un **mode plein écran** dans le shell, pas un module séparé. |
| **Démarrage** | `initShell()` **monte toujours le Hub** — pas de restauration du dernier mode (version auditée). | Restauration **`agrafes.lastMode`** + **`agrafes.lastDbPath`** depuis `localStorage` ; deep-links `?mode=` / hash / runtime. |
| **Brand** | Clic **HIMYC** → `hub`. | Clic **AGRAFES** → `home` **sans** réinitialiser la DB. |

**Argument** : HIMYC privilégie une **entrée projet + hub systématique** à chaque session documentée ; AGRAFES privilégie la **continuité de contexte** (dernier mode + dernière DB). Les deux sont cohérents avec un usage « bureau » vs « travail sur plusieurs corpus ».

### 2.2 Cycle de vie des vues

| Aspect | HIMYC | AGRAFES |
|--------|-------|---------|
| **Swap DOM** | Navigation module par module via `MODE_CONFIGS` ; pas de remplacement documenté du nœud `#app` entier comme pattern principal. | **`_freshContainer()`** : nouveau `#app` à chaque changement de mode pour **casser** les listeners — pattern explicite contre fuites DOM. |
| **Dispose** | Chaque module expose `dispose` dans `MODE_CONFIGS`. | Idem + **dispose** des apps embarquées (`disposeApp`, `App.dispose()`). |
| **Chargement** | Pas de chunk dynamique documenté au niveau shell (tout dans le bundle principal). | **Import dynamique** des wrappers `explorerModule` / `constituerModule` + spinner. |

**Ressemblance** : séparation **mount / dispose** pour limiter l’état résiduel. **Différence** : AGRAFES **découpe** physiquement le front (chunks) et **réinstancie** le conteneur ; HIMYC reste un **arbre de modules** monolithique.

### 2.3 Contexte shell (`ShellContext`)

| HIMYC | AGRAFES |
|-------|---------|
| `navigateTo`, `changeProject` (Tauri), `getHandoff` / `setHandoff` (Aligner), statut API (`onStatusChange`, health). | `getDbPath`, `onDbChange` — **pas** de navigation dans le contexte : le router est **dans** `shell.ts`. |

**Argument** : le contrat HIMYC est **riche** sur le **projet** et le **handoff métier** ; celui d’AGRAFES est **minimal** (fichier DB + listeners), car la navigation et les presets sont gérés ailleurs.

---

## 3. Démarrage applicatif (avant shell)

| HIMYC | AGRAFES |
|-------|---------|
| **Overlay** : poll `GET /health` jusqu’à backend prêt ; choix dossier projet si vide ; E2E bypass. | Non décrit de la même manière dans l’audit AGRAFES : l’accent est sur **DB + sidecar** une fois dans l’app. |
| **Blocage** : impossible d’utiliser le shell Tauri sans API joignable (sauf modes dev). | **Blocage fonctionnel** si pas de DB / sidecar — logique dans `bootstrap` / init des modules embarqués. |

**Différence claire** : HIMYC **couple** l’UI au **serveur FastAPI projet** ; AGRAFES **couple** l’UI au **fichier SQLite** et au **processus sidecar** associé.

---

## 4. Concordancier / Explorer — comparaison fonctionnelle

### 4.1 Rôle commun

Les deux offrent une **recherche plein texte** (FTS), des **filtres**, des **résultats** type KWIC ou équivalent, des **exports**, un **historique**.

### 4.2 Implémentation et périmètre

| Dimension | HIMYC (`concordancierModule`) | AGRAFES (`tauri-app` dans `explorer`) |
|-----------|-------------------------------|----------------------------------------|
| **API** | `POST /query`, `POST /query/facets` vers **FastAPI**. | Client **sidecar** (`query`, `queryFacets`, etc.). |
| **Scopes** | **Trois onglets** : Segments · Sous-titres (cues) · Documents (épisodes). Filtres **kind / lang / épisode / speaker** selon scope. | Modèle **document / unité / langue / rôle** ; UI dans `buildUI` (toolbar dense : Segment/KWIC, Alignés, Parallèle, etc.). |
| **Richesse UI** | Builder FTS (simple, phrase, AND, OR, NEAR), analytics + facets avec **repli client** si facets API échouent. | Pagination **append**, tri par doc, **analytics** (stats par document), `IntersectionObserver`, tiroir filtres. |
| **Navigation sortante** | **Aucune** intégration vers Constituer depuis ce module (isolement). | **Import** de corpus, **ouverture DB**, deep-links ; bouton Prep vers **shell** (`agrafes-shell://…`). |

**Ressemblance** : même **famille UX** (barre de recherche, filtres, résultats enrichis, export).  
**Différence** : HIMYC **structure la recherche autour des épisodes et des locuteurs** ; AGRAFES **structure autour des documents et métadonnées multilingues**. Les **échecs facets** sont gérés différemment (repli silencieux HIMYC vs logique côté sidecar AGRAFES).

### 4.3 Panneau méta

- **AGRAFES** : `metaPanel` **branché** depuis les résultats (`setMetaOpener`).
- **HIMYC** : `metaPanel` **branché** depuis le Concordancier (bouton ℹ sur les hits) — mars 2026.

**Argument** : même feature partagée conceptuellement ; les deux shells peuvent l’exposer depuis la recherche.

---

## 5. Constituer — structure des vues et sous-vues

### 5.1 Granularité de la navigation interne

| HIMYC | AGRAFES (`tauri-prep`) |
|-------|------------------------|
| **5 sections** sidebar : Importer, Documents, Actions, Personnages, Exporter (section **Exporter** **en plus** du module top-level). | **4 onglets** : Importer, Documents, Actions, Exporter — **pas** de section Personnages dédiée au même endroit. |
| **Persistance** : `cons-active-section`, `cons-active-subview`, `cons-nav-collapsed`. | **Garde** onglet : `hasPendingChanges` + `confirm` ; presets `agrafes.prep.presets`. |
| **Lazy** : plusieurs sections montées au premier accès. | Écrans instanciés dans `App` ; activation ex. `onActivate` sur Documents. |

**Ressemblance** : **pipeline** Importer → Documents → **Actions** (Curation / Segmentation / Distribution / Alignement) → exports.  
**Différence majeure** : HIMYC **sépare Personnages** et **duplique** une surface « Exporter » **dans** Constituer **et** en module global ; AGRAFES **factorise** en 4 onglets et **ajoute** JobCenter + presets + lien **↗ Shell**.

### 5.2 Section / onglet **Importer**

| HIMYC | AGRAFES |
|-------|---------|
| Config projet (`fetchConfig`), import transcript/SRT par épisode, **TVMaze** / **Subslikescript**. | Import vers la DB **générique** (écran `ImportScreen`) — pas le même jeu d’APIs « série TV ». |

**Ressemblance** : point d’entrée **fichiers + sources externes**.  
**Différence** : HIMYC est **opinionated série** ; AGRAFES est **aligné modèle documentaire / TEI**.

### 5.3 Section / onglet **Documents**

| HIMYC | AGRAFES |
|-------|---------|
| Liste **épisodes** × sources, stats, filtre saison ; **→ Curation** via `_pendingCurationEpisodeId` + clic simulé sur la liste Curation. | **MetadataScreen** : métadonnées documents ; pas le même branchement « épisode → curation » (modèle différent). |

**Ressemblance** : **inventaire** du corpus avant pipeline.  
**Différence** : le **fil conducteur épisode → curation** est **explicite et fragile** (clic simulé) dans HIMYC ; AGRAFES suit une **autre granularité** (documents).

### 5.4 Actions — hub interne et trois sous-vues

Les deux ont un **hub Actions** (cartes) puis :

| Sous-vue | HIMYC | AGRAFES |
|----------|-------|---------|
| **Curation** | Normalisation, preview client/serveur (`/normalize/preview`), jobs, batch ; lien depuis Documents. | Équivalent fonctionnel dans `ActionsScreen` (sous-vue **curation**) ; **classe CSS** `actions-sub-curation` → mode **large** (`prep-curation-wide`). |
| **Distribution** | Placeholder + résumé corpus (itinéraire `PUT /assignments`) — mars 2026. | Pas d’équivalent nommé dans l’audit AGRAFES. |
| **Segmentation** | Table / Texte / Traduction ; jobs `segment_transcript`. | Sous-vue **segmentation** dans Actions. |
| **Alignement** | Liste épisodes, historique runs, **audit** inline (Liens / Collisions / Concordancier) ; **→ Aligner** déclenche **sous-vue shell** avec handoff. | Sous-vue **alignement** **sans** navigation shell séparée : tout reste dans Prep (pas d’équivalent `alignerModule`). |

**Ressemblance** : même **découpage métier** du pipeline.  
**Différence architecturale** : HIMYC **sort** l’alignement « plein écran shell » avec **handoff consommable une fois** ; AGRAFES **garde** l’alignement et la publication dans les **modules métier** ou le **wizard Publier**.

### 5.5 Audit d’alignement (niveau 3)

- **HIMYC** : **À l’intérieur** de Constituer → Alignement — `openAuditView` (onglets Liens, Collisions, mini-concordancier sur le run).
- **AGRAFES** : l’audit détaillé n’est **pas** décrit au même niveau dans l’audit écrans (à confirmer dans `ActionsScreen` / prep) ; le **Concordancier global** est dans Explorer.

**Argument** : HIMYC **concentre** l’audit des liens **près du pipeline** ; AGRAFES peut **disperser** entre prep et Explorer selon les écrans (vérification code si besoin produit).

### 5.6 Personnages (HIMYC uniquement dans cet emplacement)

- **HIMYC** : section dédiée — `fetchCharacters`, `fetchAssignments`, auto-assign, propagation.
- **AGRAFES** : **pas** d’équivalent dans les 4 onglets de l’audit (le domaine « personnages / locuteurs » est **propre à HIMYC**).

---

## 6. Exports et publication

| Surface | HIMYC | AGRAFES |
|---------|-------|---------|
| **Module dédié** | **Exporter** : onglets corpus, segments, alignements (lazy), SRT enrichi, personnages, QA, jobs. | Onglet **Exporter** dans Prep + pas de « module Exporter » **symétrique** au hub HIMYC dans l’audit (exports dans `ExportsScreen`). |
| **Doublon** | **Constituer → Exporter** recoupe le module **Exporter** (même backend, UX double). | Moins de duplication documentée entre « home » et prep ; **Publier** est **distinct** (wizard TEI / jobs). |
| **Publication** | Pas d’équivalent **wizard Publier** dans le shell HIMYC (hors scope audit). | **Mode `publish`** : job package TEI, logs `_shellLog`, intégré au shell. |

**Synthèse** : HIMYC **maximalise** les formats d’**export données** ; AGRAFES ajoute une **couche publication** (TEI / packaging) **au niveau shell**.

---

## 7. Aligner, metaPanel

| Sujet | HIMYC | AGRAFES |
|-------|-------|---------|
| **Aligner** | **Sous-vue shell** `alignerModule` : `getHandoff()` **lecture unique**, `guardAlignEpisode`, poll jobs. | Pas d’équivalent shell ; alignement dans **Prep**. |
| ~~**Inspecter**~~ | **Supprimé** — Curation + Distribution. | — |
| **metaPanel** | Concordancier (ℹ sur les hits). | Utilisé depuis les résultats (`setMetaOpener`). |

---

## 8. Raccourcis, header, santé système

| HIMYC | AGRAFES |
|-------|---------|
| Santé **API** : poll 30 s, toasts online/offline, version backend. | Accent **DB** + **sidecar** ; raccourcis **⌘0–3**, O, Shift+N, /, ?. |
| Sidebar **192px** fixe. | Sidebar prep + **collapse** ; **dataset.mode** pour thème explorer/constituer. |

---

## 9. Tableau récapitulatif des vues / sous-vues

| Vue / sous-vue | HIMYC | AGRAFES | Rapport |
|------------------|-------|---------|---------|
| Accueil | Hub (3 cartes + KPI + onboarding) | Home (3 cartes + tutoriel optionnel) | Même rôle ; HIMYC plus **métrique projet**. |
| Recherche FTS | Concordancier (3 scopes) | Explorer / Concordancier | Même famille ; **périmètre données** différent. |
| Importer | Section Constituer | Onglet Importer | Équivalent. |
| Documents | Section Constituer | Onglet Documents | Équivalent **rôle** ; **objet** épisode vs document. |
| Actions / hub pipeline | Cartes Curation, Seg., Align. | Idem + sous-arbre nav | Équivalent. |
| Curation | Sous-vue | Sous-vue | Équivalent. |
| Segmentation | Sous-vue | Sous-vue | Équivalent. |
| Alignement | Sous-vue + **audit** + **→ Aligner shell** | Sous-vue **sans** shell Aligner | **Différence majeure**. |
| Personnages | Section Constituer | *(non listé dans audit AGRAFES)* | **Spécifique HIMYC**. |
| Exporter | Module **+** section Constituer | Onglet Exporter | HIMYC **duplique** ; AGRAFES **consolide** dans Prep. |
| Exporter (alignements, QA, SRT…) | Module riche | Selon `ExportsScreen` | À rapprocher au cas par cas. |
| Publier | — | Mode **publish** | **Spécifique AGRAFES**. |
| Aligner plein écran | `alignerModule` | — | **Spécifique HIMYC**. |

---

## 10. Conclusion argumentée

1. **Même architecture cognitive** : shell → **recherche** + **atelier de corpus** + **exports** ; pipeline **curation → segmentation → alignement** dans l’atelier.

2. **HIMYC** optimise un **workflow série** (épisodes, locuteurs, QA, handoff vers un **Aligner** dédié, personnages) avec un **backend unique** et un front **monolithique** ; le coût est la **duplication Exporter** et le **travail restant** sur **Distribution** (UI riche assignations).

3. **AGRAFES** optimise la **réutilisation** (apps `tauri-app` / `tauri-prep`), la **persistance de session** (mode + DB), et la **publication TEI** ; le coût est la **complexité multi-paquets** et l’absence d’un **Aligner shell** comparable (autre choix d’UX).

4. Pour une **cartographie produit**, aligner les termes : **Explorer ≈ Concordancier**, **Constituer ≈ Prep**, **Hub ≈ Home**, en gardant à l’esprit les **écarts** Personnages, Aligner shell, Publier TEI et scopes de recherche.

---

*Document de synthèse ; pour le détail ligne à ligne, se reporter aux audits écran par écran de chaque dépôt.*
