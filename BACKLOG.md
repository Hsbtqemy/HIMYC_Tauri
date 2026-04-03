# BACKLOG — HIMYC_Tauri

Idées documentées en attente d'implémentation, classées par priorité.

**Dernière revue du backlog** : 2026-04-04 (alignement : détail SRT / segmentation / concordancier / évaluation).

---

## Vue d'ensemble

| Thème | Statut | Commentaire court |
|--------|--------|-------------------|
| [Pipeline] Périmètre « Normaliser tout » | **Clarifié** | Comportement identifiable dans le code ; tests utilisateur / doc UI encore utiles. |
| [Concordancier] NO_DB | **Traité (tests + coverage étendue)** | Recovery étendu aux stats (`/stats/lexical`, `/stats/compare`) + tests backend/frontend des cas limites. |
| [Concordancier] Réindexation FTS | **Clarifié côté backend** | Docstring `CorpusDB.rebuild_segments_fts` ; aide inline module concordancier encore perfectible. |
| [Export] Formats | **Partiel** | Corpus/segments : TXT, CSV, TSV, JSON, JSONL, DOCX exposés ; SRT « type segments » pas branché sur `POST /export` (fonction `export_segments_srt_like` existe, usage surtout legacy Qt). |
| [Documents/Corpus] Colonnes fichiers | **À faire** | La vue doit expliciter tous les artefacts (raw/clean/segments/SRT/cues/DB), pas seulement un résumé partiel. |
| [Curation] Sauts de ligne `\n` | **Partiellement traité** | Détection et actions globales en mode édition (détecter, remplacer par espace, supprimer). |
| [Pipeline] Transcript non-EN | **À faire** | Périmètre produit à trancher. |
| [Alignement] Texte d’abord (type Agrafes), temps ensuite (cues) | **À faire** | 2 couches ; SRT = **texte + timecodes** (pas « segmenter par cue » pour l’analyse) ; segmentation **phrase / utterance** comme le transcript ; concordancier = comparer les **textes** ; ordre d’import flexible — voir section dédiée. |
| [UX] Locuteur / Personnage | **À faire** | Polish post-stabilisation. |
| [Convention] Module notation | **À faire** | Fonctionnalité avancée. |

---

## [UX] Unification Locuteur / Personnage

**Priorité** : Basse — polish UX post-stabilisation fonctionnelle  
**Effort estimé** : 2–3 sessions  
**Statut** : **Ouvert**

### Contexte

Actuellement, deux couches coexistent dans le pipeline :

| Couche | Champ | Stockage | Rôle |
|--------|-------|----------|------|
| Locuteur brut | `speaker_explicit` | Colonne SQLite `segments` + FTS | Détecté par le segmenteur depuis le texte (`MONICA:`) |
| Personnage catalogue | `character_id` | `character_assignments.json` | Identifiant stable, multilingue, avec alias |

Ces deux couches se rejoignent via `propagate_characters` : après propagation, `speaker_explicit` prend la valeur du nom canonique du catalogue. Avant propagation, elles sont indépendantes.

Le pipeline complet pour aller du transcript à un concordancier avec noms corrects est actuellement :

1. Segmenter → `speaker_explicit` détecté sur utterances + sentences (propagé depuis les utterances)
2. Définir le catalogue personnages (formulaire dédié)
3. Lancer `assignments/auto` → crée les liens `segment_id → character_id`
4. Vérifier les `unmatched_labels`
5. Propager (`propagate_characters`) → `speaker_explicit` = nom canonique
6. (Path B) Dériver les tours (`derive_utterances`) → nouvelles utterances par locuteur
7. (Re)aligner

Soit **5–7 étapes cognitives** pour l'utilisateur qui veut juste "qui dit quoi".

### Implémenté (phase 1)

- En mode édition transcript (Curation), affichage d’un compteur `\n` littéraux détectés.
- Actions rapides globales ajoutées :
  - Détecter
  - Remplacer tous les `\n` par un espace
  - Supprimer tous les `\n`

### Proposition (compléments possibles)

Unifier la surface UX en une seule notion **"Locuteur"** visible par l'utilisateur :

- Une liste des locuteurs détectés par épisode, éditable
- Auto-complétion sur le catalogue existant (typer `"Mon"` → suggère `"Monica Geller"`)
- Validation → déclenche `assignments/auto` + `propagate_characters` en arrière-plan
- Le catalogue reste géré en coulisse mais reste accessible en mode avancé

**Surface UX cible** (3 étapes) :

```
Segmenter → Vérifier/corriger les "Locuteurs" (liste éditable) → Valider
```

### Pourquoi garder les deux couches en interne

La fusion en code n'est **pas recommandée** — les deux couches résolvent des problèmes orthogonaux :

- `speaker_explicit` doit être du texte naturel pour SQLite FTS (concordancier)
- `character_id` doit être un identifiant stable pour la cohérence cross-épisodes
- `names_by_lang` dans le catalogue permet des noms différents par langue dans les SRTs exportés
- Les alias (`"MONICA"`, `"Mon"`, `"Geller"`) permettent la normalisation depuis plusieurs transcripts

### Ce que ça ne résoudra pas

La détection automatique reste limitée aux transcripts avec marqueurs `NOM:` bien formés. Pour les transcripts non structurés, une intervention humaine segment par segment reste nécessaire quelle que soit l'interface.

### Prérequis avant d'implémenter

- Pipeline complet (import → segment → distribuer → aligner → concordancier) stable et testé sur de vrais transcripts
- Retour utilisateur réel sur les points de friction (peut être différent de ce qu'on anticipe)

### Travail estimé

| Composant | Effort |
|-----------|--------|
| Vue "Locuteurs" fusionnée (segments + catalogue) | Moyen |
| Auto-complétion avec fuzzy match sur catalogue | Faible |
| Déclenchement automatique assign + propagate | Faible |
| Gestion des conflits (renommage d'un personnage déjà propagé) | Moyen |
| Migration / rétrocompat avec projets existants | Faible |

---

*Ajouté le 2026-03-30 — suite à la discussion sur la dualité speaker_explicit / character_id*

---

## [Curation] Repérage et gestion des sauts de ligne (`\n`)

**Priorité** : Moyenne  
**Effort estimé** : 1 session  
**Statut** : **Partiellement traité** (2026-04)

### Contexte

Les transcripts peuvent contenir des `\n` littéraux ou des sauts de ligne réels dans les blocs de dialogue. Actuellement la curation ne les signale pas et l'utilisateur n'a pas de contrôle sur leur traitement.

### Implémenté (phase 1)

- En mode édition transcript (Curation), détection des `\n` littéraux avec compteur.
- Actions globales rapides :
  - Remplacer tous les `\n` littéraux par un espace
  - Supprimer tous les `\n` littéraux
  - Remplacer tous les sauts de ligne réels par un espace
  - Supprimer tous les sauts de ligne réels

### Proposition (compléments possibles)

- Détecter les `\n` dans les segments en curation et les mettre en évidence
- Proposer des options par segment ou globalement :
  - Conserver le saut de ligne tel quel
  - Supprimer
  - Remplacer par un espace

---

## [Pipeline] Vérifier le périmètre de "Normaliser tout"

**Priorité** : Haute — risque de comportement inattendu  
**Effort estimé** : 0.5 session (investigation + fix si besoin)  
**Statut** : **Clarifié en code (2026-04)** — validation manuelle / message UI optionnel

### Ce que fait le code aujourd'hui

- **Hub Constituer — normalisation par lot** (`queueBatchNormalize` dans `constituerModule.ts`) : ne crée que des jobs `normalize_transcript` sur la source `transcript` (`raw.txt` → `clean.txt`). Les pistes `srt_<lang>` ne sont **pas** incluses dans ce lot.
- **Jobs** (`jobs.py`) : `normalize_transcript` et `normalize_srt` sont des types **distincts** ; la normalisation SRT suppose une piste importée et une `corpus.db` existante.
- Les couches utterances / sentences ne sont pas « normalisées » séparément : elles découlent de l’étape **segmentation** après `clean.txt`.

### Reste éventuel

- Libellé ou infobulle dans l’UI précisant que « normaliser tout » = transcripts uniquement (si les retours utilisateurs prêtent à confusion).
- Vérifier la parité exacte entre normalisation épisode par épisode et lot (comportement attendu : même job `normalize_transcript`).

---

## [Pipeline] Import d'un transcript dans une langue non-EN (ex. FR parent)

**Priorité** : Moyenne  
**Effort estimé** : 1–2 sessions  
**Statut** : **Ouvert**

### Contexte

Actuellement le transcript principal est implicitement EN (langue pivot). Un utilisateur avec un corpus francophone voudrait importer un transcript FR comme source principale, sans qu'il soit traité comme une traduction d'un pivot EN.

### Questions à trancher

- Permettre un transcript FR comme source `transcript` (sans pivot EN) ?
- Ou introduire une notion de "transcript enfant" d'un transcript FR ?
- Impact sur l'alignement (qui suppose un pivot EN pour les cues) et le concordancier

---

## [Alignement] Corpus bilingue : transcript ↔ transcript (sans SRT)

**Titre court backlog** : alignement **texte d’abord (type Agrafes), temps ensuite (cues)** — inclut le cas sans SRT et l’**architecture deux couches** même avec SRT (voir ci‑dessous).

**Priorité** : Moyenne à haute — dépend de la roadmap produit (corpus bilingue sans sous-titres)  
**Effort estimé** : **Large** — plusieurs sessions (schéma + pipeline + UI + tests)  
**Statut** : **Ouvert**

### Contexte

Le pipeline actuel HIMYC est optimisé pour :

- **Segmentation** du texte normalisé → `segments` (`sentence` / `utterance`) avec `start_char` / `end_char` ;
- **Alignement** **segment ↔ cue** (sous-titre pivot) puis **cue ↔ cue** entre langues, les **cues** portant le **temps vidéo** (`start_ms` / `end_ms`).

Pour un usage où l’on veut aligner **deux transcripts** (ex. FR et EN) **sans** fichiers SRT, **il n’y a pas de couche temporelle**. Le problème devient : **mettre en correspondance des unités de texte entre langues**, pas ancrer le dialogue sur la timeline. C’est un **autre problème d’alignement** que segment↔cue.

### Vision produit : deux couches (y compris lorsque des SRT existent)

On peut aller **plus loin** que « transcript–transcript sans SRT » : traiter le corpus **d’abord** selon un **modèle segmentation / alignement de type Agrafes** (unités de **texte** parallèles, stratégies id / position / similarité), **puis** appliquer une **deuxième couche** d’alignement ou de **projection temporelle** via les **cues** lorsque des sous-titres sont disponibles.

| Couche | Rôle | Entrées typiques |
|--------|------|------------------|
| **1 — Texte (type Agrafes)** | Mettre en correspondance des **segments** (ou unités dérivées) entre **transcripts** et/ou entre **textes de cues** sans présumer la timeline comme primitive | Deux langues de dialogue, marqueurs `[n]`, rang, similarité ; optionnellement **texte issu des cues** (ligne de sous-titre) comme colonne « parallèle » |
| **2 — Temps (cues)** | Ancrer les unités texte sur **l’horloge média** : liens **segment ↔ cue**, **cue ↔ cue**, fenêtres `start_ms` / `end_ms`, retarget | Fichiers SRT/VTT importés ; nécessaire pour export timecodé, contrôle qualité « à l’image », futur **son / vidéo** |

**Intérêt** : (1) un **socle commun** pour corpus **avec ou sans** SRT (même logique métier pour l’alignement **linguistique**) ; (2) la couche 2 **enrichit** la couche 1 avec le temps — ce qui ouvre la **propagation** d’informations temporelles vers le transcript (ex. bornes dérivées des cues liées) et, plus tard, un alignement **média** (forced alignment, lecteur audio/vidéo) **sans** confondre dès le départ « alignement de textes » et « alignement sur la timeline ».

**Ordre opérationnel envisagé (pipeline / jobs)** : exécuter ou maintenir la **couche 1** (liens texte↔texte stables), puis lancer ou raffiner la **couche 2** quand les cues existent (recalcul partiel, seuils, audit des écarts texte vs sous-titre). *Ce n’est pas la même chose que* l’ordre dans lequel l’utilisateur importe les fichiers — voir ci‑dessous.

Cette vision **ne supprime pas** l’import SRT : les cues restent la source **native** du temps ; elle **reordonne** la pensée produit : **d’abord** le parallélisme textuel (comme Agrafes), **ensuite** l’ancrage temporel et les usages son/vidéo.

### SRT et transcript : traiter les sous-titres comme du texte, le temps en plus

- **À l’import** : un fichier SRT/VTT est parsé en **cues** en base (fidélité au fichier : intervalles `start_ms`–`end_ms` + `text_raw` / `text_clean`). Ce sont des **unités de fichier**, pas encore la **segmentation d’analyse** (phrase / utterance) du projet.
- **Vision corpus** : pour alignement et recherche, une piste sous-titre doit être pensée comme **du texte** au même titre qu’un transcript, avec une **donnée supplémentaire** : les timecodes par cue. Les cues **portent** la timeline ; elles ne remplacent pas la grille linguistique choisie pour le transcript.
- **Objectif** : comparer et aligner des **contenus textuels** entre langues ; le temps sert ensuite à **propager** des bornes vers le transcript, à l’export, au contrôle « à l’image », et à une future couche **son / vidéo** — **sans** que la première étape soit réduite à « coller des segments sur la timeline ».

### Segmentation : pas « une cue = une unité d’analyse »

- **Piège à éviter** : identifier **cue** et **phrase** ou **tour de parole**. Une cue peut contenir **plusieurs** phrases ou couper une réplique ; imposer « 1 cue = 1 segment » fausserait le travail sur les **locuteurs** et le **concordancier**.
- **Cible** : appliquer la **même logique de segmentation** que sur le transcript — **phrases** (`sentence`) et **utterances** (tours de parole, personnages) — sur le **texte issu des sous-titres** (re-découpe, ou segments dérivés puis **liés** aux cues pour la projection temporelle).
- **Implémentation typique** : conserver les **cues** comme vérité **fichier / timeline** ; produire des **segments d’analyse** (même `kind` que le transcript quand c’est possible) et des **liens** segment↔cue (ou règles de fusion de fenêtres temporelles) pour dériver des bornes sans confondre granularités.

### Ordre d’import (SRT avant ou après le transcript)

- L’**ordre des imports** ne doit **pas** obliger l’utilisateur à une séquence cognitive rigide. Importer le **SRT avant** le transcript ne signifie pas « aligner le sous-titre pour lui-même » comme étape finale : on dispose de **cues** (texte + temps) ; le transcript arrive ensuite, est normalisé et segmenté ; les **jobs** et liens **reconstituent** la cohérence (texte↔texte, puis segment↔cue).
- **Messages / assistant** : rendre explicite que l’**état visé** est : sources présentes, **segmentation d’analyse** alignée sur les règles du projet, **liens** entre couches — plutôt qu’un ordre d’import unique « correct ».

### Concordancier (usage principal dans cette vision)

- **Priorité produit** : interroger et comparer des **textes** (scopes segments / sous-titres / documents selon l’API) — c’est le cœur de l’usage **sans** exiger que l’utilisateur raisonne d’abord en timecodes.
- Les **timecodes** enrichissent les cas d’usage (contexte média, exports, QA alignement) ; ils ne sont pas le prérequis pour une **recherche bilingue** « texte vs texte ».

### Référence méthodologique (projet AGRAFES)

Le dépôt **AGRAFES** (`multicorpus_engine`) traite ce cas avec des **stratégies explicites** sur des unités `line` (documents parallèles) :

| Stratégie | Quand l’utiliser | Idée |
|-----------|------------------|------|
| **`external_id`** | Les deux côtés partagent un **identifiant de ligne** (import TEI, numérotation commune) | Jointure par clé ; rapport de couverture, manquants, doublons |
| **`external_id_then_position`** | Identifiants partiels | Compléter par **rang** `n` pour les lignes restantes |
| **`position`** | Même **nombre** et **ordre** de blocs (ex. paragraphes alignés) | Ligne `n` pivot ↔ ligne `n` cible |
| **`similarity`** | Pas d’identifiant, coupures différentes | Pour chaque unité pivot (dans l’ordre), meilleure unité cible **non encore utilisée** si similarité (ex. Levenshtein normalisée) ≥ **seuil** |

Fichiers de référence : `AGRAFES-1/src/multicorpus_engine/aligner.py`, `segmenter.py` ; décisions ADR dans `docs/DECISIONS.md` (ex. ADR-007, ADR-013, ADR-018).

**À emprunter à AGRAFES** (comportements, pas copie aveugle du schéma SQLite) :

- Choix ou enchaînement de **stratégies** selon le signal disponible ;
- **Rapports** type couverture %, listes `missing_in_target` / `missing_in_pivot`, avertissements sur **doublons** d’identifiants ;
- **Paires protégées** : ne pas écraser des liens validés manuellement lors d’un recalcul ;
- **Segmentation** : packs `fr_strict` / `en_strict`, protection d’abréviations, option **marqueurs `[N]`** dans le texte pour ancrage explicite — voir benchmarks `SEGMENTATION_BENCHMARKS.md`.

### Ce que HIMYC devrait faire (cible)

1. **Modèle de données**  
   - Représenter des liens **segment (langue A) ↔ segment (langue B)** pour un même épisode (ou équivalent), distincts des liens **segment ↔ cue** existants (`align_links` actuels).  
   - Trancher : nouvelle table / nouveau `role` / `meta_json` + contraintes d’unicité — **décision schéma** à documenter dans un ADR ou ticket technique.

2. **Pipeline / jobs**  
   - Job du type `align_transcripts` ou extension contrôlée du run d’alignement avec `strategy: external_id | position | similarity | …` et paramètres (`threshold`, langues source/cible).  
   - Entrées : deux jeux de segments déjà produits (deux transcripts importés + normalisés + segmentés pour l’épisode).

3. **Pistes SRT dans la même logique**  
   - Normalisation / segmentation **d’analyse** sur le texte des cues (ou chaîne dérivée) avec **mêmes règles** que le transcript quand c’est le produit visé (phrase / utterance).  
   - Distinction **cues** (vérité fichier + temps) vs **segments** (unités concordancier / locuteurs) documentée dans le code et l’UI produit.

4. **UI**  
   - Point d’entrée dans **Constituer → Alignement** (ou flux dédié) : choix des langues / sources transcript, stratégie, seuil, lancement, suivi job.  
   - **Audit** : liste des liens, filtres, retarget si besoin (équivalent fonctionnel de l’audit actuel mais sur liens segment↔segment).  
   - Cohérence avec l’entrée **[Pipeline] Import transcript non-EN** (pivot FR, deux transcripts, etc.).

5. **Qualité**  
   - Jeux de tests / petits corpus de référence pour éviter les régressions (inspiré des bancs AGRAFES).  
   - Documenter les limites de la stratégie **similarity** (greedy, pas de réordonnancement global).

### Prérequis produit / technique

- Pour la **couche 1** (texte↔texte) : deux flux de **segments** comparables (deux transcripts, ou **règles explicites** pour aligner texte transcript ↔ texte dérivé des sous-titres).  
- **Segmentation** à jour des deux côtés (même `kind` pour une stratégie `position` cohérente, ou règles documentées si `sentence` vs `utterance` diffèrent).  
- La **couche 1** ne **requiert pas** de SRT : pas de temps vidéo requis pour établir des liens purement textuels.  
- La **couche 2** **requiert** des cues importées pour l’ancrage temporel et la propagation.

### Critères d’acceptation (brouillon)

- L’utilisateur peut lancer un alignement **FR ↔ EN** (ou autre paire) **sans** importer de SRT.  
- Au moins une stratégie **position** et une **similarity** (avec seuil) sont disponibles, ou équivalent documenté.  
- Les liens créés sont persistés et exploitables (export, concordancier parallèle, audit).  
- Un rapport ou écran indique **couverture** et **lignes non alignées** sans deviner dans les logs.  
- La doc produit / l’UI ne suggèrent pas que **1 cue = 1 phrase** pour l’analyse linguistique.

### Évaluation (risques et critères de succès)

| Forces | Risques |
|--------|---------|
| Séparation nette **linguistique** vs **temporel** ; socle unique avec ou sans SRT ; alignement avec AGRAFES pour le texte. | **Complexité** : deux couches, deux familles de liens, risque de confusion utilisateur si mal nommées. |
| SRT = texte + temps ; concordancier centré **texte** reste l’usage principal clair. | **Doublons** ou **conflits** entre liens couche 1 et segment↔cue si les règles de priorité ne sont pas définies. |
| Ordre d’import flexible ; pas d’obligation « transcript avant SRT ». | **Coût d’implémentation** élevé (schéma, jobs, UI, tests). |

**Critères de succès** : l’utilisateur peut décrire le flux en une phrase (« j’aligne les textes, puis j’ancre le temps quand j’ai les sous-titres ») ; le concordancier reste **intuitif** pour la comparaison **textuelle** ; les exports / QA temporels **s’activent** quand les cues existent.

### Hors périmètre v1 (sauf décision contraire)

- Alignement automatique **audio** → texte (forced alignment) — peut s’appuyer sur la **couche 2** une fois les temps propagés ou les cues stabilisées.  
- **Refonte complète** du flux **segment ↔ cue** : en vision **2 couches**, il s’agit d’**articuler** couche texte et couche cues (pas de tout jeter d’un coup) ; le détail d’implémentation (job unique vs deux jobs, ordre forcé côté pipeline) reste à trancher.

### Liens avec d’autres items backlog

- **[Pipeline] Import d’un transcript dans une langue non-EN** : définit souvent **quels** transcripts existent pour un épisode ; ce ticket définit **comment** on les relie sans SRT et comment les **pistes textuelles** (y compris dérivées des SRT) s’insèrent dans la même logique.  
- **Documents / Corpus en colonnes** : visibilité des transcripts, des SRT, des cues, et de l’état d’alignement.  
- **[Concordancier]** : scopes segments / sous-titres / documents — cette vision renforce l’objectif **comparaison de textes** ; les timecodes restent un enrichissement, pas le cœur de la recherche par défaut.

---

*Ajouté le 2026-04-04 — synthèse discussion HIMYC × AGRAFES (segmentation / alignement texte-only). Mis à jour : vision **2 couches** ; détail **SRT = texte + temps**, segmentation **≠ cue**, **ordre d’import**, **concordancier**, **évaluation**.*

---

## [Export] Nouveaux formats et export de segmentation

**Priorité** : Moyenne  
**Effort estimé** : réduit pour TXT/DOCX ; SRT/ODT selon périmètre  
**Statut** : **Partiellement couvert**

### Déjà en place (Tauri + `POST /export`)

- Corpus : TXT, CSV, JSON, DOCX, JSONL (+ variantes JSONL corpus selon API).
- Segments : TXT, CSV, TSV, DOCX.
- Onglet **Exporter** : flux QA, alignements, SRT enrichi (propagation sur fichiers `.srt` du projet), personnages, assignations, jobs.

### Encore pertinents comme sujets

- **`export_segments_srt_like`** : implémenté dans `export_utils.py`, utilisé côté app Qt legacy ; **pas** exposé comme `fmt` dans `POST /export` pour `scope=segments`.
- **ODT en export** : non prévu (l’import `.odt` pour transcripts existe).
- **Clarté** : distinguer explicitement dans l’UI « export segmentation » vs « export corpus texte » si la confusion persiste.

---

## [Documents/Corpus] Rendre visibles les fichiers associés par colonnes

**Priorité** : Haute  
**Effort estimé** : 1 session (UI + mapping données)  
**Statut** : **Ouvert**

### Contexte

La vue Document / Corpus ne rend pas assez lisible l’ensemble des artefacts par épisode/source.
Le retour utilisateur est clair : éviter une lecture partielle du type "brut/cues" et afficher explicitement les fichiers réellement présents.

### Proposition de colonnes (base)

| Colonne | Source | Exemple | Objectif UX |
|---------|--------|---------|-------------|
| Épisode | `episode_id` | `S01E01` | Ancrage principal |
| Source | `source_key` | `transcript`, `srt_en` | Distinguer transcript/SRT |
| `raw.txt` | disque | Oui/Non | Voir le brut importé |
| `clean.txt` | disque | Oui/Non | Voir la normalisation disponible |
| `segments.jsonl` | disque | Oui/Non | Voir si segmentation export fichier existe |
| Segments DB | SQLite `segments` | `0`, `152` | Différencier fichier vs indexation DB |
| SRT fichier | disque | `srt_en.srt` / `srt_fr.vtt` | Visibilité piste sous-titres |
| Cues DB | SQLite `subtitle_cues` | `0`, `842` | Vérifier parsing/index cues |
| `corpus.db` | racine projet | Oui/Non | Comprendre l’état NO_DB |
| État | `state` + garde | `raw`, `normalized`, `segmented` | Actionnable rapidement |

### Détails utiles

- Afficher **fichier présent** et **compte DB** côte à côte pour éviter les faux positifs.
- Prévoir une vue compacte (badges Oui/Non) + infobulle détail (chemin/nb lignes/date mtime).
- Garder tri/filtre sur : source, état, fichiers manquants, incohérences (ex: `segments.jsonl` présent mais `segments` DB = 0).

### Critères d’acceptation

- Un utilisateur voit en un coup d’oeil tous les artefacts d’un épisode (fichiers + DB).
- Les cas incohérents ressortent visuellement sans ouvrir plusieurs modules.
- La colonne actuelle "brut/cues" devient un sous-ensemble explicite de cette matrice.

---

## [Concordancier] Vérification robustesse — NO_DB et corpus introuvable

**Priorité** : Haute — potentiel bug utilisateur silencieux  
**Effort estimé** : 0.5–1 session (tests / scénarios)  
**Statut** : **Traité (code + tests)**

### Déjà en place

- `withNoDbRecovery` utilisé pour `/query`, `/query/facets`, rapport QA, `rebuild_segments_fts` dans `concordancierModule.ts` (init paresseuse de `corpus.db` si absent).

### Validation effectuée

- Tests backend API ajoutés (`test_api_bridge.py`) :
  - `/query` sans DB → `NO_DB`
  - corpus vide (DB initialisée, 0 segment) → réponses vides cohérentes sur `/query` et `/query/facets`
  - chemins d’erreur (`EMPTY_TERM`, `INVALID_SCOPE`, `INVALID_KIND`) couverts
- Tests frontend ajoutés (`api.no-db-recovery.test.ts`) :
  - succès direct
  - `NO_DB` → `init_corpus_db` → retry
  - échec init → relance erreur originale
  - erreur non `NO_DB` non récupérée
  - échec du retry après init réussie propagé correctement
- Couverture module concordancier étendue : `withNoDbRecovery` appliqué aussi aux appels stats (`/stats/lexical`, `/stats/compare`).

---

## [Concordancier] Clarifier ce que réindexe la réindexation FTS

**Priorité** : Moyenne  
**Effort estimé** : faible (doc UI)  
**Statut** : **Clarifié côté backend** — optionnel côté UI

### Comportement actuel

- `POST /project/rebuild_segments_fts` appelle `CorpusDB.rebuild_segments_fts()` : **reconstruction FTS5 depuis la table `segments`** (commande `INSERT INTO segments_fts(segments_fts) VALUES('rebuild')`). Tout segment présent en base est réindexé ; pas de filtre « clean seulement » au-delà de ce qui est déjà stocké dans `segments`.

### Reste

- Texte d’aide dans le module concordancier (tooltip ou paragraphe) si les utilisateurs posent encore la question.

---

## [Fonctionnalité] Module "Convention" — système de notation et transcription

**Priorité** : Basse — fonctionnalité avancée post-stabilisation  
**Effort estimé** : 3–5 sessions  
**Statut** : **Ouvert**

### Contexte

Chaque projet de corpus peut avoir ses propres conventions de transcription : notation de l'hésitation, des chevauchements, des pauses, des éléments prosodiques, symboles spéciaux, abréviations, etc. (ex. protocole CHAT, Jefferson, conventions maison).

### Proposition

Un module ou panneau "Convention" permettant de :

- Définir un glossaire de symboles/notations propres au projet (ex. `(.)` = pause courte, `[...]` = chevauchement)
- Associer une description à chaque notation
- Potentiellement : utiliser ces conventions dans la normalisation (remplacement, signalement en curation)
- Exporter les conventions avec le corpus (pour la reproductibilité scientifique)

### Prérequis

- Retour utilisateur sur les conventions effectivement utilisées dans les projets réels
- Décision sur le périmètre : documentation seule, ou intégration dans le pipeline ?

---

*Items initiaux datés 2026-03-30 ; tableau de synthèse et statuts ajoutés le 2026-04-03 ; alignement transcript ↔ transcript ajouté le 2026-04-04.*
