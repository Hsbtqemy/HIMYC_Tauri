"""Contrôleur d'état/snapshots pour l'onglet Préparer."""

from __future__ import annotations

from typing import Any, Callable

from howimetyourcorpus.core.preparer import (
    apply_clean_storage_state,
    apply_cue_storage_state,
    apply_utterance_db_state,
    capture_clean_storage_state,
    capture_cue_storage_state,
    capture_utterance_db_state,
)
from howimetyourcorpus.core.preparer.snapshots import (
    capture_assignments_scope as capture_assignments_scope_snapshot,
    capture_prep_status_scope as capture_prep_status_scope_snapshot,
    restore_assignments_scope as restore_assignments_scope_snapshot,
    restore_prep_status_scope as restore_prep_status_scope_snapshot,
)


class PreparerStateController:
    """Gère capture/restauration des snapshots status/assignations/persistance."""

    def __init__(self, tab: Any, *, valid_status_values: set[str]) -> None:
        self._tab = tab
        self._valid_status_values = valid_status_values

    def capture_prep_status_scope(self, episode_id: str, source_key: str) -> dict[str, Any]:
        store = self._tab._get_store()
        if not store:
            return {}
        return capture_prep_status_scope_snapshot(store, episode_id, source_key)

    def restore_prep_status_scope(self, scope: dict[str, Any]) -> None:
        tab = self._tab
        store = tab._get_store()
        if not store:
            return
        restored = restore_prep_status_scope_snapshot(
            store,
            scope,
            valid_values=self._valid_status_values,
        )
        if not restored:
            return
        ep, src = restored
        if tab._current_episode_id == ep and tab._current_source_key == src:
            status = store.get_episode_prep_status(ep, src, default="raw")
            tab._apply_status_value(status, persist=False, mark_dirty=False)

    def restore_prep_status_snapshot(self, episode_id: str, state: dict[str, Any]) -> None:
        tab = self._tab
        store = tab._get_store()
        if not store:
            return
        if "prep_status_scope" in state:
            self.restore_prep_status_scope(state.get("prep_status_scope") or {})
            return
        if "prep_status_state" not in state:
            return
        # Compat: anciens snapshots globaux
        store.save_episode_prep_status(state.get("prep_status_state") or {})
        if tab._current_episode_id == episode_id and tab._current_source_key:
            status = store.get_episode_prep_status(episode_id, tab._current_source_key, default="raw")
            tab._apply_status_value(status, persist=False, mark_dirty=False)

    def restore_assignment_snapshot(
        self,
        state: dict[str, Any],
        scoped_restore: Callable[[list[dict[str, Any]]], None],
    ) -> None:
        tab = self._tab
        if "assignment_scope" in state:
            scoped_restore(state.get("assignment_scope") or [])
            return
        if "assignments" not in state:
            return
        store = tab._get_store()
        if store:
            # Compat: anciens snapshots globaux
            store.save_character_assignments(state.get("assignments", []))

    @staticmethod
    def is_utterance_assignment(assignment: dict[str, Any], episode_id: str) -> bool:
        return (
            assignment.get("episode_id") == episode_id
            and assignment.get("source_type") == "segment"
            and ":utterance:" in (assignment.get("source_id") or "")
        )

    def capture_utterance_assignments_scope(self, episode_id: str) -> list[dict[str, Any]]:
        store = self._tab._get_store()
        if not store:
            return []
        return capture_assignments_scope_snapshot(
            store,
            lambda assignment, ep=episode_id: self.is_utterance_assignment(assignment, ep),
        )

    def restore_utterance_assignments_scope(
        self,
        episode_id: str,
        scoped_assignments: list[dict[str, Any]],
    ) -> None:
        store = self._tab._get_store()
        if not store:
            return
        restore_assignments_scope_snapshot(
            store,
            scoped_assignments,
            lambda assignment, ep=episode_id: self.is_utterance_assignment(assignment, ep),
        )

    @staticmethod
    def is_cue_assignment_for_lang(assignment: dict[str, Any], episode_id: str, lang: str) -> bool:
        prefix = f"{episode_id}:{lang}:"
        return (
            assignment.get("episode_id") == episode_id
            and assignment.get("source_type") == "cue"
            and (assignment.get("source_id") or "").startswith(prefix)
        )

    def capture_cue_assignments_scope(self, episode_id: str, lang: str) -> list[dict[str, Any]]:
        store = self._tab._get_store()
        if not store:
            return []
        return capture_assignments_scope_snapshot(
            store,
            lambda assignment, ep=episode_id, ln=lang: self.is_cue_assignment_for_lang(assignment, ep, ln),
        )

    def restore_cue_assignments_scope(
        self,
        episode_id: str,
        lang: str,
        scoped_assignments: list[dict[str, Any]],
    ) -> None:
        store = self._tab._get_store()
        if not store:
            return
        restore_assignments_scope_snapshot(
            store,
            scoped_assignments,
            lambda assignment, ep=episode_id, ln=lang: self.is_cue_assignment_for_lang(assignment, ep, ln),
        )

    def capture_clean_file_state(self, episode_id: str, source_key: str) -> dict[str, Any]:
        store = self._tab._get_store()
        if not store:
            return {}
        state = capture_clean_storage_state(store, episode_id)
        state["prep_status_scope"] = self.capture_prep_status_scope(episode_id, source_key)
        return state

    def apply_clean_file_state(self, episode_id: str, state: dict[str, Any], *, mark_dirty: bool) -> None:
        tab = self._tab
        store = tab._get_store()
        if not store:
            return
        apply_clean_storage_state(store, episode_id, state)
        self.restore_prep_status_snapshot(episode_id, state)
        tab._set_dirty(mark_dirty)

    def capture_utterance_persistence_state(self, episode_id: str, source_key: str) -> dict[str, Any]:
        db = self._tab._get_db()
        if not db:
            return {}
        state = capture_utterance_db_state(db, episode_id)
        state["assignment_scope"] = self.capture_utterance_assignments_scope(episode_id)
        state["prep_status_scope"] = self.capture_prep_status_scope(episode_id, source_key)
        return state

    def apply_utterance_persistence_state(
        self,
        episode_id: str,
        state: dict[str, Any],
        *,
        mark_dirty: bool,
    ) -> None:
        tab = self._tab
        db = tab._get_db()
        store = tab._get_store()
        if not db or not store:
            return
        apply_utterance_db_state(db, episode_id, state)
        self.restore_assignment_snapshot(
            state,
            lambda scoped_assignments, ep=episode_id: self.restore_utterance_assignments_scope(ep, scoped_assignments),
        )
        self.restore_prep_status_snapshot(episode_id, state)
        tab._set_dirty(mark_dirty)

    def capture_cue_persistence_state(self, episode_id: str, lang: str, source_key: str) -> dict[str, Any]:
        db = self._tab._get_db()
        if not db:
            return {}
        store = self._tab._get_store()
        state = capture_cue_storage_state(db, store, episode_id, lang)
        state["assignment_scope"] = self.capture_cue_assignments_scope(episode_id, lang)
        state["prep_status_scope"] = self.capture_prep_status_scope(episode_id, source_key)
        return state

    def apply_cue_persistence_state(
        self,
        episode_id: str,
        lang: str,
        state: dict[str, Any],
        *,
        mark_dirty: bool,
    ) -> None:
        tab = self._tab
        db = tab._get_db()
        store = tab._get_store()
        if not db or not store:
            return
        apply_cue_storage_state(db, store, episode_id, lang, state)
        self.restore_assignment_snapshot(
            state,
            lambda scoped_assignments, ep=episode_id, ln=lang: self.restore_cue_assignments_scope(
                ep, ln, scoped_assignments
            ),
        )
        self.restore_prep_status_snapshot(episode_id, state)
        tab._set_dirty(mark_dirty)
