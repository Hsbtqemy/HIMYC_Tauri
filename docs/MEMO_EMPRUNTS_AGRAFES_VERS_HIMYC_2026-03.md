# Mémo — Pistes d’emprunt AGRAFES → HIMYC

**Objet** : synthèse des éléments que le frontend **HIMYC Tauri** pourrait gagner en s’inspirant d’**AGRAFES** (shell, Prep, Concordancier).  
**Référence** : [comparaison HIMYC × AGRAFES](./AUDIT_COMPARAISON_HIMYC_AGRAFES_2026-03.md), audits écran par écran.  
**Date** : mars 2026.

---

## Contexte

AGRAFES et HIMYC partagent une logique shell + recherche + atelier corpus, mais diffèrent sur le **backend** (sidecar + SQLite vs FastAPI + dossier projet) et la **persistance de navigation**. Les idées ci-dessous sont **transposables en principe** ; l’implémentation doit respecter le modèle données HIMYC.

---

## Priorisation suggérée (impact / effort)

| Priorité | Élément | Intérêt pour HIMYC |
|----------|---------|-------------------|
| **P1** | Garde-fous avant navigation (onglets / modes avec travail non enregistré) | Réduit pertes de saisie dans Constituer. |
| **P1** | Raccourcis clavier + aide (liste type ⌘/ ou `?`) | Efficacité pour usage intensif. |
| **P1** | Option « reprendre le dernier mode » (ou équivalent) | Moins de friction si l’usage est surtout hors Hub. |
| **P2** | Deep-links / ouverture avec contexte (mode, requête préremplie) | Partage, scripts, onboarding. |
| **P2** | Bandeau ou rail **jobs** unifié | Visibilité des jobs dispersés aujourd’hui. |
| **P2** | Panneau métadonnées depuis le **Concordancier** (câbler `metaPanel`) | Parité UX avec AGRAFES sans tout « Inspecter ». |
| **P3** | Remplacement du conteneur `#app` au changement de mode | Robustesse si fuites DOM / listeners. |
| **P3** | Chargement dynamique des gros modules (chunks) | Perf si le bundle grossit. |
| **P3** | Presets utilisateur (exports, profils, vues) | Workflows répétitifs. |
| **P3** | MRU projets / derniers chemins | Accélère réouverture. |
| **P3** | Mode large en Curation (plus de largeur utile) | Confort lecture/édition. |
| **P3** | Onboarding avec préremplissage (sessionStorage) | Première recherche / premier import guidés. |

---

## Détail par thème

### Expérience utilisateur

- **Persistance du dernier mode** : AGRAFES restaure `lastMode` ; HIMYC démarre toujours sur le Hub — à proposer en **préférence** ou comportement par défaut.
- **Raccourcis** : modèle Meta/Ctrl + chiffres pour les modes principaux, + ouverture projet, + aide.
- **Confirmation de sortie** : aligné sur `_switchTab` + `hasPendingChanges` (Prep).
- **Deep-links** : ouvrir un mode ou préremplir une recherche (équivalent logique des schémas / query string AGRAFES).
- **Guidage** : tutoriel court avec préremplissage (comme `agrafes.explorer.prefill`).

### Robustesse & front

- **`_freshContainer()`** : nouveau nœud racine applicatif à chaque changement de mode pour limiter fuites.
- **Code splitting** : imports dynamiques des modules lourds + indicateur de chargement.

### Données & réglages

- **Presets** stockés localement (normalisation, exports récurrents).
- **Liste de projets récents** (MRU) en complément du sélecteur actuel.

### Fonctionnel

- **JobCenter** ou équivalent : une zone toujours visible pour l’état des jobs.
- **Meta panel** sur les hits du Concordancier : ~~code existant~~ branché (mars 2026 — bouton ℹ).

---

## Hors périmètre direct

Ne pas importer tel quel le modèle « fichier `.db` unique » ni les workflows **Publier TEI** : l’intérêt est dans les **patterns** (navigation, garde-fous, UX), pas dans un changement de stack données sans décision produit.

---

## Suite possible

- Traduire les **P1** en tickets (spec courte + critères d’acceptation).
- Valider avec une session **usage réel** (fréquence Hub vs modes métier).

---

*Mémo interne — pas de modification de code implicite.*
