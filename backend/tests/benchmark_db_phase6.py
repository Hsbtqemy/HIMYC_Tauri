"""Benchmark de performance de la base de données (Phase 6).

Compare les performances avant/après optimisations :
- Ouverture/fermeture connexions
- Requêtes avec/sans index
- Insertions batch vs individuelles
"""

from __future__ import annotations

import time
from pathlib import Path
from tempfile import TemporaryDirectory

from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.models import EpisodeRef


def benchmark_connections(db: CorpusDB, n: int = 100) -> tuple[float, float]:
    """Benchmark ouverture/fermeture connexions.
    
    Returns:
        (temps_sans_context, temps_avec_context) en secondes.
    """
    # Pattern ancien : chaque opération ouvre/ferme
    start = time.perf_counter()
    for _ in range(n):
        conn = db._conn()
        conn.execute("SELECT 1")
        conn.close()
    time_without = time.perf_counter() - start
    
    # Pattern optimisé : context manager
    start = time.perf_counter()
    with db.connection() as conn:
        for _ in range(n):
            conn.execute("SELECT 1")
    time_with = time.perf_counter() - start
    
    return time_without, time_with


def benchmark_inserts(db: CorpusDB, n: int = 100) -> tuple[float, float]:
    """Benchmark insertions individuelles vs batch.
    
    Returns:
        (temps_individuel, temps_batch) en secondes.
    """
    refs = [
        EpisodeRef(
            episode_id=f"test-s01e{i:03d}",
            season=1,
            episode=i,
            title=f"Episode {i}",
            url=f"http://example.com/episode/{i}",
        )
        for i in range(1, n + 1)
    ]
    
    # Insertions individuelles
    start = time.perf_counter()
    for ref in refs:
        db.upsert_episode(ref, "new")
    time_individual = time.perf_counter() - start
    
    # Nettoyage
    conn = db._conn()
    try:
        conn.execute("DELETE FROM episodes WHERE episode_id LIKE 'test-%'")
        conn.commit()
    finally:
        conn.close()
    
    # Insertions batch
    start = time.perf_counter()
    db.upsert_episodes_batch(refs, "new")
    time_batch = time.perf_counter() - start
    
    return time_individual, time_batch


def benchmark_index_status(db: CorpusDB, n: int = 100) -> tuple[float, float]:
    """Benchmark requêtes avec/sans index sur status.
    
    Returns:
        (temps_filtrage_status, temps_comptage_batch) en secondes.
    """
    # Créer des données de test
    refs = [
        EpisodeRef(
            episode_id=f"bench-s{s:02d}e{e:02d}",
            season=s,
            episode=e,
            title=f"S{s:02d}E{e:02d}",
            url=f"http://example.com/s{s}/e{e}",
        )
        for s in range(1, 11)
        for e in range(1, 101)
    ]
    db.upsert_episodes_batch(refs, "new")
    
    # Mettre à jour statuts variés
    conn = db._conn()
    try:
        conn.execute("UPDATE episodes SET status = 'fetched' WHERE episode % 3 = 0")
        conn.execute("UPDATE episodes SET status = 'indexed' WHERE episode % 5 = 0")
        conn.commit()
    finally:
        conn.close()
    
    # Benchmark filtrage par status (optimisé Phase 6)
    start = time.perf_counter()
    for _ in range(n):
        db.get_episodes_by_status("indexed")
    time_filter = time.perf_counter() - start
    
    # Benchmark comptage par status (optimisé Phase 6)
    start = time.perf_counter()
    for _ in range(n):
        db.count_episodes_by_status()
    time_count = time.perf_counter() - start
    
    return time_filter, time_count


def run_benchmarks():
    """Exécute tous les benchmarks et affiche les résultats."""
    with TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "bench.db"
        db = CorpusDB(db_path)
        db.init()
        
        print("=" * 60)
        print("BENCHMARK BASE DE DONNEES - PHASE 6")
        print("=" * 60)
        print()
        
        # 1. Connexions
        print("Test 1 : Ouverture/Fermeture Connexions (100 ops)")
        print("-" * 60)
        t_without, t_with = benchmark_connections(db, 100)
        gain = t_without / t_with if t_with > 0 else 0
        print(f"  Sans context manager : {t_without * 1000:.1f} ms")
        print(f"  Avec context manager : {t_with * 1000:.1f} ms")
        print(f"  >> Gain : {gain:.1f}x plus rapide")
        print()
        
        # 2. Insertions
        print("Test 2 : Insertions Episodes (100 episodes)")
        print("-" * 60)
        t_individual, t_batch = benchmark_inserts(db, 100)
        gain = t_individual / t_batch if t_batch > 0 else 0
        print(f"  Insertions individuelles : {t_individual * 1000:.1f} ms")
        print(f"  Insertions batch         : {t_batch * 1000:.1f} ms")
        print(f"  >> Gain : {gain:.1f}x plus rapide")
        print()
        
        # 3. Index sur status
        print("Test 3 : Requetes optimisees (100 iterations, 1000 episodes)")
        print("-" * 60)
        t_filter, t_count = benchmark_index_status(db, 100)
        print(f"  Filtrage par status      : {t_filter * 1000:.1f} ms")
        print(f"  Comptage par status      : {t_count * 1000:.1f} ms")
        print(f"  >> Total operations DB   : {(t_filter + t_count) * 1000:.1f} ms")
        print()
        
        print("=" * 60)
        print("BENCHMARKS TERMINES !")
        print("=" * 60)


if __name__ == "__main__":
    run_benchmarks()
