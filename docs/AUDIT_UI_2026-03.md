# AUDIT_UI_2026-03 — Panneaux et sous-vues HIMYC Tauri

Audit de l’interface utilisateur du frontend **HIMYC_Tauri** (shell, modules montés par `shell.ts`).  
Date de référence : mars 2026.

**Compléments** : [audit visuel](./AUDIT_VISUEL_2026-03.md) · [audit erreurs](./AUDIT_ERREURS_2026-03.md) · [audit écran par écran](./AUDIT_ECRANS_2026-03.md).

---

## 1. Modèle de navigation (shell)

Fichier source : `src/shell.ts`.

| Concept | Détail |
|--------|--------|
| **Modes top-level** | Onglets header : **Concordancier** · **Constituer** · **Exporter**. |
| **Hub** | Landing sans onglets ; tuiles vers les trois modes ci-dessus. |
| **Sous-vues shell** | **Aligner** uniquement : pas d’onglet ; « ← Retour » restaure `_prevNavMode`. |
| **Persistance du mode** | **Aucune** : à chaque `initShell()`, l’utilisateur arrive sur le **Hub** (choix produit). |
| **Changement de projet (Tauri)** | Après `set_project_path`, navigation vers **hub** pour recharger le contexte. |

### Contrat `ShellContext` (`src/context.ts`)

- `navigateTo(mode)` — `hub` \| `concordancier` \| `constituer` \| `exporter` \| `aligner` (pas de mode `inspecter`).
- Statut backend : `getBackendStatus`, `onStatusChange`
- **Handoff → Aligner** : `setHandoff` / `getHandoff` — **`getHandoff()` consomme la valeur** (lecture unique). Alimenté depuis **Constituer → Actions → Alignement**.

---

## 2. Panneau Hub (`src/modules/hubModule.ts`)

| Élément | Rôle |
|--------|------|
| Fond | Image série en **plein cadre** (CSS `background`), blocs UI au premier plan. |
| Tuiles | Navigation programme vers Concordancier / Constituer / Exporter. |
| Statut backend | Pastille + libellé (version si en ligne) ; écoute `onStatusChange`. |
| Projet | `GET /config` → affichage `project_name`. |
| Onboarding | Si série vide et aucune langue : bandeau CTA vers **Constituer**. |
| KPIs | `GET /export/qa` (policy lenient) + `GET /characters` : épisodes, segmentés, SRT, runs d’alignement, personnages, gate QA. |

**Forces** : entrée lisible, indicateurs corpus utiles.  
**Limites** : KPIs non affichés si appel échoue (silencieux). Le **brand « HIMYC »** renvoie au Hub (`shell.ts`).

---

## 3. Panneau Concordancier (`src/modules/concordancierModule.ts`)

Vue mono-écran « KWIC » (large surface : toolbar, résultats, filtres, exports).

| Zone | Contenu |
|------|---------|
| **Scope** | Onglets : Segments · Sous-titres (cues) · Documents (`episodes`). |
| **Recherche** | Champ + builder : simple, phrase, AND, OR, NEAR (+ fenêtre NEAR). |
| **FTS** | Prévisualisation requête, aide, historique `localStorage`. |
| **Affichage** | Aligné / parallèle, fenêtre de contexte, pagination client, `has_more`. |
| **Filtres** | Drawer (type, langue, épisode, locuteur), chips, barre analytics. |
| **Export** | CSV plat / long, JSONL simple / parallèle. |
| **Méta** | Bouton **ℹ** sur chaque ligne / carte → `openMetaPanel` (épisode, source selon scope, segment/cue si présents). |

**API** : principalement `POST /query`, `POST /query/facets` (via `apiPost` / `apiGet`).

**Risques** : surface fonctionnelle très large ; tests E2E à cibler par scénarios critiques.

---

## 4. Panneau Constituer (`src/modules/constituerModule.ts`)

Cœur composite : **sidebar** + sections, **lazy-mount** de plusieurs sections, état persisté.

### 4.1 Sections (sidebar)

| Section | Lazy | Résumé |
|---------|------|--------|
| **Importer** | Oui | Découverte (TVMaze, Subslikescript), imports transcript/SRT. |
| **Documents** | Oui | Grille épisodes × sources ; **→ Curation** (pré-sélection épisode, pas de module Inspecter). |
| **Actions** | Non (structure) | Hub + sous-vues Curation / Segmentation / Alignement. |
| **Personnages** | Oui | Catalogue, assignations, auto-assign, propagation. |
| **Exporter** | Oui | Raccourcis export **dans** Constituer. |

**Clés `localStorage`** : `cons-active-section`, `cons-active-subview`, `cons-nav-collapsed`.

### 4.2 Sous-vues « Actions »

| Sous-vue | Rôle |
|----------|------|
| **Hub** | Cartes vers Curation, Segmentation, Distribution, Alignement. |
| **Curation** | Normalisation batch, preview brut/normalised/diff, jobs inline, persistance profil via `saveConfig`. |
| **Distribution** | Après segmentation : table utterance + assignations ; si transcript non segmenté, panneau pipeline (Curation → Segmentation) + raccourcis. |
| **Segmentation** | Portée, type utterance/phrase, vues Table / Texte / Traduction. |
| **Alignement** | Paramètres pivot/confiance/similarité, runs, panneau détail ; accès **audit de run** (voir 4.3). |

### 4.3 Sous-vue imbriquée — Audit d’alignement

À l’intérieur de **Actions → Alignement** : écran type `openAuditView` avec :

- Stats, exports HTML/JSON, barre de qualité.
- **Onglets** : **Liens** (table, minimap, filtres, bulk) · **Collisions** · **Concordancier** (chargement à la demande).

**Remarque** : troisième niveau d’interface dense (APIs multiples : liens, collisions, stats, concordance run, etc.).

### 4.4 Synthèse Constituer

**Forces** : couvre l’intégralité du workflow corpus → pipeline → alignement → curation des liens.  
**Limites** : fichier monolithique (~6k lignes) ; chevauchement avec **Exporter** top-level et avec le **Concordancier** global (plusieurs contextes « recherche / concordance »).

---

## 5. Panneau Exporter (`src/modules/exporterModule.ts`)

| Onglet (`data-stage`) | Contenu |
|----------------------|---------|
| **Corpus** | TXT, CSV, JSON, DOCX, JSONL (`scope=corpus`). |
| **Segments** | TXT, CSV, TSV, DOCX. |
| **Alignements** | Chargement lazy : liste runs, export alignements (`GET /export/alignments`). |
| **SRT enrichi** | Lazy : flux combinant sources SRT / propagation personnages. |
| **Personnages** | Exports `characters` et `assignments` (JSON, CSV). |
| **QA** | Politique lenient/strict, bannière gate, liste d’issues, export JSON rapport. |
| **Jobs** | JSONL, JSON. |

~~**Écart doc ↔ code** : le commentaire d’en-tête du fichier mentionne *« Corpus \| Segments \| QA \| Jobs »* ; l’UI inclut aussi **Alignements**, **SRT enrichi** et **Personnages** — **mettre le commentaire à jour**.~~ ✅ Corrigé.

**Chevauchement** : même famille d’exports via **Constituer → Exporter** et cet onglet top-level (clarifier intention produit ou fusionner).

---

## 6. ~~Module Inspecter~~ (supprimé)

L’ancien `inspecterModule.ts` a été **retiré** du dépôt ; le flux lecture / normalisation / segmentation est couvert par **Constituer → Actions** (Curation, Segmentation, Distribution, Alignement).

---

## 7. Sous-vue shell Aligner (`src/modules/alignerModule.ts`)

| Zone | Comportement |
|------|--------------|
| Préremplissage | Via `getHandoff()` si présent ; sinon formulaire manuel (épisode, pivot, cibles). |
| Garde | `guardAlignEpisode`, préconditions affichées. |
| Exécution | Job `align` + retour utilisateur + historique des runs. |

**Attention** : après `getHandoff()`, le handoff est **vidé** — un aller-retour ne restaure pas le formulaire sans un nouveau `setHandoff` depuis **Constituer → Alignement**.

---

## 8. Composant transverse — Panneau méta (`src/features/metaPanel.ts`)

- Panneau latéral global (backdrop + `#himyc-meta-panel`).
- Sections : épisode (id, titre, pistes SRT), source active, langue, état (badges), segment/cue si fournis.
- Pied : copie « référence » épisode/titre.
- **Ouverture** : bouton **ℹ** sur chaque résultat du **Concordancier** (table et cartes alignées).

**Hors périmètre** vs AGRAFES d’origine : pas de navigation prev/next entre hits (documenté dans le fichier source).

---

## 9. Démarrage (`src/main.ts`, `index.html`)

- Overlay : sélection dossier projet (Tauri), `set_project_path`, attente `/health`, puis `initShell()`.
- `VITE_E2E=true` : contournement de l’overlay (Playwright).

---

## 10. Recommandations consolidées

1. **Documenter** la double entrée **Exporter** (top-level vs Constituer) ou **fusionner** les parcours.
2. **Découper** `constituerModule.ts` par domaine (import, documents, audit, personnages) pour maintenance et tests.
3. **Clarifier** les libellés « Concordancier » (global vs onglet audit alignement).
4. **En-tête Exporter** : aligner le commentaire sur les onglets réels.
5. **Support** : documenter handoff **à usage unique** (`getHandoff`) pour éviter les tickets « le formulaire s’est vidé ».

---

## 11. Tableau fichiers ↔ rôle UI

| Fichier | Rôle |
|---------|------|
| `src/shell.ts` | Shell, nav, sous-vue Aligner, health poll, toast, projet Tauri (démarrage sur Hub) |
| `src/main.ts` | Bootstrap Tauri / E2E, overlay startup |
| `src/context.ts` | Contrat `ShellContext` |
| `src/modules/hubModule.ts` | Hub |
| `src/modules/concordancierModule.ts` | Concordancier KWIC |
| `src/modules/constituerModule.ts` | Constituer (sections + actions + audit) |
| `src/modules/exporterModule.ts` | Exporter top-level |
| ~~`inspecterModule.ts`~~ | Supprimé — remplacé par Curation + Distribution |
| `src/modules/alignerModule.ts` | Aligner |
| `src/features/metaPanel.ts` | Panneau méta latéral |
| `index.html` | Shell DOM + overlay startup |

---

## 12. État toolchain & tests (mise à jour 2026-03)

| Domaine | Détail |
|--------|--------|
| **Frontend** | `vite` ^8 · `vitest` ^3.2 — `npm audit` : 0 vulnérabilité (dev) |
| **Backend** | Suite `pytest tests/` : **440** tests verts (dont E2E pipeline HTTP alignés sur codes **201** et liste `/episodes`) |

*Cette section documente l’état outillage au moment de la mise à jour ; le reste de l’audit reste inchangé structurellement.*

---

*Fin du document.*
