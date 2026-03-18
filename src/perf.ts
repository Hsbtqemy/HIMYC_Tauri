/**
 * perf.ts — Métriques runtime minimales (MX-011)
 *
 * Utilitaire léger de chronométrage basé sur `performance.now()`.
 * Émet des logs `console.debug` — aucun impact production.
 *
 * Usage :
 *   markStart("load_episodes");
 *   await fetchEpisodes();
 *   const ms = markEnd("load_episodes"); // → console.debug "[HIMYC perf] load_episodes: 42.3ms"
 *
 *   const result = await measureAsync("load_episodes", fetchEpisodes);
 */

const _marks = new Map<string, number>();

/** Démarre un chronomètre nommé. */
export function markStart(name: string): void {
  _marks.set(name, performance.now());
}

/**
 * Arrête le chronomètre, émet un log debug et retourne la durée en ms.
 * Retourne -1 si `markStart` n'a pas été appelé pour ce nom.
 */
export function markEnd(name: string): number {
  const start = _marks.get(name);
  if (start === undefined) return -1;
  const elapsed = performance.now() - start;
  _marks.delete(name);
  console.debug(`[HIMYC perf] ${name}: ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

/** Mesure une fonction synchrone et retourne son résultat. */
export function measure<T>(name: string, fn: () => T): T {
  markStart(name);
  const result = fn();
  markEnd(name);
  return result;
}

/** Mesure une fonction asynchrone et retourne son résultat. */
export async function measureAsync<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  markStart(name);
  try {
    const result = await fn();
    markEnd(name);
    return result;
  } catch (e) {
    markEnd(name);
    throw e;
  }
}
