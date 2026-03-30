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
