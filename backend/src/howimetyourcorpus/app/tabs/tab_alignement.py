"""Onglet Alignement : run par épisode, table des liens, accepter/rejeter, exports + Undo/Redo (Basse Priorité #3)."""

from __future__ import annotations

import logging
from typing import Callable

from PySide6.QtCore import QPoint, Qt, QSettings
from PySide6.QtGui import QUndoStack
from PySide6.QtWidgets import (
    QCheckBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QMenu,
    QComboBox,
    QPushButton,
    QSpinBox,
    QSplitter,
    QTableView,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.app.dialogs.edit_align_link import EditAlignLinkDialog
from howimetyourcorpus.app.models_qt import AlignLinksTableModel
from howimetyourcorpus.app.tabs.alignement_actions import AlignmentActionsController
from howimetyourcorpus.core.align import (
    format_segment_kind_label,
    normalize_segment_kind,
    parse_run_segment_kind,
)
from howimetyourcorpus.app.ui_utils import require_project_and_db, confirm_action
from howimetyourcorpus.app.widgets import AlignStatsWidget

logger = logging.getLogger(__name__)


class AlignmentTabWidget(QWidget):
    """Widget de l'onglet Alignement : épisode, run, table liens, lancer alignement, exports + Undo/Redo (BP3)."""

    def __init__(
        self,
        get_store: Callable[[], object],
        get_db: Callable[[], object],
        run_job: Callable[[list], None],
        undo_stack: QUndoStack | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._run_job = run_job
        self.undo_stack = undo_stack  # Basse Priorité #3
        self._actions_controller = AlignmentActionsController(self, logger)

        layout = QVBoxLayout(self)
        row = QHBoxLayout()
        row.addWidget(QLabel("Épisode:"))
        self.align_episode_combo = QComboBox()
        self.align_episode_combo.currentIndexChanged.connect(self._on_episode_changed)
        row.addWidget(self.align_episode_combo)
        row.addWidget(QLabel("Run:"))
        self.align_run_combo = QComboBox()
        self.align_run_combo.currentIndexChanged.connect(self._on_run_changed)
        row.addWidget(self.align_run_combo)
        row.addWidget(QLabel("Segments:"))
        self.align_segment_kind_combo = QComboBox()
        self.align_segment_kind_combo.addItem("Phrases", "sentence")
        self.align_segment_kind_combo.addItem("Tours", "utterance")
        self.align_segment_kind_combo.setToolTip(
            "Type de segments transcript à aligner avec les cues (phrases ou tours)."
        )
        row.addWidget(self.align_segment_kind_combo)
        row.addWidget(QLabel("Pivot:"))
        self.align_pivot_lang_combo = QComboBox()
        self.align_pivot_lang_combo.setToolTip(
            "Langue des cues pivot utilisées pour l'alignement segment↔cue."
        )
        self.align_pivot_lang_combo.currentIndexChanged.connect(self._on_pivot_lang_changed)
        row.addWidget(self.align_pivot_lang_combo)
        row.addWidget(QLabel("Cible:"))
        self.align_target_lang_combo = QComboBox()
        self.align_target_lang_combo.setToolTip(
            "Langue cible à aligner depuis le pivot (cue pivot ↔ cue cible)."
        )
        row.addWidget(self.align_target_lang_combo)
        self.align_run_btn = QPushButton("Lancer alignement")
        self.align_run_btn.clicked.connect(self._run_align_episode)
        row.addWidget(self.align_run_btn)
        self.align_delete_run_btn = QPushButton("Supprimer ce run")
        self.align_delete_run_btn.setToolTip("Supprime le run sélectionné et tous ses liens. Annulable avec Ctrl+Z.")
        self.align_delete_run_btn.clicked.connect(self._delete_current_run)
        row.addWidget(self.align_delete_run_btn)
        self.align_by_similarity_cb = QCheckBox("Forcer alignement par similarité")
        self.align_by_similarity_cb.setToolTip(
            "Ignorer les timecodes et apparier EN↔cible par similarité textuelle (utile si timecodes absents ou peu fiables)."
        )
        row.addWidget(self.align_by_similarity_cb)
        self.export_align_btn = QPushButton("Exporter aligné")
        self.export_align_btn.clicked.connect(self._export_alignment)
        row.addWidget(self.export_align_btn)
        self.export_parallel_btn = QPushButton("Exporter concordancier parallèle")
        self.export_parallel_btn.clicked.connect(self._export_parallel_concordance)
        row.addWidget(self.export_parallel_btn)
        self.align_group_btn = QPushButton("Générer groupes")
        self.align_group_btn.setToolTip(
            "Construit des groupes multi-langues par personnage à partir du run (non destructif)."
        )
        self.align_group_btn.clicked.connect(self._generate_alignment_groups)
        row.addWidget(self.align_group_btn)
        self.export_grouped_btn = QPushButton("Exporter groupes alignés")
        self.export_grouped_btn.setToolTip(
            "Exporte le concordancier à partir des groupes multi-langues générés (ou les génère si absents)."
        )
        self.export_grouped_btn.clicked.connect(self._export_grouped_alignment)
        row.addWidget(self.export_grouped_btn)
        self.align_report_btn = QPushButton("Rapport HTML")
        self.align_report_btn.clicked.connect(self._export_align_report)
        row.addWidget(self.align_report_btn)
        # Phase 7 HP4 : Bouton "Stats" supprimé (remplacé par panneau permanent)
        self.align_accepted_only_cb = QCheckBox("Liens acceptés uniquement")
        self.align_accepted_only_cb.setToolTip(
            "Export concordancier et rapport HTML : ne considérer que les liens acceptés"
        )
        row.addWidget(self.align_accepted_only_cb)
        layout.addLayout(row)
        help_label = QLabel(
            "Flux : 1) Onglet Sous-titres : importer au moins une piste pivot/cible. "
            "2) Option A : segmenter l'épisode (transcript → segments phrases/tours) ; Option B : mode SRT-only (pas de segments, alignement cue↔cue pivot/cible). "
            "3) Ici : choisir Segment (Phrases ou Tours), puis « Lancer alignement » crée un run (segment↔cue pivot si segments disponibles, puis cue pivot↔cue cible). "
            "Un run = un calcul d'alignement ; vous pouvez en relancer un autre ou supprimer un run. "
            "Clic droit sur une ligne : Accepter, Rejeter, Modifier la cible."
        )
        help_label.setStyleSheet("color: gray; font-size: 0.85em;")
        help_label.setWordWrap(True)
        help_label.setMaximumHeight(44)
        help_label.setToolTip(
            "Segment = phrase du transcript (Phrases) ou tour de parole (Tours, une ligne par réplique). Cue pivot = réplique SRT. Cue cible = réplique SRT autre langue."
        )
        layout.addWidget(help_label)
        
        # Moyenne Priorité #4 : Actions bulk alignement
        bulk_row = QHBoxLayout()
        bulk_row.addWidget(QLabel("Actions bulk:"))
        self.bulk_accept_btn = QPushButton("Accepter tous > seuil")
        self.bulk_accept_btn.setToolTip("Accepte automatiquement tous les liens avec confidence > seuil")
        self.bulk_accept_btn.clicked.connect(self._bulk_accept)
        bulk_row.addWidget(self.bulk_accept_btn)
        
        self.bulk_reject_btn = QPushButton("Rejeter tous < seuil")
        self.bulk_reject_btn.setToolTip("Rejette automatiquement tous les liens avec confidence < seuil")
        self.bulk_reject_btn.clicked.connect(self._bulk_reject)
        bulk_row.addWidget(self.bulk_reject_btn)
        
        bulk_row.addWidget(QLabel("Seuil:"))
        self.bulk_threshold_spin = QSpinBox()
        self.bulk_threshold_spin.setRange(0, 100)
        self.bulk_threshold_spin.setValue(80)
        self.bulk_threshold_spin.setSuffix("%")
        self.bulk_threshold_spin.setToolTip("Seuil de confidence pour les actions bulk (0-100%)")
        bulk_row.addWidget(self.bulk_threshold_spin)
        bulk_row.addStretch()
        layout.addLayout(bulk_row)
        
        # Phase 7 HP4 : Splitter horizontal (table à gauche, stats à droite)
        self.main_splitter = QSplitter(Qt.Orientation.Horizontal)
        
        self.align_table = QTableView()
        self.align_table.setToolTip("Clic droit : Accepter, Rejeter ou Modifier la cible (alignement manuel).")
        self.align_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.align_table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.align_table.customContextMenuRequested.connect(self._table_context_menu)
        
        # Phase 7 HP4 : Widget stats permanent
        self.stats_widget = AlignStatsWidget()
        self.stats_widget.setMaximumWidth(250)
        
        self.main_splitter.addWidget(self.align_table)
        self.main_splitter.addWidget(self.stats_widget)
        self.main_splitter.setStretchFactor(0, 3)  # Table prend 75%
        self.main_splitter.setStretchFactor(1, 1)  # Stats prend 25%
        
        layout.addWidget(self.main_splitter, 1)
        self._restore_align_splitter()
        self._refresh_language_combos()

    def _restore_align_splitter(self) -> None:
        """Restaure les proportions du splitter table | stats depuis QSettings."""
        settings = QSettings("HIMYC", "AlignmentTab")
        val = settings.value("mainSplitter")
        if isinstance(val, (list, tuple)) and len(val) >= 2:
            try:
                self.main_splitter.setSizes([int(x) for x in val[:2]])
            except (TypeError, ValueError) as exc:
                logger.debug("Invalid AlignmentTab splitter state %r: %s", val, exc)

    def save_state(self) -> None:
        """Sauvegarde les proportions du splitter (appelé à la fermeture de l'application)."""
        settings = QSettings("HIMYC", "AlignmentTab")
        settings.setValue("mainSplitter", self.main_splitter.sizes())

    def refresh(self) -> None:
        """Recharge la liste des épisodes et des runs (préserve la sélection d'épisode si possible)."""
        current_episode_id = self.align_episode_combo.currentData()
        self.align_episode_combo.clear()
        self._refresh_language_combos()
        store = self._get_store()
        if not store:
            return
        index = store.load_series_index()
        if index and index.episodes:
            for e in index.episodes:
                self.align_episode_combo.addItem(f"{e.episode_id} - {e.title}", e.episode_id)
            if current_episode_id:
                for i in range(self.align_episode_combo.count()):
                    if self.align_episode_combo.itemData(i) == current_episode_id:
                        self.align_episode_combo.setCurrentIndex(i)
                        break
        self._on_episode_changed()

    def set_episode_and_segment_kind(self, episode_id: str, segment_kind: str = "sentence") -> None:
        """Sélectionne épisode + kind (utilisé par le handoff depuis Préparer)."""
        sk = normalize_segment_kind(segment_kind)
        idx_sk = self.align_segment_kind_combo.findData(sk)
        if idx_sk >= 0:
            self.align_segment_kind_combo.setCurrentIndex(idx_sk)
        for i in range(self.align_episode_combo.count()):
            if self.align_episode_combo.itemData(i) == episode_id:
                self.align_episode_combo.setCurrentIndex(i)
                break
        self._on_episode_changed()

    def _load_project_languages(self) -> list[str]:
        store = self._get_store()
        raw = (
            store.load_project_languages()
            if store and hasattr(store, "load_project_languages")
            else ["en", "fr"]
        )
        out: list[str] = []
        seen: set[str] = set()
        for lang in raw or []:
            key = str(lang or "").strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(key)
        if not out:
            out = ["en", "fr"]
        return out

    def _refresh_language_combos(self) -> None:
        current_pivot = (
            self.align_pivot_lang_combo.currentData()
            or self.align_pivot_lang_combo.currentText()
            or "en"
        )
        current_target = (
            self.align_target_lang_combo.currentData()
            or self.align_target_lang_combo.currentText()
            or ""
        )
        langs = self._load_project_languages()
        self.align_pivot_lang_combo.blockSignals(True)
        self.align_pivot_lang_combo.clear()
        for lang in langs:
            self.align_pivot_lang_combo.addItem(lang.upper(), lang)
        idx = self.align_pivot_lang_combo.findData(current_pivot)
        if idx < 0:
            idx = self.align_pivot_lang_combo.findData("en")
        self.align_pivot_lang_combo.setCurrentIndex(idx if idx >= 0 else 0)
        self.align_pivot_lang_combo.blockSignals(False)
        self._refresh_target_lang_combo(preferred=str(current_target or ""))

    def _refresh_target_lang_combo(self, preferred: str = "") -> None:
        pivot_lang = (
            self.align_pivot_lang_combo.currentData()
            or self.align_pivot_lang_combo.currentText()
            or "en"
        )
        candidates = [lang for lang in self._load_project_languages() if lang != pivot_lang]
        self.align_target_lang_combo.blockSignals(True)
        self.align_target_lang_combo.clear()
        self.align_target_lang_combo.addItem("Aucune", "")
        for lang in candidates:
            self.align_target_lang_combo.addItem(lang.upper(), lang)
        idx = self.align_target_lang_combo.findData(preferred)
        if idx < 0 and "fr" in candidates:
            idx = self.align_target_lang_combo.findData("fr")
        self.align_target_lang_combo.setCurrentIndex(idx if idx >= 0 else 0)
        self.align_target_lang_combo.blockSignals(False)

    def _on_pivot_lang_changed(self) -> None:
        current_target = (
            self.align_target_lang_combo.currentData()
            or self.align_target_lang_combo.currentText()
            or ""
        )
        self._refresh_target_lang_combo(preferred=str(current_target or ""))

    def _on_episode_changed(self) -> None:
        self.align_run_combo.clear()
        eid = self.align_episode_combo.currentData()
        db = self._get_db()
        if not eid or not db:
            self._fill_links()
            return
        runs = db.get_align_runs_for_episode(eid)
        for r in runs:
            run_id = r.get("align_run_id", "")
            created = r.get("created_at", "")[:19] if r.get("created_at") else ""
            params_json = r.get("params_json")
            segment_kind_label = ""
            if params_json:
                parsed_kind, is_valid_payload = parse_run_segment_kind(
                    params_json,
                    run_id=run_id,
                    logger_obj=logger,
                )
                if is_valid_payload:
                    segment_kind_label = format_segment_kind_label(parsed_kind)
            self.align_run_combo.addItem(f"{run_id}{segment_kind_label} ({created})", run_id)
        self._on_run_changed()

    def _on_run_changed(self) -> None:
        run_id = self.align_run_combo.currentData()
        self.align_delete_run_btn.setEnabled(bool(run_id))
        self._fill_links()
        self._update_stats()  # Phase 7 HP4 : Mettre à jour stats panneau
    
    def _update_stats(self) -> None:
        """Phase 7 HP4 : Met à jour le panneau stats permanent."""
        eid = self.align_episode_combo.currentData()
        run_id = self.align_run_combo.currentData()
        db = self._get_db()
        
        if not eid or not run_id or not db:
            self.stats_widget.clear_stats()
            return
        
        try:
            status_filter = "accepted" if self.align_accepted_only_cb.isChecked() else None
            stats = db.get_align_stats_for_run(eid, run_id, status_filter=status_filter)
            self.stats_widget.update_stats(stats)
        except Exception:
            logger.exception("Update stats widget")
            self.stats_widget.clear_stats()

    @require_project_and_db
    def _delete_current_run(self) -> None:
        self._actions_controller.delete_current_run(
            message_box=QMessageBox,
            confirm_action_fn=confirm_action,
        )
    
    @require_project_and_db
    def _bulk_accept(self) -> None:
        """Moyenne Priorité #4 : Accepte tous les liens avec confidence > seuil + Undo/Redo (BP3)."""
        self._actions_controller.bulk_accept(
            message_box=QMessageBox,
            confirm_action_fn=confirm_action,
        )
    
    @require_project_and_db
    def _bulk_reject(self) -> None:
        """Moyenne Priorité #4 : Rejette tous les liens avec confidence < seuil + Undo/Redo (BP3)."""
        self._actions_controller.bulk_reject(
            message_box=QMessageBox,
            confirm_action_fn=confirm_action,
        )

    def _fill_links(self) -> None:
        eid = self.align_episode_combo.currentData()
        run_id = self.align_run_combo.currentData()
        model = AlignLinksTableModel()
        db = self._get_db()
        if not db or not eid:
            self.align_table.setModel(model)
            return
        links = db.query_alignment_for_episode(eid, run_id=run_id)
        model.set_links(links, db, episode_id=eid)
        self.align_table.setModel(model)

    def _table_context_menu(self, pos: QPoint) -> None:
        self._actions_controller.table_context_menu(
            pos,
            menu_cls=QMenu,
            edit_dialog_cls=EditAlignLinkDialog,
        )

    @require_project_and_db
    def _run_align_episode(self) -> None:
        self._actions_controller.run_align_episode(message_box=QMessageBox)

    @require_project_and_db
    def _generate_alignment_groups(self) -> None:
        self._actions_controller.generate_alignment_groups(message_box=QMessageBox)

    @require_project_and_db
    def _export_grouped_alignment(self) -> None:
        self._actions_controller.export_grouped_alignment(
            file_dialog=QFileDialog,
            message_box=QMessageBox,
        )

    @require_project_and_db
    def _export_alignment(self) -> None:
        self._actions_controller.export_alignment(
            file_dialog=QFileDialog,
            message_box=QMessageBox,
        )

    @require_project_and_db
    def _export_parallel_concordance(self) -> None:
        self._actions_controller.export_parallel_concordance(
            file_dialog=QFileDialog,
            message_box=QMessageBox,
        )

    @require_project_and_db
    def _export_align_report(self) -> None:
        self._actions_controller.export_align_report(
            file_dialog=QFileDialog,
            message_box=QMessageBox,
        )
