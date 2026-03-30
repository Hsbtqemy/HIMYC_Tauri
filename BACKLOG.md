# BACKLOG — HIMYC_Tauri

Idées documentées en attente d'implémentation, classées par priorité.

---

## [UX] Unification Locuteur / Personnage

**Priorité** : Basse — polish UX post-stabilisation fonctionnelle
**Effort estimé** : 2–3 sessions

### Contexte

Actuellement, deux couches coexistent dans le pipeline :

| Couche | Champ | Stockage | Rôle |
|---|---|---|---|
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

### Proposition

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
|---|---|
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

### Contexte

Les transcripts peuvent contenir des `\n` littéraux ou des sauts de ligne réels dans les blocs de dialogue. Actuellement la curation ne les signale pas et l'utilisateur n'a pas de contrôle sur leur traitement.

### Proposition

- Détecter les `\n` dans les segments en curation et les mettre en évidence
- Proposer des options par segment ou globalement :
  - Conserver le saut de ligne tel quel
  - Supprimer
  - Remplacer par un espace

---

## [Pipeline] Vérifier le périmètre de "Normaliser tout"

**Priorité** : Haute — risque de comportement inattendu
**Effort estimé** : 0.5 session (investigation + fix si besoin)

### Questions à trancher

- "Normaliser tout" s'applique-t-il uniquement aux transcripts (`raw.txt`) ?
- Ou aussi aux pistes SRT (`srt_<lang>`) ?
- Toutes les couches (utterances, sentences) sont-elles concernées ?
- Le comportement est-il cohérent entre le lancement épisode par épisode et le batch ?

---

## [Pipeline] Import d'un transcript dans une langue non-EN (ex. FR parent)

**Priorité** : Moyenne
**Effort estimé** : 1–2 sessions

### Contexte

Actuellement le transcript principal est implicitement EN (langue pivot). Un utilisateur avec un corpus francophone voudrait importer un transcript FR comme source principale, sans qu'il soit traité comme une traduction d'un pivot EN.

### Questions à trancher

- Permettre un transcript FR comme source `transcript` (sans pivot EN) ?
- Ou introduire une notion de "transcript enfant" d'un transcript FR ?
- Impact sur l'alignement (qui suppose un pivot EN pour les cues) et le concordancier

---

## [Export] Nouveaux formats et export de segmentation

**Priorité** : Moyenne
**Effort estimé** : 2–3 sessions

### Formats à ajouter

- **TXT** — texte brut (segments concaténés, un par ligne ou avec séparateurs)
- **SRT** — export des segments comme piste de sous-titres (si timecodes disponibles)
- **DOCX** — document Word (déjà partiellement supporté — vérifier la couverture)
- **ODT** — document OpenDocument

### À vérifier

- Export de la **segmentation** (liste des segments avec speaker, timecodes, texte) en tant qu'export dédié, distinct de l'export corpus

---

## [Concordancier] Vérification robustesse — NO_DB et corpus introuvable

**Priorité** : Haute — potentiel bug utilisateur silencieux
**Effort estimé** : 0.5–1 session (investigation)

### Scénarios à tester

- Lancer une recherche KWIC sans `corpus.db` → comportement attendu vs observé
- Lancer une recherche avec un corpus vide (indexé mais sans segments)
- Vérifier que `withNoDbRecovery` est bien déclenché dans tous les chemins du concordancier
- Vérifier les messages d'erreur affichés dans chaque cas

---

## [Concordancier] Clarifier ce que réindexe la réindexation FTS

**Priorité** : Moyenne
**Effort estimé** : 0.5 session (investigation + documentation)

### Questions à trancher

- `POST /project/rebuild_segments_fts` : réindexe-t-il uniquement les segments normalisés (`clean`) ?
- Ou aussi les segments associés à des pistes alignées ?
- Que se passe-t-il si certains épisodes sont segmentés et d'autres non ?
- Documenter clairement dans l'UI quel contenu est indexé (et lequel ne l'est pas)

---

## [Fonctionnalité] Module "Convention" — système de notation et transcription

**Priorité** : Basse — fonctionnalité avancée post-stabilisation
**Effort estimé** : 3–5 sessions

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

*Items ajoutés le 2026-03-30*
