# AUDIT_ERREURS_2026-03 — Gestion des erreurs HIMYC Tauri

Audit du **traitement des erreurs** côté frontend : types d’échec, flux utilisateur, silences, incohérences et risques.  
Complète : [AUDIT_UI_2026-03.md](./AUDIT_UI_2026-03.md), [AUDIT_VISUEL_2026-03.md](./AUDIT_VISUEL_2026-03.md).

---

## 1. Types d’erreurs possibles

| Source | Nature | Typage côté TS | Comportement typique |
|--------|--------|----------------|----------------------|
| **HTTP 4xx/5xx** | Corps JSON `{ error, message }` ou texte brut | `ApiError(status, errorCode, message)` | Levé par `apiGet` / `apiPost` / `apiPatch` / `apiPut` / `apiDelete` (`src/api.ts`) |
| **Réseau / backend absent** | Échec avant réponse HTTP valide | Souvent **rejet** de `invoke` (Tauri) ou erreur fetch (E2E) | **Pas** systématiquement `ApiError` — modules doivent gérer `String(e)` ou tester `instanceof ApiError` |
| **Corps 200 non JSON** | `JSON.parse` sur réponse vide ou HTML | `SyntaxError` (ou autre) | **Non enveloppé** en `ApiError` — message peu lisible pour l’utilisateur |
| **Garde métier** | Action interdite selon l’état du corpus | `GuardResult` + `guardedAction` | Message via `reason` — **pas d’exception** |
| **Erreur job worker** | Chaîne backend Python | Affinage via `formatJobError()` (`src/guards.ts`) | Utilisé notamment pour l’Aligner |

**Constante** : `DEFAULT_ERROR_CODE = "UNKNOWN"` (`src/constants.ts`) quand le corps d’erreur n’est pas parseable en JSON.

---

## 2. Couche API (`src/api.ts`)

### 2.1 Points forts

- centralisation des appels HTTP ;
- construction uniforme de `ApiError` pour `!res.ok` ;
- tentative de parse JSON du corps d’erreur avec repli sur `res.body` brut.

### 2.2 Risques

1. **`JSON.parse(res.body)` sur succès** — si le backend renvoie `200` avec corps vide ou non JSON, la promesse **rejette** avec une erreur native (`SyntaxError`), **pas** `ApiError`. Les `catch` qui n’affichent que `e.message` peuvent montrer un message technique peu actionnable.
2. **`invoke("sidecar_fetch_loopback", …)`** — en cas d’échec IPC ou de bug Rust, l’exception remonte telle quelle ; les modules qui supposent toujours `ApiError` sont incomplets.
3. **Pas de timeout explicite** sur les requêtes (comportement dépendant du sidecar) : risque d’attente longue perçue comme “plantage” sans message.

---

## 3. Gardes métier (`src/guards.ts`)

- **Rôle** : éviter des appels API incohérents ; messages **actionnables** en français.
- **`guardedAction`** : si `!allowed`, appelle `onBlocked(reason ?? "Action non autorisée…")` sans lancer d’exception — bon pour l’UX.
- **`formatJobError`** : atténue l’affichage des tracebacks Python et mappe des cas connus — **bon pattern** à réutiliser pour tout feedback lié aux jobs.

---

## 4. Shell et démarrage

| Fichier | Comportement |
|---------|----------------|
| `main.ts` | Overlay : erreur `invoke("set_project_path")` affichée ; `pollHealth` échoue → message utilisateur 30 s ; `initShell().catch(console.error)` → **pas de message UI** si échec d’init shell. |
| `shell.ts` | `_changeProject` : toast en cas d’erreur ou backend indisponible ; health poll met à jour le point API + toast offline/online. |
| `get_project_path` catch | `console.error` uniquement — utilisateur sans chemin peut rester sur l’overlay sans détail si l’erreur est rare. |

---

## 5. Par module — UX erreur et silences

### 5.1 Hub (`hubModule.ts`)

- `fetchConfig().catch(() => { /* backend down — ignore */ })` — **silencieux** : pas de bandeau d’erreur si le hub est affiché alors que le config échoue (ex. race au redémarrage).
- KPIs : `.catch(() => { /* KPIs non critiques */ })` — strip KPI peut rester caché sans explication.

**Impact** : acceptable si le statut backend est visible ailleurs ; sinon l’utilisateur peut croire à un corpus vide.

### 5.2 Concordancier (`concordancierModule.ts`)

- Recherche principale : `catch` affiche `errorCode — message` pour `ApiError`, sinon `String(e)` — **cohérent**.
- Facettes `/query/facets` : en échec, **repli calcul client** depuis les hits — l’utilisateur ne voit pas d’erreur ; les analytics peuvent être partiels **sans info** (comportement dégradé acceptable mais opaque).

### 5.3 Inspecter (`inspecterModule.ts`)

- Chargement source : `ApiError` formatée avec code + message.
- Jobs : handlers avec `ApiError` ; poll : `catch { stopJobPoll() }` — **silencieux** si le backend tombe pendant le poll (le job peut sembler “bloqué” jusqu’au prochain refresh manuel).

### 5.4 Aligner (`alignerModule.ts`)

- Erreurs lancement / chargement : affichage `errorCode — message` pour `ApiError`.
- Préconditions : checklist structurée — **limite les erreurs “brutes”**.

### 5.5 Exporter (`exporterModule.ts`)

- `fetchConfig` pour le badge projet : `.catch(() => {})` — badge peut rester sur « … » sans erreur visible.
- ~~Exports / QA : gestion `ApiError` avec classes `exp-result err` ; **parfois seulement `e.message`** (sans `errorCode`) selon le handler — légère **incohérence** vs d’autres écrans.~~ ✅ Uniformisé via `formatApiError(e)` dans tous les handlers.

### 5.6 Constituer (`constituerModule.ts`)

- Très nombreux `try/catch` : majorité affiche `ApiError` avec ou sans `errorCode`.
- **Incohérences** :
  - certains blocs : `` `${e.errorCode} — ${e.message}` `` ;
  - d’autres : **`e.message` seul** (ex. segments traduction, personnages, batch erreurs localisées) ;
  - ~~**batch normaliser** (`#cons-batch-normalize`) : `String(e)` **sans** branche `ApiError` — peut masquer le code erreur.~~ ✅ Remplacé par `formatApiError(e)`.
- `fetchEpisodes().then(...).catch(() => {})` (peuplement sélecteur import) — **silencieux** : sélecteur vide sans message.

### 5.7 Panneau méta (`features/metaPanel.ts`)

- Peu de flux async ; erreurs limitées à l’usage appelant.

---

## 6. Incohérences de format des messages

| Pattern | Où |
|---------|-----|
| `` `${e.errorCode} — ${e.message}` `` | Inspecter, Aligner, nombreux blocs Constituer, Concordancier recherche, partie Exporter |
| `e.message` seul | Plusieurs handlers Exporter, Constituer (feedback court), QA JSON |
| `String(e)` | Batch normalize Constituer, certains catch génériques |

**Recommandation** : une petite fonction utilitaire `formatApiUserMessage(e: unknown): string` pour uniformiser (code + message pour `ApiError`, message générique pour `SyntaxError` / réseau).

---

## 7. État backend “hors ligne”

- **Constituer** : si offline au mount, message explicite dans la liste épisodes + instruction `uvicorn` — **bon modèle**.
- D’autres modules : dépendent surtout du point API du shell et de toasts ; pas tous affichent un état vide explicite au premier rendu.

---

## 8. Anti-patterns / dette

1. **`.catch(() => {})`** — masque les causes (Exporter badge, Constituer import select, Hub config/KPIs partiels).
2. **`initShell().catch(console.error)`** — échec quasi invisible pour l’utilisateur.
3. **Pas de centralisation** des erreurs UI (toast global optionnel pour erreurs API récurrentes).
4. **`JSON.parse` non protégé** sur le chemin succès — fragilité si l’API dévie.
5. **Dispose Concordancier** : `_unsubscribe = ctx.onStatusChange(() => {})` — callback vide (pas une “erreur”, mais **perte d’opportunité** de réagir au retour online).

---

## 9. Points positifs à conserver

- **`ApiError`** structuré avec `status` et `errorCode`.
- **`guards.ts`** + **`formatJobError`** pour lisibilité métier.
- **Tokens anti-course** : `_searchToken` (Concordancier), `_loadToken` (Inspecter) limitent affichage de données obsolètes.
- **Shell** : feedback réseau périodique et toasts projet.

---

## 10. Recommandations prioritaires

1. Envelopper ou garde-fou autour de **`JSON.parse`** après succès HTTP (try/catch → erreur typée / message “Réponse invalide”).
2. Remplacer les **silences** les plus gênants par au moins un **hint UI** (badge projet Exporter, sélecteur import Constituer, config Hub) ou un log structuré.
3. ~~**Uniformiser** l’affichage `ApiError` (petit helper `formatApiUserMessage(e)`).~~ ✅ `formatApiError(e: unknown): string` ajouté dans `src/api.ts` ; appliqué à Exporter (8 handlers) et Constituer batch normalize.
4. **Poll jobs Inspecter** : en cas d’échec réseau, message court ou reprise après `onStatusChange`.
5. Documenter dans le code les **dégradations silencieuses** (facettes Concordancier en repli client).
6. **`initShell().catch(console.error)`** : ajouter un fallback UI (toast ou bannière) si le shell ne monte pas.

---

## 11. Fichiers de référence

| Fichier | Rôle erreurs |
|---------|----------------|
| `src/api.ts` | `ApiError`, `_loopbackFetch`, parse réponses |
| `src/guards.ts` | Gardes, `guardedAction`, `formatJobError` |
| `src/main.ts` | Startup, health, init shell |
| `src/shell.ts` | Health poll, changement projet |
| `src/modules/*.ts` | Catch locaux, silences, affichage |

---

*Fin du document.*
