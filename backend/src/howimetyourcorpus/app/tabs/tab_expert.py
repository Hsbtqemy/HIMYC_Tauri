"""Prototype de vue transverse expert (lecture seule)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.core.align import parse_run_segment_kind


class ExpertTransverseTabWidget(QWidget):
    """Synthese transverse des contextes metier (episode/run/propagation/undo)."""
    AUTO_REFRESH_INTERVAL_MS = 2000

    def __init__(
        self,
        get_store: Callable[[], object],
        get_db: Callable[[], object],
        get_inspector_tab: Callable[[], object],
        get_preparer_tab: Callable[[], object],
        get_alignment_tab: Callable[[], object],
        get_personnages_tab: Callable[[], object],
        get_undo_stack: Callable[[], object],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._get_inspector_tab = get_inspector_tab
        self._get_preparer_tab = get_preparer_tab
        self._get_alignment_tab = get_alignment_tab
        self._get_personnages_tab = get_personnages_tab
        self._get_undo_stack = get_undo_stack
        self._refresh_in_progress = False

        layout = QVBoxLayout(self)

        head = QHBoxLayout()
        head.addWidget(QLabel("Vue transverse expert (prototype)"))
        head.addStretch(1)
        self.auto_refresh_cb = QCheckBox("Auto-refresh (2s)")
        self.auto_refresh_cb.setToolTip(
            "Rafraichit la synthese toutes les 2 secondes. "
            "Desactivez si vous travaillez hors suivi live."
        )
        self.auto_refresh_cb.toggled.connect(self._on_auto_refresh_toggled)
        head.addWidget(self.auto_refresh_cb)
        self.refresh_btn = QPushButton("Rafraichir")
        self.refresh_btn.clicked.connect(self.refresh)
        head.addWidget(self.refresh_btn)
        layout.addLayout(head)

        kpi_row = QHBoxLayout()
        self.kpi_project_label = QLabel("Project loaded: -")
        self.kpi_project_label.setToolTip(
            "Yes si root projet, config.toml, corpus.db et schema DB sont valides."
        )
        kpi_row.addWidget(self.kpi_project_label)
        self.kpi_context_label = QLabel("Context consistent: -")
        self.kpi_context_label.setToolTip(
            "Yes si toutes les vues non vides pointent vers le meme episode."
        )
        kpi_row.addWidget(self.kpi_context_label)
        self.kpi_episode_label = QLabel("Episode focus: -")
        self.kpi_episode_label.setToolTip(
            "Episode commun detecte entre les vues; '-' si ambigu ou non renseigne."
        )
        kpi_row.addWidget(self.kpi_episode_label)
        kpi_row.addStretch(1)
        layout.addLayout(kpi_row)

        self.kpi_legend_label = QLabel(
            "Legende KPI: survolez les KPI pour les criteres de calcul."
        )
        self.kpi_legend_label.setToolTip(
            "Project loaded = etat projet exploitable; "
            "Context consistent = coherence inter-vues; "
            "Episode focus = episode pivot."
        )
        layout.addWidget(self.kpi_legend_label)

        self.summary_edit = QPlainTextEdit()
        self.summary_edit.setReadOnly(True)
        self.summary_edit.setPlaceholderText("Aucune donnee transverse disponible.")
        layout.addWidget(self.summary_edit, 1)

        self.auto_refresh_timer = QTimer(self)
        self.auto_refresh_timer.setInterval(self.AUTO_REFRESH_INTERVAL_MS)
        self.auto_refresh_timer.timeout.connect(self._on_auto_refresh_tick)

        self.refresh()

    def _on_auto_refresh_toggled(self, enabled: bool) -> None:
        if enabled:
            self.auto_refresh_timer.start()
        else:
            self.auto_refresh_timer.stop()

    def _on_auto_refresh_tick(self) -> None:
        self.refresh()

    @staticmethod
    def _combo_value(combo: Any) -> str:
        if combo is None:
            return ""
        value = combo.currentData() if hasattr(combo, "currentData") else None
        if value in (None, "") and hasattr(combo, "currentText"):
            value = combo.currentText()
        return str(value or "").strip()

    @staticmethod
    def _safe_call(fn: Callable[[], object] | None) -> object | None:
        if fn is None:
            return None
        try:
            return fn()
        except Exception:
            return None

    def _get_context_episode_map(self) -> dict[str, str]:
        inspector_tab = self._safe_call(self._get_inspector_tab)
        preparer_tab = self._safe_call(self._get_preparer_tab)
        alignment_tab = self._safe_call(self._get_alignment_tab)
        personnages_tab = self._safe_call(self._get_personnages_tab)

        inspector_episode = ""
        if inspector_tab is not None:
            # Inspecteur combine : episode_combo ; Inspecteur seul : inspect_episode_combo.
            if hasattr(inspector_tab, "episode_combo"):
                inspector_episode = self._combo_value(inspector_tab.episode_combo)
            elif hasattr(inspector_tab, "inspect_episode_combo"):
                inspector_episode = self._combo_value(inspector_tab.inspect_episode_combo)

        preparer_episode = ""
        if preparer_tab is not None:
            if hasattr(preparer_tab, "current_episode_id") and callable(preparer_tab.current_episode_id):
                try:
                    preparer_episode = str(preparer_tab.current_episode_id() or "")
                except Exception:
                    preparer_episode = ""
            if not preparer_episode and hasattr(preparer_tab, "prep_episode_combo"):
                preparer_episode = self._combo_value(preparer_tab.prep_episode_combo)

        alignment_episode = ""
        if alignment_tab is not None and hasattr(alignment_tab, "align_episode_combo"):
            alignment_episode = self._combo_value(alignment_tab.align_episode_combo)

        personnages_episode = ""
        if personnages_tab is not None and hasattr(personnages_tab, "personnages_episode_combo"):
            personnages_episode = self._combo_value(personnages_tab.personnages_episode_combo)

        return {
            "inspecteur": inspector_episode,
            "preparer": preparer_episode,
            "alignement": alignment_episode,
            "personnages": personnages_episode,
        }

    def _alignment_snapshot(self) -> dict[str, Any]:
        db = self._safe_call(self._get_db)
        alignment_tab = self._safe_call(self._get_alignment_tab)
        if db is None or alignment_tab is None:
            return {
                "episode_id": "",
                "selected_run": "",
                "run_count": 0,
                "selected_run_segment_kind": "",
                "selected_segment_filter": "",
                "pivot_lang": "",
                "target_lang": "",
            }

        episode_id = self._combo_value(getattr(alignment_tab, "align_episode_combo", None))
        run_id = self._combo_value(getattr(alignment_tab, "align_run_combo", None))
        runs = []
        if episode_id and hasattr(db, "get_align_runs_for_episode"):
            try:
                runs = db.get_align_runs_for_episode(episode_id) or []
            except Exception:
                runs = []

        selected_kind = ""
        if run_id:
            for run in runs:
                rid = str(run.get("align_run_id") or "")
                if rid != run_id:
                    continue
                selected_kind, _ = parse_run_segment_kind(
                    run.get("params_json"),
                    run_id=rid,
                )
                break

        return {
            "episode_id": episode_id,
            "selected_run": run_id,
            "run_count": len(runs),
            "selected_run_segment_kind": selected_kind,
            "selected_segment_filter": self._combo_value(getattr(alignment_tab, "align_segment_kind_combo", None)),
            "pivot_lang": self._combo_value(getattr(alignment_tab, "align_pivot_lang_combo", None)),
            "target_lang": self._combo_value(getattr(alignment_tab, "align_target_lang_combo", None)),
        }

    def _propagation_snapshot(self, episode_hint: str) -> dict[str, Any]:
        store = self._safe_call(self._get_store)
        if store is None or not hasattr(store, "load_character_assignments"):
            return {
                "assignments_total": 0,
                "assignments_episode": 0,
                "segment_assignments_episode": 0,
                "cue_assignments_episode": 0,
            }

        try:
            assignments = list(store.load_character_assignments() or [])
        except Exception:
            assignments = []
        scoped = [a for a in assignments if str(a.get("episode_id") or "") == episode_hint] if episode_hint else []
        return {
            "assignments_total": len(assignments),
            "assignments_episode": len(scoped),
            "segment_assignments_episode": sum(1 for a in scoped if str(a.get("source_type") or "") == "segment"),
            "cue_assignments_episode": sum(1 for a in scoped if str(a.get("source_type") or "") == "cue"),
        }

    def _undo_snapshot(self) -> dict[str, Any]:
        stack = self._safe_call(self._get_undo_stack)
        if stack is None:
            return {"count": 0, "index": 0, "can_undo": False, "can_redo": False}
        return {
            "count": int(stack.count()) if hasattr(stack, "count") else 0,
            "index": int(stack.index()) if hasattr(stack, "index") else 0,
            "can_undo": bool(stack.canUndo()) if hasattr(stack, "canUndo") else False,
            "can_redo": bool(stack.canRedo()) if hasattr(stack, "canRedo") else False,
        }

    def _preparer_dirty(self) -> bool:
        preparer_tab = self._safe_call(self._get_preparer_tab)
        if preparer_tab is None or not hasattr(preparer_tab, "has_unsaved_changes"):
            return False
        try:
            return bool(preparer_tab.has_unsaved_changes())
        except Exception:
            return False

    @staticmethod
    def _project_loaded(store: object | None, db: object | None) -> bool:
        """Retourne True uniquement si le projet courant est effectivement exploitable."""
        if store is None or db is None:
            return False

        try:
            root_dir = Path(getattr(store, "root_dir"))
        except Exception:
            return False
        if not root_dir.is_dir():
            return False
        if not (root_dir / "config.toml").is_file():
            return False

        if not hasattr(store, "get_db_path"):
            return False
        try:
            expected_db_path = Path(store.get_db_path()).resolve()
        except Exception:
            return False

        try:
            current_db_path = Path(getattr(db, "db_path")).resolve()
        except Exception:
            return False
        if current_db_path != expected_db_path:
            return False
        if not expected_db_path.is_file():
            return False

        if not hasattr(db, "get_schema_version"):
            return False
        try:
            return int(db.get_schema_version()) > 0
        except Exception:
            return False

    def _build_snapshot(self) -> dict[str, Any]:
        store = self._safe_call(self._get_store)
        db = self._safe_call(self._get_db)
        episodes = self._get_context_episode_map()

        non_empty = sorted({value for value in episodes.values() if value})
        context_consistent = len(non_empty) <= 1
        context_complete = all(bool(value) for value in episodes.values())
        episode_hint = non_empty[0] if len(non_empty) == 1 else ""

        alignment = self._alignment_snapshot()
        if not episode_hint and alignment.get("episode_id"):
            episode_hint = str(alignment.get("episode_id"))

        return {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "project_loaded": self._project_loaded(store, db),
            "episodes": episodes,
            "context_consistent": context_consistent,
            "context_complete": context_complete,
            "episode_hint": episode_hint,
            "preparer_dirty": self._preparer_dirty(),
            "alignment": alignment,
            "propagation": self._propagation_snapshot(episode_hint),
            "undo": self._undo_snapshot(),
        }

    def _render_snapshot(self, snapshot: dict[str, Any]) -> str:
        episodes = snapshot.get("episodes", {})
        align = snapshot.get("alignment", {})
        prop = snapshot.get("propagation", {})
        undo = snapshot.get("undo", {})

        lines = [
            f"Generated at: {snapshot.get('generated_at', '')}",
            "",
            f"Project loaded: {'yes' if snapshot.get('project_loaded') else 'no'}",
            f"Context consistent: {'yes' if snapshot.get('context_consistent') else 'no'}",
            f"Context complete: {'yes' if snapshot.get('context_complete') else 'no'}",
            f"Episode focus: {snapshot.get('episode_hint') or '-'}",
            "",
            "KPI legend:",
            "  - Project loaded: projet ouvre avec root/config/db/schema valides.",
            "  - Context consistent: vues non vides sur le meme episode.",
            "  - Episode focus: episode commun; '-' si ambigu.",
            "",
            "Episode by view:",
            f"  - Inspecteur: {episodes.get('inspecteur') or '-'}",
            f"  - Preparer: {episodes.get('preparer') or '-'}",
            f"  - Alignement: {episodes.get('alignement') or '-'}",
            f"  - Personnages: {episodes.get('personnages') or '-'}",
            "",
            "Preparer state:",
            f"  - Dirty draft: {'yes' if snapshot.get('preparer_dirty') else 'no'}",
            "",
            "Alignment state:",
            f"  - Episode: {align.get('episode_id') or '-'}",
            f"  - Runs available: {align.get('run_count', 0)}",
            f"  - Selected run: {align.get('selected_run') or '-'}",
            f"  - Run segment_kind: {align.get('selected_run_segment_kind') or '-'}",
            f"  - Segment filter: {align.get('selected_segment_filter') or '-'}",
            f"  - Pivot lang: {align.get('pivot_lang') or '-'}",
            f"  - Target lang: {align.get('target_lang') or '-'}",
            "",
            "Propagation state:",
            f"  - Assignments total: {prop.get('assignments_total', 0)}",
            f"  - Assignments (episode): {prop.get('assignments_episode', 0)}",
            f"  - Segment assignments (episode): {prop.get('segment_assignments_episode', 0)}",
            f"  - Cue assignments (episode): {prop.get('cue_assignments_episode', 0)}",
            "",
            "Undo/Redo state:",
            f"  - Undo actions: {undo.get('count', 0)}",
            f"  - Stack index: {undo.get('index', 0)}",
            f"  - Can undo: {'yes' if undo.get('can_undo') else 'no'}",
            f"  - Can redo: {'yes' if undo.get('can_redo') else 'no'}",
        ]
        return "\n".join(lines)

    def refresh(self) -> None:
        """Rafraichit la synthese transverse."""
        if self._refresh_in_progress:
            return
        self._refresh_in_progress = True
        try:
            snapshot = self._build_snapshot()
            self.summary_edit.setPlainText(self._render_snapshot(snapshot))
            self.kpi_project_label.setText(
                f"Project loaded: {'yes' if snapshot.get('project_loaded') else 'no'}"
            )
            self.kpi_context_label.setText(
                f"Context consistent: {'yes' if snapshot.get('context_consistent') else 'no'}"
            )
            self.kpi_episode_label.setText(
                f"Episode focus: {snapshot.get('episode_hint') or '-'}"
            )
        finally:
            self._refresh_in_progress = False
