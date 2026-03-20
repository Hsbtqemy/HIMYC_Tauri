# AUDIT_VISUEL_2026-03 — Interface HIMYC Tauri

Audit **visuel et design system** dérivé de l’analyse des feuilles de style injectées dans le code (`<style>` par module + `src/ui/dom.ts` + `src/shell.ts`).  
Complète la cartographie fonctionnelle : [AUDIT_UI_2026-03.md](./AUDIT_UI_2026-03.md).  
Erreurs / API / silences : [AUDIT_ERREURS_2026-03.md](./AUDIT_ERREURS_2026-03.md).

**Limite méthodologique** : pas de captures d’écran générées ici ; l’audit s’appuie sur les **tokens CSS réels** et les **patterns de classe**. Pour valider contrastes et rendu pixel-perfect, ouvrir l’app sur plusieurs modes (clair / système) et zoom 100 % / 125 %.

---

## 1. Fondations globales

### 1.1 `injectGlobalCss()` — `src/ui/dom.ts`

| Token | Valeur | Usage |
|--------|--------|--------|
| `--brand` | `#4361ee` | Boutons `.btn-primary`, focus outline, onglets Inspecter actifs |
| `--brand-dark` | `#3a56d4` | Hover primary |
| `--surface` | `#ffffff` | Cartes, champs |
| `--surface2` | `#f8f9fa` | Fonds alternés, `.exp-root`, barres secondaires |
| `--border` | `#dee2e6` | Bordures génériques |
| `--text` | `#212529` | Texte principal |
| `--text-muted` | `#6c757d` | Labels, hints |
| `--danger` | `#e63946` | Erreurs, `.btn-danger` |
| `--success` | `#2dc653` | Succès (global) |
| `--warning` | `#f4a261` | Pulse “starting” |
| `--radius` | `10px` | Rayon par défaut boutons / champs |
| `--shadow` | ombre légère | Cartes exporter, tuiles |

**Typographie** : `body` → `14px`, `system-ui` stack.  
**Boutons** : `.btn`, `.btn-sm` (padding + `0.78rem`), variantes primary / secondary / ghost / danger.  
**Focus** : `outline: 2px solid var(--brand)` — cohérent avec la marque globale, **pas** avec `--accent` du shell par mode.

### 1.2 Shell — `src/shell.ts` (`SHELL_CSS`)

| Variable | Rôle |
|----------|------|
| `--accent` | Couleur d’accent **contextuelle** (réécrite à chaque `navigateTo` selon le mode) |
| `--accent-header-bg` | Fond du header (teinte plus sombre que l’accent par mode) |

**Palette par mode** (extrait conceptuel — valeurs dans `MODE_ACCENT` / `MODE_ACCENT_HEADER`) :

| Mode | Accent (aperçu) | Ambiance |
|------|-------------------|----------|
| Hub | `#1a1a2e` | Navbar très sombre |
| Concordancier / Inspecter | `#2c5f9e` / header `#1e4a80` | Bleu outil |
| Constituer | `#1a7f4e` / `#145a38` | Vert corpus |
| Exporter | `#b45309` / `#92400e` | Ambre / export |
| Aligner | `#7c3aed` / `#4c1d95` | Violet pipeline |

**Header** : 44 px de hauteur fixe (`index.html`), onglets style “tabs” blanc sur fond `--accent-header-bg`, transitions 0,22 s sur le fond.

### 1.3 Page HTML — `index.html`

- `body` : fond `#f0f2f5`, texte `#1a1a2e` (légère incohérence avec `--text` `#212529` — deux “noirs” de marque).
- Zone `#app` : `padding-top: 44px`, `height: 100vh`, `overflow: hidden`.

---

## 2. ~~Problème de token : `--bg` non défini~~ ✅ Corrigé

**Périmètre réel** (4 usages, pas 2) : Hub root, Concordancier root, input recherche KWIC, input retarget Constituer. `constituerModule.ts` était aussi affecté — l’input `.retarget-search-bar` sans fallback ; la modale elle-même avait un fallback `#fff` (résiliente).

**Correction appliquée** (`src/ui/dom.ts` — `GLOBAL_CSS :root`) :
```css
--bg: var(--surface);
```
Toutes les zones obtiennent un blanc contrôlé (`#ffffff`) ; la modale Constituer conserve son fallback explicite.

---

## 3. Dualité « marque » vs « mode »

- Les **boutons primaires** reposent sur `--brand` (`#4361ee`).
- Les **indicateurs de mode** (hover tuile Hub sur `var(--accent)`, checkboxes Aligner `accent-color: var(--accent)`, onglets KWIC actifs en `--accent`) suivent la **couleur du mode courant**.

**Effet perçu** : en mode Constituer (vert), l’utilisateur voit un header vert mais des CTA encore bleu-violet **brand** — ce qui peut être voulu (identité stable) ou gênant (manque d’harmonie chromatique). À trancher côté produit : soit mapper `.btn-primary` à `--accent` par mode, soit documenter “chrome mode / actions globales”.

---

## 4. Audit par panneau et sous-vue

### 4.1 Hub (`hubModule.ts`)

| Aspect | Observation |
|--------|-------------|
| **Layout** | Centré vertical, tuiles ~200 px, `gap` généreux, look “landing”. |
| **Tuiles** | `var(--surface)`, bordure `var(--border)`, hover : bordure **`var(--accent)`** + ombre + léger `translateY`. |
| **Typo** | Titre `1.6rem` bold ; descriptions `0.88rem` / `0.78rem` muted. |
| **KPI strip** | Petites cartes monospace sur chiffres ; gate QA avec pastilles sémantiques (vert / ambre / rouge). |
| **Onboarding** | Carte vert menthe `#f0fdf4` / bordure `#86efac` — **palette à part** des tokens globaux (cohérent sémantiquement “succès / démarrage”). |
| **Fond** | `var(--bg)` → voir §2. |

**Lecture visuelle** : aéré, peu dense, emoji comme pictogrammes (dépendance au rendu OS).

---

### 4.2 Concordancier (`concordancierModule.ts`)

| Aspect | Observation |
|--------|-------------|
| **Structure** | Colonne pleine hauteur : toolbar multi-rangs, zone résultats scrollable, drawers / popovers. |
| **Densité** | **Élevée** : petits labels `0.73rem`–`0.77rem`, nombreux boutons `.kwic-toolbar-btn`, chips, filtres. |
| **Accent** | Onglets scope, sliders `accent-color: var(--accent)`, liens actifs → **`--accent` mode** (souvent bleu Concordancier). |
| **Cartes KWIC** | Fond surface, bordures, typographie monospace pour contexte gauche/droite. |
| **Fond** | `var(--bg)` → §2. |

**Risque UX** : surcharge cognitive sur petits écrans (toolbar `flex-wrap` mais beaucoup d’affordances). Une passe **réduction espacement** ou **regroupement** pourrait aider.

---

### 4.3 Constituer — shell général (`constituerModule.ts`)

| Aspect | Observation |
|--------|-------------|
| **Grille** | Sidebar `220px` (ou rail `28px` replié), main en flex column. |
| **Sidebar** | **Thème teal / vert dédié** : `#0c4a46`, `#e8f5f3`, `#9fd3cc`, `#cfe8e3`, boutons collapse `#1e4a80` sur fond bleu très pâle — **mélange “vert Constituer” + “bleu AGRAFES”** dans les micro-boutons. |
| **Sections** | Placeholders centrés (icône emoji + titre) avant lazy-mount. |
| **Tables** | Style “data dense” avec monospace sur IDs, badges d’état colorés. |

**Cohérence** : la section Constituer a une **sous-identité visuelle forte** par rapport au reste de l’app (tokens mint/teal hors `--surface` standard).

#### Sous-vue Actions — Hub cartes

- Cartes type CTA avec hover bordure teal, icônes emoji, texte hiérarchisé — même langage que Hub landing mais **palette verte**.

#### Sous-vue Curation

- **3 colonnes** : paramètres | preview (onglets côte à côte / brut / diff) | diagnostics + jobs.  
- Preview : barre d’onglets custom `.cur-preview-tab` (pas les `.insp-tab` du shell).  
- Densité **très élevée** ; risque de scroll horizontal sur fenêtres étroites.

#### Sous-vue Segmentation

- Barre “Vue” : toggle **Table / Texte / Traduction** style pill.  
- Liste épisodes + panneau texte : split standard `.acts-split`.

#### Sous-vue Alignement

- Barre params (pivot lang, slider confiance, checkbox) + split liste / détail.  
- **Violet mode** visible surtout dans le **header shell** ; l’intérieur reste surtout neutre `--surface` + accents locaux.

#### Sous-vue imbriquée — Audit d’alignement

- Barre stats + **onglets** Liens / Collisions / Concordancier.  
- Barre bulk actions avec codes couleur (accept / ignore / undo).  
- **Minimap** canvas : texture “outil pro” ; contraste des boutons petits à vérifier au manuel.  
- Champs note / filtres : mélange `var(--accent, #0f766e)` et hex de secours — indique **résilience** mais aussi **multiplication des teintes teals**.

---

### 4.4 Exporter (`exporterModule.ts`)

| Aspect | Observation |
|--------|-------------|
| **Fond racine** | `var(--surface2)` — **gris clair uniforme**, plus “dashboard” que Hub/KWIC. |
| **Header** | Carte blanche séparée par `border-bottom`, KPI en colonnes avec séparateurs verticaux. |
| **Onglets** | Style **faux onglets fichiers** (`border-radius` haut seulement), actif fond `surface2` pour fondre avec le body. |
| **Cartes export** | Grille 2 col (breakpoint `620px` → 1 col) : **responsive explicite** (rare ailleurs). |
| **QA** | Bannières sémantiques `.ok` / `.warnings` / `.blocking` (verts / jaunes / rouges pastels) — lisibles, proches du pattern Hub KPI gate. |

**Lecture** : une des vues les plus **alignées** sur les tokens globaux `--surface` / `--border` / `--text-muted`.

---

### 4.5 Inspecter (`inspecterModule.ts`)

| Aspect | Observation |
|--------|-------------|
| **Chrome** | Toolbar + barre actions gris `#surface` / `surface2`, très “outil de lecture”. |
| **Badges état** | Pastels Tailwind-like (`#fef9c3`, `#dbeafe`, `#dcfce7`, etc.) — **même famille** que meta panel et patterns modernes. |
| **Onglets RAW/CLEAN** | Actif : `var(--brand)` underline — **bleu brand**, pas `--accent** du mode (souvent identique en bleu si Concordancier, différent en Constituer vert). |
| **Texte** | Monospace `0.78rem`, line-height confortable `1.65`. |
| **Bouton Aligner** | Secondary sm, cohérent avec le DS boutons. |

---

### 4.6 Aligner (`alignerModule.ts`)

| Aspect | Observation |
|--------|-------------|
| **Cartes** | Titres uppercase trackés `0.06em`, ton “formulaire technique”. |
| **Badges mode** | Fond lavande `#ede9fe`, texte `#5b21b6` — **accord avec le violet shell** du mode Aligner. |
| **Garde / préconditions** | Fond jaune pâle `#fef9c3`, texte `#92400e` — signalisation d’avertissement cohérente avec le reste de l’app. |
| **Contrôles** | `accent-color: var(--accent)` sur checkboxes — lien **direct** avec la couleur de mode. |

---

### 4.7 Panneau méta (`features/metaPanel.ts`)

| Aspect | Observation |
|--------|-------------|
| **Position** | Drawer droit `320px`, `top: 44px` (sous le header fixe — **aligné** avec le layout). |
| **Animation** | `transform translateX`, backdrop semi-transparent. |
| **Typo** | Sections en capitales `10px` trackées ; champs `12px` ; valeurs monospace. |
| **Badges état** | Même logique sémantique (raw / normalized / segmented / ready). |
| **Variables** | Fallbacks explicites `var(--surface, #fff)` — robustesse si tokens absents. |

---

### 4.8 Overlay startup (`index.html` + `main.ts`)

| Aspect | Observation |
|--------|-------------|
| **Thème** | Fond très sombre `#0f172a`, texte blanc / gris `#94a3b8`, CTA bleu `#2563eb`. |
| **Contraste** | Élevé, lisibilité bonne. |
| **Identité** | Déconnectée du **clair** du reste de l’app — transition “cinéma sombre → UI claire” marquée (acceptable pour un splash). |

---

## 5. Accessibilité (aperçu)

| Sujet | Commentaire |
|--------|-------------|
| **Focus** | `focus-visible` global sur boutons / inputs — positif. |
| **Contrastes** | Les pastels de badges (jaune brut, bleu normalisé) sur fond blanc : **à valider** au calculateur WCAG pour petites tailles `0.72rem`. |
| **Touch targets** | Plusieurs boutons `.btn-sm` et puces `kwic` : risque < 44 px sur mobile (app desktop-first Tauri). |
| **Motion** | Transitions courtes ; pas d’alternative `prefers-reduced-motion` détectée dans les extraits — amélioration possible. |
| **Couleur seule** | États pipeline souvent **couleur + libellé** (OK) ; gate QA avec symboles (✓, ⚠, 🔴) — attention emoji et lecteurs d’écran. |

---

## 6. Responsive et densité

- **Exporter** : seule zone documentée avec `@media (max-width: 620px)` sur la grille de cartes.
- **Constituer / Curation 3 colonnes** : probable **dégradation** sur fenêtre étroite (scroll ou colonnes trop fines) — non couvert par une media query visible dans l’extrait audité.
- **Concordancier** : toolbar `flex-wrap` — adaptation partielle.

---

## 7. Synthèse — priorités visuelles

1. ~~**Définir `--bg`** (ou supprimer son usage) pour Hub + Concordancier.~~ ✅ Fait — `--bg: var(--surface)` ajouté dans `GLOBAL_CSS`.
2. **Décider** si `.btn-primary` doit suivre `--accent` par mode ou rester `--brand`, et documenter le choix.  
3. **Harmoniser** ou **assumer** la palette teal dédiée de Constituer vs tokens globaux (design system “une app, deux familles”).  
4. **Aligner** `body` (`#1a1a2e`) avec `--text` (`#212529`) ou documenter la double référence.  
5. **Passer** contrastes badges + textes `0.72rem` au WCAG AA sur un échantillon d’écrans.  
6. **Ajouter** `prefers-reduced-motion` si l’app cible des usages sensibles au mouvement.

---

## 8. Liens utiles

- Structure des écrans : [AUDIT_UI_2026-03.md](./AUDIT_UI_2026-03.md)  
- Tokens boutons / focus : `src/ui/dom.ts`  
- Accents dynamiques : `src/shell.ts` (`MODE_ACCENT`, `SHELL_CSS`)

---

*Fin du document.*
