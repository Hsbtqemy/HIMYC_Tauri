"""Tests des fonctionnalités avancées Phase 3 (casse, regex, historique)."""

from howimetyourcorpus.core.normalize.profiles import NormalizationProfile


def test_case_transform_lowercase():
    """Test transformation en minuscules."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        case_transform="lowercase",
    )
    raw = "HELLO World"
    clean, stats, debug = profile.apply(raw)
    assert clean == "hello world"


def test_case_transform_uppercase():
    """Test transformation en majuscules."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        case_transform="UPPERCASE",
    )
    raw = "Hello World"
    clean, stats, debug = profile.apply(raw)
    assert clean == "HELLO WORLD"


def test_case_transform_title():
    """Test transformation en Title Case."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        case_transform="Title Case",
    )
    raw = "hello world"
    clean, stats, debug = profile.apply(raw)
    assert clean == "Hello World"


def test_case_transform_sentence():
    """Test transformation en Sentence case."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        case_transform="Sentence case",
    )
    raw = "hello world"
    clean, stats, debug = profile.apply(raw)
    assert clean == "Hello world"


def test_custom_regex_simple():
    """Test règle regex personnalisée simple."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        custom_regex_rules=[
            (r"\s+,", ","),  # Supprimer espaces avant virgule
        ],
    )
    raw = "Salut  , comment ça va  ?"
    clean, stats, debug = profile.apply(raw)
    assert ", comment" in clean  # Espace avant virgule supprimé
    assert debug["regex_replacements"] > 0


def test_custom_regex_multiple():
    """Test plusieurs règles regex."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        custom_regex_rules=[
            (r"\s+,", ","),  # Espaces avant virgule
            (r"M\.", "Monsieur"),  # Abréviations
        ],
    )
    raw = "Salut M. Smith  , comment ça va ?"
    clean, stats, debug = profile.apply(raw)
    assert "Monsieur Smith" in clean
    assert ", comment" in clean


def test_history_recorded():
    """Test que l'historique des transformations est enregistré."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=True,
        fix_french_punctuation=True,
    )
    raw = "Bonjour!\nComment ça va?"
    clean, stats, debug = profile.apply(raw)
    
    # L'historique doit contenir des entrées
    history = debug.get("history", [])
    assert len(history) > 0
    
    # Chaque entrée doit avoir step, before, after
    for h in history:
        assert "step" in h
        assert "before" in h
        assert "after" in h


def test_combined_advanced_rules():
    """Test combinaison de toutes les règles avancées."""
    profile = NormalizationProfile(
        id="test_advanced",
        merge_subtitle_breaks=True,
        fix_double_spaces=True,
        fix_french_punctuation=True,
        case_transform="Title Case",
        custom_regex_rules=[
            (r"M\.", "Monsieur"),
        ],
    )
    raw = "bonjour M. smith  ,\ncomment ça va?"
    clean, stats, debug = profile.apply(raw)
    
    # Fusion de lignes
    assert "\n" not in clean or clean.count("\n") < raw.count("\n")
    
    # Doubles espaces corrigés
    assert "  " not in clean
    
    # Ponctuation française
    assert "?" in clean and (" ?" in clean or clean.endswith("?"))
    
    # Regex custom : M. → Monsieur
    assert "Monsieur" in clean
    
    # Title Case
    words = clean.split()
    # Au moins certains mots commencent par majuscule
    assert any(w[0].isupper() for w in words if w)


def test_regex_stats():
    """Test que les statistiques regex sont correctement comptées."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        custom_regex_rules=[
            (r"\d+", "X"),  # Remplacer tous les chiffres par X
        ],
    )
    raw = "J'ai 10 pommes et 5 poires."
    clean, stats, debug = profile.apply(raw)
    
    assert "X" in clean
    assert "10" not in clean
    assert "5" not in clean
    assert debug["regex_replacements"] >= 2  # Au moins 2 remplacements


def test_history_limited():
    """Test que l'historique est limité pour éviter une surcharge mémoire."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        fix_french_punctuation=True,
    )
    # Générer beaucoup de lignes
    raw = "\n".join([f"Ligne {i}! Comment ça va?" for i in range(100)])
    clean, stats, debug = profile.apply(raw)
    
    history = debug.get("history", [])
    # L'historique doit être limité (max 50 dans le code)
    assert len(history) <= 50


def test_invalid_regex_silently_ignored():
    """Test qu'une regex invalide est ignorée sans planter."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        custom_regex_rules=[
            (r"[invalid(", "X"),  # Regex invalide
            (r"\d+", "NUM"),  # Regex valide
        ],
    )
    raw = "Test 123 done"
    clean, stats, debug = profile.apply(raw)
    
    # La règle valide doit être appliquée
    assert "NUM" in clean or "123" not in clean


def test_case_transform_none():
    """Test que 'none' ne transforme pas la casse."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        case_transform="none",
    )
    raw = "Hello WORLD"
    clean, stats, debug = profile.apply(raw)
    assert clean == "Hello WORLD"


if __name__ == "__main__":
    # Exécution rapide des tests pour validation
    test_case_transform_lowercase()
    test_case_transform_uppercase()
    test_case_transform_title()
    test_case_transform_sentence()
    test_custom_regex_simple()
    test_custom_regex_multiple()
    test_history_recorded()
    test_combined_advanced_rules()
    test_regex_stats()
    test_history_limited()
    test_invalid_regex_silently_ignored()
    test_case_transform_none()
    print("✅ Tous les tests Phase 3 passent !")
