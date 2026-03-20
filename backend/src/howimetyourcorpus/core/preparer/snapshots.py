"""Helpers de capture/restauration de snapshots Préparer."""

from __future__ import annotations

from typing import Any, Callable


def capture_prep_status_scope(store: Any, episode_id: str, source_key: str) -> dict[str, Any]:
    """Capture l'état d'un statut ciblé (episode, source)."""
    ep = (episode_id or "").strip()
    src = (source_key or "").strip()
    statuses = store.load_episode_prep_status()
    by_source = statuses.get(ep, {}) if ep else {}
    return {
        "episode_id": ep,
        "source_key": src,
        "has_value": src in by_source,
        "status": by_source.get(src, ""),
    }


def restore_prep_status_scope(
    store: Any,
    scope: dict[str, Any],
    *,
    valid_values: set[str],
) -> tuple[str, str] | None:
    """Restaure l'état d'un statut ciblé (episode, source)."""
    ep = (scope.get("episode_id") or "").strip()
    src = (scope.get("source_key") or "").strip()
    if not ep or not src:
        return None

    statuses = store.load_episode_prep_status()
    if bool(scope.get("has_value")):
        status = (scope.get("status") or "").strip().lower()
        if status in valid_values:
            statuses.setdefault(ep, {})[src] = status
        else:
            by_source = statuses.get(ep, {})
            by_source.pop(src, None)
            if by_source:
                statuses[ep] = by_source
            else:
                statuses.pop(ep, None)
    else:
        by_source = statuses.get(ep, {})
        by_source.pop(src, None)
        if by_source:
            statuses[ep] = by_source
        else:
            statuses.pop(ep, None)

    store.save_episode_prep_status(statuses)
    return ep, src


def capture_assignments_scope(
    store: Any,
    include_predicate: Callable[[dict[str, Any]], bool],
) -> list[dict[str, Any]]:
    """Capture un sous-ensemble d'assignations selon un prédicat."""
    return [dict(a) for a in store.load_character_assignments() if include_predicate(a)]


def restore_assignments_scope(
    store: Any,
    scoped_assignments: list[dict[str, Any]],
    scoped_predicate: Callable[[dict[str, Any]], bool],
) -> None:
    """Restaure un sous-ensemble d'assignations selon un prédicat."""
    current = store.load_character_assignments()
    kept = [a for a in current if not scoped_predicate(a)]
    store.save_character_assignments(kept + [dict(a) for a in (scoped_assignments or [])])

