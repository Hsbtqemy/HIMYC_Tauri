# Audit — Éléments non branchés ou partiellement branchés (HIMYC)

**Objectif** : inventaire pour **plan d’action** — en distinguant d’abord ce qui est **volontaire**, ce qui est **dette à corriger**, et ce qui est **fonctionnellement manquant**.  
**Périmètre** : frontend **HIMYC_Tauri** (`src/`) + points de jonction **backend HIMYC** lorsque pertinent.  
**Date** : mars 2026.

---

## 0. Méthode : avant le plan d’action

Pour chaque point, se demander :

| Question | Si oui → |
|----------|----------|
| C’est un **choix produit** documenté (ex. toujours lander sur le Hub) ? | **Pas** un « bug de branchement » : classer **intentionnel** ; l’action éventuelle est **doc + nettoyage** (éviter code mort ou messages trompeurs). |
| Le code **contredit** la doc, l’UI ou l’usage réel ? | **Dette** : corriger textes, commentaires, ou supprimer une écriture inutile. |
| La fonctionnalité **n’existe pas** pour l’utilisateur ? | **Manque** : concevoir / implémenter (ex. Distribution, metaPanel utilisable). |

---

## Légende (statuts techniques)

| Statut | Signification |
|--------|----------------|
| **Mort shell** | Code présent mais aucune entrée depuis `shell.ts`. |
| **Orphelin** | Import uniquement depuis du code mort ou quasi. |
| **Écriture sans usage** | Variable persistée ou API peu utilisée — à distinguer **intentionnel** vs **résidu**. |
| **Hors Tauri** | Utilisé ailleurs (ex. UI PyQt), pas le shell web. |

---

## 1. Démarrage sur le Hub — **intentionnel**

| Fait | Interprétation |
|------|----------------|
| `initShell` **force toujours le Hub** (`shell.ts`). | **Choix produit** : à l’ouverture de l’app, l’utilisateur **arrive sur le Hub**. |
| Ancienne clé `himyc_last_mode` | **Écriture supprimée** (mars 2026) — plus de persistance du mode côté shell ; cohérent avec le point ci-dessus. |

Les tests E2E naviguent via la **sidebar** (`[data-mode="…"]`), sans rechargement fondé sur une clé locale.

---

## 2. Modules shell — navigation

| Élément | Fichier(s) | Statut technique | Nécessité / nature |
|---------|------------|------------------|-------------------|
| ~~**Inspecter**~~ | ~~`inspecterModule.ts`~~ | **Supprimé** (mars 2026) | Remplacé par **Curation** + **Distribution** dans Constituer → Actions. |
| **Aligner** | `alignerModule.ts` | Branché | **Nécessaire** au flux actuel. |
| **Hub, Concordancier, Constituer, Exporter** | — | Branchés | **Nécessaires**. |

---

## 3. Features — metaPanel

| Élément | Statut technique | Nécessité |
|---------|------------------|-----------|
| **metaPanel** | **Branché** depuis le **Concordancier** (mars 2026 — bouton ℹ sur les hits). |
| **copyUtils** | Chaîne avec metaPanel | Idem. |

---

## 4. `ShellContext` — commentaires

| Élément | Nature |
|---------|--------|
| Commentaires handoff | Vérifier qu’ils décrivent **Constituer → Aligner** (plus de référence à un mode Inspecter). |

---

## 5. Assignations personnage ↔ réplique

| Élément | Nature |
|---------|--------|
| Pas d’UI riche de création d’assignations par segment | **Manque fonctionnel** (Distribution / KWIC / etc.) — **pas** un simple détail de branchement si le produit l’exige. |
| Libellés obsolètes (anciens textes Inspecter) | **Dette** si encore présents — à aligner sur Curation / Concordancier. |
| `POST /assignments/auto` | **Branché** — **nécessaire** au flux actuel. |

---

## 6. Backend — `regroup_utterance_rows_by_character`

| Élément | Nature |
|---------|--------|
| Présent dans preparer PyQt, absent du job `segment_transcript` | **Écart de couverture** : le job Tauri **ne fait pas** ce regroupement — **manque** seulement **si** le produit Distribution + utterance par personnage est retenu ; sinon **hors scope** du shell actuel. |

---

## 7. Textes / guards (historique)

| Fichier | Nature |
|---------|--------|
| `guards.ts` | ~~Messages « Inspecter »~~ — corrigés en phase A (mars 2026). |
| `docs/AUDIT_UI_2026-03.md` | Aligné sur Curation + Distribution. |

---

## 8. Synthèse — classification pour plan d’action

| Sujet | Intentionnel / volontaire | Dette (corriger) | Manque (livrer) |
|-------|----------------------------|------------------|-----------------|
| Hub à chaque ouverture | **Oui** | — (écriture `himyc_last_mode` retirée) | — |
| ~~Inspecter~~ | Supprimé (mars 2026) | — | — |
| ~~metaPanel inaccessible~~ | — | Branché Concordancier (mars 2026) | — |
| Assignations : textes faux | — | Libellés Personnages | UI Distribution / KWIC si roadmap |
| Segmentation par personnage (backend) | — | — | Si Distribution retenu : job / pipeline |
| `himyc_last_mode` | Supprimé côté shell (plus d’écriture) | — | — |

---

## 9. Plan d’action suggéré (après cette lecture)

### Phase A — Sans ambiguïté (dette)

1. ~~Corriger **guards** + **libellés Personnages** + **AUDIT_UI** + commentaires **context / shell** ; suppression **`himyc_last_mode`**.~~ ✅ (mars 2026)

### Phase B — Décision produit puis code

3. **metaPanel** : ~~usage depuis Concordancier~~ ✅ (mars 2026 — bouton ℹ sur les hits).
4. ~~**Inspecter**~~ : module **supprimé** (mars 2026) — flux couvert par Curation + Distribution.

### Phase C — Fonctionnel nouveau (roadmap)

5. **Distribution** + éventuel **pipeline** `regroup_*` / segmentation utterance — **si** validé produit.

---

## 10. Index des fichiers concernés

| Fichier | Rôle dans l’audit |
|---------|-------------------|
| `src/shell.ts` | Hub forcé à l’init ; pas de persistance du mode |
| `src/context.ts` | Commentaires handoff |
| ~~`inspecterModule.ts`~~ | Supprimé |
| `src/features/metaPanel.ts` | Concordancier (ℹ hits) |
| `src/ui/copyUtils.ts` | Chaîne metaPanel |
| `src/guards.ts` | Alignés phase A |
| `src/modules/concordancierModule.ts` | Pas d’assignations dans l’UI recherche |
| `docs/AUDIT_UI_2026-03.md` | Aligné Curation + Distribution |

---

*Fin du document.*
