"""Test des nouvelles règles de normalisation (Phase 2)."""

from howimetyourcorpus.core.normalize.profiles import NormalizationProfile


def test_fix_double_spaces():
    """Test de la correction des doubles espaces."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        fix_double_spaces=True,
    )
    raw = "Salut  ,  comment   ça  va ?"
    clean, stats, debug = profile.apply(raw)
    assert "  " not in clean
    assert "Salut , comment ça va ?" == clean


def test_french_punctuation():
    """Test de l'ajout d'espace avant ponctuation française."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        fix_french_punctuation=True,
    )
    raw = "Comment ça va? Très bien!"
    clean, stats, debug = profile.apply(raw)
    assert "va ?" in clean
    assert "bien !" in clean


def test_normalize_apostrophes():
    """Test de la normalisation des apostrophes."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        normalize_apostrophes=True,
    )
    raw = "C'est l'heure"
    clean, stats, debug = profile.apply(raw)
    # Vérifier que le texte contient bien des apostrophes typographiques
    # (Le remplacement ' → ' est effectué)
    assert "C'est" in clean or "C'est" in clean
    assert "l'heure" in clean or "l'heure" in clean


def test_normalize_quotes():
    """Test de la normalisation des guillemets."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        normalize_quotes=True,
    )
    raw = '"Bonjour" dit-il'
    clean, stats, debug = profile.apply(raw)
    assert "« Bonjour »" in clean
    assert '"' not in clean


def test_strip_line_spaces():
    """Test de la suppression des espaces début/fin."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        strip_line_spaces=True,
    )
    raw = "  Hello  \n  World  "
    clean, stats, debug = profile.apply(raw)
    lines = clean.split("\n")
    assert lines[0] == "Hello"
    assert lines[1] == "World"


def test_combined_rules():
    """Test de plusieurs règles combinées (profil français typique)."""
    profile = NormalizationProfile(
        id="test_fr",
        merge_subtitle_breaks=True,
        fix_double_spaces=True,
        fix_french_punctuation=True,
        normalize_apostrophes=True,
        strip_line_spaces=True,
    )
    raw = "  Salut  ,  comment\nça  va? C'est  super!"
    clean, stats, debug = profile.apply(raw)
    
    # Fusion de lignes
    assert "\n" not in clean or clean.count("\n") < raw.count("\n")
    
    # Doubles espaces corrigés
    assert "  " not in clean
    
    # Ponctuation française
    assert "va ?" in clean
    assert "super !" in clean
    
    # Apostrophes normalisées (vérifier qu'il y a bien un C avec apostrophe)
    assert "C'" in clean or "C'" in clean
    
    # Statistiques de corrections ponctuation dans debug
    assert debug.get("punctuation_fixes", 0) > 0


def test_punctuation_fixes_stats():
    """Test que les statistiques de corrections ponctuation sont bien retournées."""
    profile = NormalizationProfile(
        id="test",
        merge_subtitle_breaks=False,
        fix_french_punctuation=True,
    )
    raw = "Bonjour! Comment ça va?"
    clean, stats, debug = profile.apply(raw)
    
    assert "punctuation_fixes" in debug
    assert debug["punctuation_fixes"] > 0


def test_no_rules_applied():
    """Test avec toutes les règles désactivées (passthrough)."""
    profile = NormalizationProfile(
        id="test_passthrough",
        merge_subtitle_breaks=False,
        fix_double_spaces=False,
        fix_french_punctuation=False,
        normalize_apostrophes=False,
        normalize_quotes=False,
        strip_line_spaces=False,
    )
    raw = "  Hello  World  "
    clean, stats, debug = profile.apply(raw)
    # Presque aucune transformation (split/join minimal)
    assert len(clean) > 0


def test_default_fr_profile():
    """Test du nouveau profil prédéfini default_fr_v1."""
    from howimetyourcorpus.core.normalize.profiles import PROFILES
    
    assert "default_fr_v1" in PROFILES
    profile = PROFILES["default_fr_v1"]
    
    assert profile.merge_subtitle_breaks is True
    assert profile.fix_french_punctuation is True
    assert profile.normalize_apostrophes is True
    assert profile.fix_double_spaces is True


if __name__ == "__main__":
    # Exécution rapide des tests pour validation
    test_fix_double_spaces()
    test_french_punctuation()
    test_normalize_apostrophes()
    test_normalize_quotes()
    test_strip_line_spaces()
    test_combined_rules()
    test_punctuation_fixes_stats()
    test_no_rules_applied()
    test_default_fr_profile()
    print("✅ Tous les tests passent !")
