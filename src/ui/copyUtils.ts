/**
 * ui/copyUtils.ts — Utilitaires copie presse-papier.
 *
 * Porte de AGRAFES tauri-app/src/ui/results.ts@03a8790 :
 *   makeCopyBtn(), makeGroupCopyBtn(), buildCitationText().
 *
 * Adapte pour HIMYC : types natifs HIMYC (pas de QueryHit/AlignedUnit).
 * Aucune dependance sur les modules AGRAFES.
 */

import { elt } from "./dom.ts";

// ─── Types HIMYC ──────────────────────────────────────────────────────────────

/** Source alignee dans une citation multi-langue (ex: SRT EN / SRT FR). */
export interface AlignedSource {
  lang: string;
  title?: string;
  ref?: string;
  text: string;
}

/** Pivot d une citation (transcript ou SRT principal). */
export interface CitationPivot {
  lang: string;
  title?: string;
  ref?: string;
  text: string;
}

// ─── Boutons copie ─────────────────────────────────────────────────────────────

/** Bouton copie compact avec flash "Copie !" (carre de texte). */
export function makeCopyBtn(text: string, label = "📋 Copier"): HTMLButtonElement {
  const btn = elt("button", {
    class: "btn btn-ghost",
    title: "Copier le texte",
    type: "button",
  }, label) as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "✓ Copie";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove("copied");
      }, 1500);
    }).catch(() => {
      // Permission refusée ou API non disponible — on ne signale pas l'erreur à l'utilisateur
    });
  });
  return btn;
}

/** Petit bouton icone copie pour les entetes de groupe (passe `meta-copy-micro`). */
export function makeGroupCopyBtn(text: string, lang: string): HTMLButtonElement {
  const btn = elt("button", {
    class: "meta-copy-micro",
    title: `Copier les passages ${lang.toUpperCase()}`,
    type: "button",
  }, "📋") as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "✓";
      setTimeout(() => { btn.textContent = "📋"; }, 1200);
    }).catch(() => {
      // Permission refusée ou API non disponible
    });
  });
  return btn;
}

// ─── Citation multi-langue ─────────────────────────────────────────────────────

/**
 * Formate une citation multi-langue : pivot + sources alignees.
 *
 * Format :
 *   [LANG] Titre §ref
 *   «texte pivot»
 *
 *   [LANG2] Titre §ref
 *   «texte aligne»
 */
export function buildCitationText(
  pivot: CitationPivot,
  aligned: AlignedSource[] = [],
): string {
  const pivotLang = pivot.lang.toUpperCase();
  const pivotRef = pivot.ref ? ` §${pivot.ref}` : "";
  const lines: string[] = [
    `[${pivotLang}] ${pivot.title ?? "—"}${pivotRef}`,
    `«${pivot.text.trim()}»`,
  ];

  // Regrouper par langue + titre
  const groups = new Map<string, AlignedSource[]>();
  for (const src of aligned) {
    const key = `${src.lang}|${src.title ?? ""}`;
    const cur = groups.get(key);
    if (cur) cur.push(src); else groups.set(key, [src]);
  }

  for (const [key, items] of groups.entries()) {
    const [lang, title] = key.split("|");
    const ref = items[0]?.ref ? ` §${items[0].ref}` : "";
    const text = items.map((i) => i.text.trim()).filter(Boolean).join(" / ");
    lines.push("", `[${(lang ?? "?").toUpperCase()}] ${title ?? "—"}${ref}`, `«${text}»`);
  }

  return lines.join("\n");
}

/** Bouton copie citation complete (pivot + alignements). */
export function makeCitationBtn(
  pivot: CitationPivot,
  aligned: AlignedSource[] = [],
): HTMLButtonElement {
  const btn = elt("button", {
    class: "btn btn-ghost",
    title: "Copier la citation complete (pivot + sources alignees)",
    type: "button",
  }, "📄 Citation") as HTMLButtonElement;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = buildCitationText(pivot, aligned);
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "✓ Copie";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "📄 Citation"; btn.classList.remove("copied"); }, 1500);
    }).catch(() => {
      // Permission refusée ou API non disponible
    });
  });
  return btn;
}
