"""Profils de normalisation : apply(raw) -> (clean, stats, debug)."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from howimetyourcorpus.core.models import TransformStats
from howimetyourcorpus.core.normalize.rules import MAX_MERGE_EXAMPLES, should_merge


# Schéma JSON pour validation des profils personnalisés
PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "profiles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1, "maxLength": 100},
                    "merge_subtitle_breaks": {"type": "boolean"},
                    "max_merge_examples_in_debug": {"type": "integer", "minimum": 0, "maximum": 1000},
                    "fix_double_spaces": {"type": "boolean"},
                    "fix_french_punctuation": {"type": "boolean"},
                    "normalize_apostrophes": {"type": "boolean"},
                    "normalize_quotes": {"type": "boolean"},
                    "strip_line_spaces": {"type": "boolean"},
                    "case_transform": {"type": "string", "enum": ["none", "lowercase", "UPPERCASE", "Title Case", "Sentence case"]},
                    "custom_regex_rules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "pattern": {"type": "string"},
                                "replacement": {"type": "string"}
                            },
                            "required": ["pattern", "replacement"]
                        }
                    },
                },
                "required": ["id", "merge_subtitle_breaks"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["profiles"],
}


class ProfileValidationError(Exception):
    """Erreur de validation d'un profil personnalisé."""
    pass


def validate_profiles_json(data: dict[str, Any]) -> None:
    """
    Valide le contenu d'un fichier profiles.json.
    Lève ProfileValidationError si invalide.
    
    Validation sans dépendance externe (jsonschema optionnelle) :
    - Structure : {"profiles": [{"id": "...", "merge_subtitle_breaks": true, ...}]}
    - Chaque profil doit avoir id (str, non-vide) et merge_subtitle_breaks (bool).
    """
    if not isinstance(data, dict):
        raise ProfileValidationError("Le fichier doit contenir un objet JSON avec clé 'profiles'.")
    
    profiles = data.get("profiles")
    if not isinstance(profiles, list):
        raise ProfileValidationError("La clé 'profiles' doit être une liste.")
    
    for i, p in enumerate(profiles):
        if not isinstance(p, dict):
            raise ProfileValidationError(f"Profil #{i+1} : doit être un objet JSON.")
        
        pid = p.get("id")
        if not isinstance(pid, str) or not pid.strip():
            raise ProfileValidationError(f"Profil #{i+1} : 'id' manquant ou vide.")
        
        merge = p.get("merge_subtitle_breaks")
        if not isinstance(merge, bool):
            raise ProfileValidationError(f"Profil '{pid}' : 'merge_subtitle_breaks' doit être true ou false.")
        
        max_ex = p.get("max_merge_examples_in_debug")
        if max_ex is not None and (not isinstance(max_ex, int) or max_ex < 0 or max_ex > 1000):
            raise ProfileValidationError(f"Profil '{pid}' : 'max_merge_examples_in_debug' doit être un entier entre 0 et 1000.")
        
        # Validation des règles booléennes (Phase 2)
        bool_rules = ["fix_double_spaces", "fix_french_punctuation", "normalize_apostrophes", 
                      "normalize_quotes", "strip_line_spaces"]
        for rule in bool_rules:
            val = p.get(rule)
            if val is not None and not isinstance(val, bool):
                raise ProfileValidationError(f"Profil '{pid}' : '{rule}' doit être true ou false.")
        
        # Validation case_transform (Phase 3)
        case_val = p.get("case_transform")
        if case_val is not None:
            valid_cases = ["none", "lowercase", "UPPERCASE", "Title Case", "Sentence case"]
            if not isinstance(case_val, str) or case_val not in valid_cases:
                raise ProfileValidationError(
                    f"Profil '{pid}' : 'case_transform' doit être l'un de : {', '.join(valid_cases)}"
                )
        
        # Validation custom_regex_rules (Phase 3)
        regex_rules = p.get("custom_regex_rules")
        if regex_rules is not None:
            if not isinstance(regex_rules, list):
                raise ProfileValidationError(f"Profil '{pid}' : 'custom_regex_rules' doit être une liste.")
            for j, rule in enumerate(regex_rules):
                if not isinstance(rule, dict):
                    raise ProfileValidationError(
                        f"Profil '{pid}' : règle regex #{j+1} doit être un objet avec 'pattern' et 'replacement'."
                    )
                if "pattern" not in rule or not isinstance(rule["pattern"], str):
                    raise ProfileValidationError(
                        f"Profil '{pid}' : règle regex #{j+1} : 'pattern' manquant ou invalide."
                    )
                if "replacement" not in rule or not isinstance(rule["replacement"], str):
                    raise ProfileValidationError(
                        f"Profil '{pid}' : règle regex #{j+1} : 'replacement' manquant ou invalide."
                    )
                # Valider que le pattern est une regex valide
                try:
                    re.compile(rule["pattern"])
                except re.error as e:
                    raise ProfileValidationError(
                        f"Profil '{pid}' : règle regex #{j+1} : pattern invalide : {e}"
                    )
        
        # Interdire les clés inconnues
        known_keys = {"id", "merge_subtitle_breaks", "max_merge_examples_in_debug",
                      "fix_double_spaces", "fix_french_punctuation", "normalize_apostrophes",
                      "normalize_quotes", "strip_line_spaces", "case_transform", "custom_regex_rules"}
        unknown = set(p.keys()) - known_keys
        if unknown:
            raise ProfileValidationError(f"Profil '{pid}' : clés inconnues : {', '.join(unknown)}")


@dataclass
class NormalizationProfile:
    """
    Profil de normalisation = ensemble de règles paramétrables.
    Règles MVP :
    - Fusionner retours à la ligne au milieu d'une phrase (césure sous-titres).
    - Conserver : double saut, didascalies (), [], lignes speaker-like.
    - Ne jamais inventer de locuteur.
    
    Règles étendues (Phase 2) :
    - Espaces avant double ponctuation (français : `;:!?`)
    - Suppression doubles espaces consécutifs
    - Normalisation apostrophes et guillemets
    - Suppression espaces début/fin de ligne
    """

    id: str
    merge_subtitle_breaks: bool = True
    max_merge_examples_in_debug: int = MAX_MERGE_EXAMPLES
    
    # Règles de ponctuation et espaces (Phase 2)
    fix_double_spaces: bool = True  # Remplace espaces multiples par un seul
    fix_french_punctuation: bool = False  # Ajoute espace avant `;:!?` (typographie française)
    normalize_apostrophes: bool = False  # ' → '
    normalize_quotes: bool = False  # "" → « » (français)
    strip_line_spaces: bool = True  # Supprime espaces début/fin de ligne
    
    # Règles de casse (Phase 3)
    case_transform: str = "none"  # "none" | "lowercase" | "UPPERCASE" | "Title Case" | "Sentence case"
    
    # Règles regex custom (Phase 3)
    custom_regex_rules: list[tuple[str, str]] = field(default_factory=list)  # [(pattern, replacement), ...]

    def _apply_case_transform(self, line: str) -> str:
        """Applique la transformation de casse sur une ligne."""
        if not line or self.case_transform == "none":
            return line
        
        if self.case_transform == "lowercase":
            return line.lower()
        elif self.case_transform == "UPPERCASE":
            return line.upper()
        elif self.case_transform == "Title Case":
            return line.title()
        elif self.case_transform == "Sentence case":
            # Première lettre en majuscule, reste en minuscule
            if line:
                return line[0].upper() + line[1:].lower() if len(line) > 1 else line.upper()
        return line
    
    def _apply_custom_regex(self, line: str) -> tuple[str, int]:
        """Applique les règles regex personnalisées sur une ligne.
        
        Returns:
            (ligne transformée, nombre de remplacements)
        """
        if not line or not self.custom_regex_rules:
            return line, 0
        
        result = line
        replacements = 0
        for pattern, replacement in self.custom_regex_rules:
            try:
                new_result, count = re.subn(pattern, replacement, result)
                result = new_result
                replacements += count
            except re.error:
                # Pattern regex invalide, ignorer silencieusement
                continue
        
        return result, replacements

    def _apply_line_rules(self, line: str) -> tuple[str, dict[str, int]]:
        """Applique les règles de ponctuation, espaces, casse et regex sur une ligne.
        
        Returns:
            (ligne transformée, compteurs: {punctuation: int, regex: int})
        """
        if not line:
            return line, {"punctuation": 0, "regex": 0}
            
        result = line
        counters = {"punctuation": 0, "regex": 0}
        
        # 1. Suppression espaces début/fin (toujours appliqué en interne, strip_line_spaces contrôle le comportement final)
        if self.strip_line_spaces:
            result = result.strip()
        
        # 2. Doubles espaces → espace simple
        if self.fix_double_spaces:
            before = result
            result = re.sub(r' {2,}', ' ', result)
            if result != before:
                counters["punctuation"] += 1
        
        # 3. Typographie française : espace insécable avant `;:!?`
        if self.fix_french_punctuation:
            before = result
            # Ajouter espace avant si manquant (mais pas en début de ligne)
            result = re.sub(r'(\S)([;:!?])', r'\1 \2', result)
            # Supprimer espaces multiples créés
            result = re.sub(r' {2,}', ' ', result)
            if result != before:
                counters["punctuation"] += 1
        
        # 4. Normalisation apostrophes ' → '
        if self.normalize_apostrophes:
            before = result
            result = result.replace("'", "'")
            if result != before:
                counters["punctuation"] += 1
        
        # 5. Normalisation guillemets "" → « »
        if self.normalize_quotes:
            before = result
            # Heuristique simple : premier " → «, second " → »
            parts = result.split('"')
            if len(parts) > 1:
                normalized = []
                for i, part in enumerate(parts):
                    if i > 0:
                        # Guillemet avant ce segment
                        if i % 2 == 1:
                            normalized.append('« ')
                        else:
                            normalized.append(' »')
                    normalized.append(part)
                result = ''.join(normalized)
                # Nettoyer espaces multiples
                result = re.sub(r' {2,}', ' ', result)
                if result != before:
                    counters["punctuation"] += 1
        
        # 6. Règles regex personnalisées
        result, regex_count = self._apply_custom_regex(result)
        counters["regex"] = regex_count
        
        # 7. Transformation de casse (en dernier pour ne pas affecter les règles)
        result = self._apply_case_transform(result)
        
        return result, counters

    def apply(self, raw_text: str) -> tuple[str, TransformStats, dict]:
        """
        Applique la normalisation.
        Returns:
            (clean_text, stats, debug) avec debug contenant merge_examples, history et compteurs.
        """
        t0 = time.perf_counter()
        raw_lines = [ln for ln in raw_text.splitlines()]
        stats = TransformStats(raw_lines=len(raw_lines))
        debug: dict = {
            "merge_examples": [],
            "punctuation_fixes": 0,
            "regex_replacements": 0,
            "case_transforms": 0,
            "history": []  # Liste des transformations: [{"step": "...", "before": "...", "after": "..."}]
        }
        if not raw_lines:
            return "", stats, debug

        output: list[str] = []
        merges = 0
        kept_breaks = 0
        punctuation_fixes = 0
        regex_replacements = 0
        i = 0
        
        while i < len(raw_lines):
            line = raw_lines[i]
            # Ligne vide : séparation forte
            if not line.strip():
                output.append("")
                kept_breaks += 1
                i += 1
                continue
            
            # Accumuler les lignes à fusionner (césure)
            acc = [line]
            i += 1
            while i < len(raw_lines) and self.merge_subtitle_breaks and should_merge(
                acc[-1], raw_lines[i]
            ):
                next_ln = raw_lines[i]
                if len(debug["merge_examples"]) < self.max_merge_examples_in_debug:
                    debug["merge_examples"].append(
                        {"before": acc[-1][-40:], "after": next_ln[:40] if len(next_ln) > 40 else next_ln}
                    )
                acc.append(next_ln)
                merges += 1
                i += 1
            
            merged = " ".join(s.strip() for s in acc if s.strip())
            
            # Appliquer les règles de ponctuation, espaces, regex et casse
            if merged:
                before_rules = merged
                merged, counters = self._apply_line_rules(merged)
                punctuation_fixes += counters["punctuation"]
                regex_replacements += counters["regex"]
                
                # Historique : enregistrer si changement
                if merged != before_rules and len(debug["history"]) < 50:  # Limite à 50 exemples
                    debug["history"].append({
                        "step": "line_rules",
                        "before": before_rules[:100],  # Tronquer pour éviter debug trop lourd
                        "after": merged[:100]
                    })
                
                # Détecter transformation de casse
                if self.case_transform != "none" and before_rules != merged:
                    debug["case_transforms"] = debug.get("case_transforms", 0) + 1
                
                output.append(merged)
                if len(acc) > 1:
                    kept_breaks += 1  # on compte un bloc logique
                    
        clean_text = "\n".join(output)
        stats.clean_lines = len([x for x in output if x.strip()])
        stats.merges = merges
        stats.kept_breaks = kept_breaks
        stats.duration_ms = int((time.perf_counter() - t0) * 1000)
        debug["punctuation_fixes"] = punctuation_fixes
        debug["regex_replacements"] = regex_replacements
        return clean_text, stats, debug


# Profils prédéfinis
PROFILES: dict[str, NormalizationProfile] = {
    "default_en_v1": NormalizationProfile(id="default_en_v1"),
    "default_fr_v1": NormalizationProfile(
        id="default_fr_v1",
        fix_french_punctuation=True,
        normalize_apostrophes=True,
    ),
    "conservative_v1": NormalizationProfile(
        id="conservative_v1",
        merge_subtitle_breaks=True,
        max_merge_examples_in_debug=10,
        fix_double_spaces=True,
        fix_french_punctuation=False,
    ),
    "aggressive_v1": NormalizationProfile(
        id="aggressive_v1",
        merge_subtitle_breaks=True,
        max_merge_examples_in_debug=30,
        fix_double_spaces=True,
        fix_french_punctuation=False,
    ),
}


def get_profile(
    profile_id: str,
    custom_profiles: dict[str, NormalizationProfile] | None = None,
) -> NormalizationProfile | None:
    """Retourne le profil par id ; custom_profiles (projet) prime sur les profils prédéfinis."""
    if custom_profiles and profile_id in custom_profiles:
        return custom_profiles[profile_id]
    return PROFILES.get(profile_id)


def get_all_profile_ids(
    custom_profiles: dict[str, NormalizationProfile] | None = None,
) -> list[str]:
    """Liste des ids de profils disponibles (prédéfinis + personnalisés, sans doublon)."""
    ids = list(PROFILES.keys())
    if custom_profiles:
        for pid in custom_profiles:
            if pid not in ids:
                ids.append(pid)
    return ids


# Libellés courts pour l'aperçu des règles (UI)
_PROFILE_RULE_LABELS = {
    "merge_subtitle_breaks": "Fusion césures (retours à la ligne milieu de phrase)",
    "max_merge_examples_in_debug": "Max exemples de fusions en debug",
    "fix_double_spaces": "Doubles espaces → un seul",
    "fix_french_punctuation": "Espace avant ; : ! ? (typographie française)",
    "normalize_apostrophes": "Normalisation apostrophes",
    "normalize_quotes": "Guillemets « » (français)",
    "strip_line_spaces": "Supprimer espaces début/fin de ligne",
    "case_transform": "Casse",
}
_CASE_LABELS = {
    "none": "aucune",
    "lowercase": "minuscules",
    "UPPERCASE": "MAJUSCULES",
    "Title Case": "Title Case",
    "Sentence case": "Sentence case",
}


def format_profile_rules_summary(profile: NormalizationProfile) -> str:
    """Retourne un résumé lisible des règles du profil (pour aperçu dans l'UI)."""
    lines: list[str] = []
    lines.append(f"Profil : {profile.id}")
    lines.append("")
    lines.append("Règles :")
    lines.append(f"  • {_PROFILE_RULE_LABELS['merge_subtitle_breaks']} : {'oui' if profile.merge_subtitle_breaks else 'non'}")
    lines.append(f"  • {_PROFILE_RULE_LABELS['max_merge_examples_in_debug']} : {profile.max_merge_examples_in_debug}")
    lines.append(f"  • {_PROFILE_RULE_LABELS['fix_double_spaces']} : {'oui' if profile.fix_double_spaces else 'non'}")
    lines.append(f"  • {_PROFILE_RULE_LABELS['fix_french_punctuation']} : {'oui' if profile.fix_french_punctuation else 'non'}")
    lines.append(f"  • {_PROFILE_RULE_LABELS['normalize_apostrophes']} : {'oui' if profile.normalize_apostrophes else 'non'}")
    lines.append(f"  • {_PROFILE_RULE_LABELS['normalize_quotes']} : {'oui' if profile.normalize_quotes else 'non'}")
    lines.append(f"  • {_PROFILE_RULE_LABELS['strip_line_spaces']} : {'oui' if profile.strip_line_spaces else 'non'}")
    case_label = _CASE_LABELS.get(profile.case_transform, profile.case_transform)
    lines.append(f"  • {_PROFILE_RULE_LABELS['case_transform']} : {case_label}")
    if profile.custom_regex_rules:
        lines.append("")
        lines.append("Règles regex personnalisées :")
        for i, (pattern, replacement) in enumerate(profile.custom_regex_rules[:10], 1):
            pat_short = pattern[:50] + "…" if len(pattern) > 50 else pattern
            rep_short = replacement[:30] + "…" if len(replacement) > 30 else replacement
            lines.append(f"  {i}. « {pat_short} » → « {rep_short} »")
        if len(profile.custom_regex_rules) > 10:
            lines.append(f"  … et {len(profile.custom_regex_rules) - 10} autre(s)")
    return "\n".join(lines)
