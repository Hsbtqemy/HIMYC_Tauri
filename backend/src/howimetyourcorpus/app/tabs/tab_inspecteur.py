"""Onglet Inspecteur : RAW/CLEAN, segments, normalisation, export segments, notes."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt, QSettings
from PySide6.QtGui import QTextCursor
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.app.tabs.cta_recommender import EpisodeState, recommend
from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE
from howimetyourcorpus.core.normalize.profiles import (
    get_all_profile_ids,
    get_profile,
    format_profile_rules_summary,
)
from howimetyourcorpus.core.pipeline.tasks import NormalizeEpisodeStep, SegmentEpisodeStep
from howimetyourcorpus.core.export_utils import (
    export_segments_txt,
    export_segments_csv,
    export_segments_tsv,
    export_segments_docx,
    export_segments_srt_like,
)
from howimetyourcorpus.core.normalize.profiles import PROFILES
from howimetyourcorpus.app.ui_utils import require_project, require_project_and_db

logger = logging.getLogger(__name__)


class InspectorTabWidget(QWidget):
    """Widget de l'onglet Inspecteur : épisode, RAW/CLEAN, segments, normaliser, segmenter, export, notes."""

    def __init__(
        self,
        get_store: Callable[[], object],
        get_db: Callable[[], object],
        get_config: Callable[[], object],
        run_job: Callable[[list], None],
        show_status: Callable[[str, int], None],
        get_similarity_mode: Callable[[], bool] | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._get_config = get_config
        self._run_job = run_job
        self._show_status = show_status
        self._get_similarity_mode = get_similarity_mode
        self._current_episode_id: str | None = None
        self._avance_expanded: bool = False

        layout = QVBoxLayout(self)

        # --- Sélecteur d'épisode (masqué en mode combiné §15.4) ---
        ep_row = QHBoxLayout()
        self._inspect_episode_label = QLabel("Épisode:")
        ep_row.addWidget(self._inspect_episode_label)
        self.inspect_episode_combo = QComboBox()
        self.inspect_episode_combo.currentIndexChanged.connect(self._load_episode)
        ep_row.addWidget(self.inspect_episode_combo)
        # INS-005 — Sélecteur Source (transcript / pistes SRT) — contrôle la disponibilité des actions
        self._file_label = QLabel("Source :")
        ep_row.addWidget(self._file_label)
        self.inspect_file_combo = QComboBox()
        self.inspect_file_combo.setMinimumWidth(130)
        self.inspect_file_combo.setToolTip(
            "Source active : pilote le contenu affiché ET les actions disponibles.\n"
            "• Transcript : zone de travail = RAW / CLEAN. Actions Normaliser et Découper actives.\n"
            "• SRT — <lang> : zone de travail = contenu brut de la piste SRT. Actions Produire désactivées.\n"
            "Les options SRT ne sont disponibles que si des pistes ont été importées via Outils SRT ▸."
        )
        self.inspect_file_combo.addItem("Transcript", "transcript")
        self.inspect_file_combo.currentIndexChanged.connect(self._on_source_changed)
        ep_row.addWidget(self.inspect_file_combo)
        ep_row.addStretch()
        layout.addLayout(ep_row)

        # --- Splitter principal : volet gauche (contrôles) | volet droit (RAW / CLEAN) ---
        self._outer_split = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(self._outer_split, 1)

        # ── Volet gauche : tous les contrôles ──────────────────────────────
        self._controls_panel = QWidget()
        self._controls_panel.setMinimumWidth(220)
        controls_layout = QVBoxLayout(self._controls_panel)
        controls_layout.setContentsMargins(0, 4, 0, 0)

        # Bloc Consulter : navigation et lecture
        consulter_group = QGroupBox("Consulter")
        consulter_layout = QHBoxLayout(consulter_group)
        consulter_layout.addWidget(QLabel("Vue:"))
        self.inspect_view_combo = QComboBox()
        self.inspect_view_combo.addItem("Épisode", "episode")
        self.inspect_view_combo.addItem("Segments", "segments")
        self.inspect_view_combo.currentIndexChanged.connect(self._switch_view)
        consulter_layout.addWidget(self.inspect_view_combo)
        self._kind_label = QLabel("Type:")
        consulter_layout.addWidget(self._kind_label)
        self.inspect_kind_combo = QComboBox()
        self.inspect_kind_combo.addItem("Tous", "")
        self.inspect_kind_combo.addItem("Phrases", "sentence")
        self.inspect_kind_combo.addItem("Tours", "utterance")
        self.inspect_kind_combo.setToolTip("Filtre la liste segments par type (phrases/tours de parole)")
        self.inspect_kind_combo.currentIndexChanged.connect(self._on_kind_filter_changed)
        consulter_layout.addWidget(self.inspect_kind_combo)
        self._goto_label = QLabel("Aller à:")
        consulter_layout.addWidget(self._goto_label)
        self.segment_goto_edit = QLineEdit()
        self.segment_goto_edit.setPlaceholderText("#N")
        self.segment_goto_edit.setMaximumWidth(60)
        self.segment_goto_edit.setToolTip("Entrez le numéro de segment (ex: 42) et appuyez sur Entrée")
        self.segment_goto_edit.returnPressed.connect(self._goto_segment)
        consulter_layout.addWidget(self.segment_goto_edit)
        self.segment_goto_btn = QPushButton("→")
        self.segment_goto_btn.setMaximumWidth(40)
        self.segment_goto_btn.setToolTip("Aller au segment #N")
        self.segment_goto_btn.clicked.connect(self._goto_segment)
        consulter_layout.addWidget(self.segment_goto_btn)
        consulter_layout.addStretch()
        controls_layout.addWidget(consulter_group)

        # Bloc Produire : actions de transformation
        produire_group = QGroupBox("Produire")
        produire_layout = QVBoxLayout(produire_group)
        produire_row1 = QHBoxLayout()
        self.inspect_segment_btn = QPushButton("Découper en segments")
        self.inspect_segment_btn.clicked.connect(self._run_segment)
        produire_row1.addWidget(self.inspect_segment_btn)
        self.inspect_export_segments_btn = QPushButton("Exporter les segments")
        self.inspect_export_segments_btn.clicked.connect(self._export_segments)
        produire_row1.addWidget(self.inspect_export_segments_btn)
        produire_row1.addStretch()
        produire_layout.addLayout(produire_row1)
        produire_row2 = QHBoxLayout()
        produire_row2.addWidget(QLabel("Profil:"))
        self.inspect_profile_combo = QComboBox()
        self.inspect_profile_combo.addItems(list(PROFILES.keys()))
        self.inspect_profile_combo.setToolTip(
            "Profil pour « Normaliser cet épisode ». Priorité : préféré épisode > défaut source (Profils) > config projet."
        )
        self.inspect_profile_combo.currentTextChanged.connect(self._update_profile_rules_preview)
        produire_row2.addWidget(self.inspect_profile_combo)
        self.inspect_norm_btn = QPushButton("Normaliser cet épisode")
        self.inspect_norm_btn.clicked.connect(self._run_normalize)
        produire_row2.addWidget(self.inspect_norm_btn)
        produire_row2.addStretch()
        produire_layout.addLayout(produire_row2)
        controls_layout.addWidget(produire_group)

        # Bloc Avancé : gestion des profils (replié par défaut)
        self._avance_toggle_btn = QPushButton("Avancé ▸")
        self._avance_toggle_btn.setFlat(True)
        self._avance_toggle_btn.setToolTip(
            "Profil appliqué à RAW → CLEAN. Priorité : préféré épisode > défaut source (Profils) > config projet."
        )
        self._avance_toggle_btn.clicked.connect(self._toggle_avance)
        controls_layout.addWidget(self._avance_toggle_btn)

        self._avance_group = QGroupBox()
        self._avance_group.setVisible(False)
        avance_layout = QVBoxLayout(self._avance_group)
        avance_row = QHBoxLayout()
        self.inspect_set_preferred_profile_btn = QPushButton("Définir comme préféré pour cet épisode")
        self.inspect_set_preferred_profile_btn.setToolTip(
            "Mémorise ce profil pour cet épisode. Utilisé en priorité lors du batch (Corpus) et ici."
        )
        self.inspect_set_preferred_profile_btn.clicked.connect(self._set_episode_preferred_profile)
        avance_row.addWidget(self.inspect_set_preferred_profile_btn)
        self.inspect_manage_profiles_btn = QPushButton("Gérer les profils…")
        self.inspect_manage_profiles_btn.setToolTip(
            "Ouvre le dialogue de gestion des profils : créer, modifier, supprimer les profils personnalisés (profiles.json)."
        )
        self.inspect_manage_profiles_btn.clicked.connect(self._open_profiles_dialog)
        avance_row.addWidget(self.inspect_manage_profiles_btn)
        avance_row.addStretch()
        avance_layout.addLayout(avance_row)
        avance_layout.addWidget(QLabel("Aperçu des règles du profil :"))
        self.inspect_profile_rules_preview = QPlainTextEdit()
        self.inspect_profile_rules_preview.setReadOnly(True)
        self.inspect_profile_rules_preview.setMaximumHeight(140)
        self.inspect_profile_rules_preview.setPlaceholderText("Sélectionnez un profil…")
        self.inspect_profile_rules_preview.setToolTip("Résumé des options du profil sélectionné (lecture seule).")
        avance_layout.addWidget(self.inspect_profile_rules_preview)
        controls_layout.addWidget(self._avance_group)
        self._update_profile_rules_preview()

        # Statut Prêt alignement (US-104) + CTA (US-302)
        self.pret_alignement_label = QLabel("Prêt alignement : —")
        self.pret_alignement_label.setToolTip(
            "Prêt si CLEAN + segments + tracks SRT sont présents pour cet épisode.\n"
            "« tracks SRT » = pistes importées via le bouton Outils SRT ▸ en haut de l'Inspecteur."
        )
        controls_layout.addWidget(self.pret_alignement_label)

        self.cta_label = QLabel("Prochaine action : —")
        self.cta_label.setToolTip(
            "Recommandation CTA basée sur l'état réel de l'épisode (matrice US-301)."
        )
        self.cta_label.setWordWrap(True)
        controls_layout.addWidget(self.cta_label)

        self.inspect_stats_label = QLabel("Stats: —")
        controls_layout.addWidget(self.inspect_stats_label)
        self.merge_examples_edit = QPlainTextEdit()
        self.merge_examples_edit.setReadOnly(True)
        self.merge_examples_edit.setMaximumHeight(120)
        controls_layout.addWidget(QLabel("Exemples de fusions:"))
        controls_layout.addWidget(self.merge_examples_edit)
        controls_layout.addWidget(QLabel("Notes — à vérifier / à affiner (sauvegardé par épisode) :"))
        self.inspect_notes_edit = QPlainTextEdit()
        self.inspect_notes_edit.setPlaceholderText(
            "Points à vérifier, à changer, à affiner pour cet épisode…"
        )
        self.inspect_notes_edit.setMaximumHeight(100)
        controls_layout.addWidget(self.inspect_notes_edit)
        controls_layout.addStretch()

        self._outer_split.addWidget(self._controls_panel)

        # ── Volet droit : liste segments + RAW + CLEAN côte à côte ─────────
        self.inspect_main_split = QSplitter(Qt.Orientation.Horizontal)
        self.inspect_segments_list = QListWidget()
        self.inspect_segments_list.setMinimumWidth(80)
        self.inspect_segments_list.currentItemChanged.connect(self._on_segment_selected)
        self.raw_edit = QPlainTextEdit()
        self.raw_edit.setPlaceholderText("RAW")
        self.raw_edit.setMinimumHeight(60)
        self.clean_edit = QPlainTextEdit()
        self.clean_edit.setPlaceholderText("CLEAN")
        self.clean_edit.setMinimumHeight(60)
        self.inspect_main_split.addWidget(self.inspect_segments_list)
        self.inspect_main_split.addWidget(self.raw_edit)
        self.inspect_main_split.addWidget(self.clean_edit)
        self.inspect_main_split.setStretchFactor(1, 1)
        self.inspect_main_split.setStretchFactor(2, 1)
        self._outer_split.addWidget(self.inspect_main_split)
        self._outer_split.setStretchFactor(0, 0)
        self._outer_split.setStretchFactor(1, 1)

        self._restore_splitter_sizes()
        self.inspect_segments_list.setVisible(False)
        self.inspect_kind_combo.setVisible(False)
        self._kind_label.setVisible(False)
        self._goto_label.setVisible(False)
        self.segment_goto_edit.setVisible(False)
        self.segment_goto_btn.setVisible(False)
        self._update_action_buttons()

    def _refresh_file_combo(self, eid: str | None) -> None:
        """INS-005 — Peuple le combo Fichier : Transcript toujours + pistes SRT disponibles."""
        self.inspect_file_combo.blockSignals(True)
        current = self.inspect_file_combo.currentData()
        self.inspect_file_combo.clear()
        self.inspect_file_combo.addItem("Transcript", "transcript")
        if eid:
            db = self._get_db()
            if db:
                try:
                    seen_langs: set[str] = set()
                    for t in db.get_tracks_for_episode(eid):
                        lang = t.get("lang", "")
                        if lang and lang not in seen_langs:
                            seen_langs.add(lang)
                            self.inspect_file_combo.addItem(f"SRT — {lang.upper()}", f"srt_{lang}")
                except Exception:
                    pass
        idx = self.inspect_file_combo.findData(current)
        self.inspect_file_combo.setCurrentIndex(idx if idx >= 0 else 0)
        self.inspect_file_combo.blockSignals(False)

    def _on_source_changed(self) -> None:
        """INS-014 — Déclenché par le combo Source : recharge contenu puis met à jour les actions."""
        self._load_source_content()
        self._update_action_buttons()

    def _load_source_content(self) -> None:
        """INS-014 — Charge dans la zone de travail le contenu correspondant à la source active."""
        eid = self._current_episode_id
        if not eid:
            self.raw_edit.clear()
            self.clean_edit.clear()
            self.raw_edit.setPlaceholderText("RAW")
            self.clean_edit.setPlaceholderText("CLEAN")
            return
        source = self.inspect_file_combo.currentData() or "transcript"
        store = self._get_store()
        if not store:
            return
        if source == "transcript":
            raw = store.load_episode_text(eid, kind="raw")
            clean = store.load_episode_text(eid, kind="clean")
            self.raw_edit.setPlainText(raw)
            self.clean_edit.setPlainText(clean)
            self.raw_edit.setPlaceholderText("RAW")
            self.clean_edit.setPlaceholderText("CLEAN")
        else:
            # source = "srt_<lang>"
            lang = source[4:]
            result = None
            try:
                result = store.load_episode_subtitle_content(eid, lang)
            except Exception:
                pass
            content = result[0] if result else ""
            self.raw_edit.setPlainText(content)
            self.raw_edit.setPlaceholderText(f"SRT — {lang.upper()} (contenu brut)")
            self.clean_edit.clear()
            self.clean_edit.setPlaceholderText("Non applicable — source SRT")

    def _update_action_buttons(self) -> None:
        """US-103/104/302 — Active/désactive les boutons, met à jour Prêt alignement et CTA."""
        eid = self._current_episode_id
        store = self._get_store() if eid else None
        db = self._get_db() if eid else None

        has_raw = bool(eid and store and store.has_episode_raw(eid))
        has_clean = bool(eid and store and store.has_episode_clean(eid))
        has_segments = False
        has_tracks = False
        has_alignment_run = False
        if eid and db:
            try:
                has_segments = bool(db.get_segments_for_episode(eid))
            except Exception:
                pass
            try:
                has_tracks = bool(db.get_tracks_for_episode(eid))
            except Exception:
                pass
            try:
                has_alignment_run = bool(db.get_align_runs_for_episode(eid))
            except Exception:
                pass

        use_similarity = False
        if self._get_similarity_mode is not None:
            try:
                use_similarity = bool(self._get_similarity_mode())
            except Exception:
                pass

        # INS-006 — Source courante (transcript ou srt_<lang>)
        source = self.inspect_file_combo.currentData() if self.inspect_file_combo.count() > 0 else "transcript"
        is_transcript = not source or source == "transcript"

        # Normaliser : nécessite RAW + source transcript
        if not is_transcript:
            self.inspect_norm_btn.setEnabled(False)
            self.inspect_norm_btn.setToolTip(
                "Source SRT sélectionnée — normalisation non applicable. Sélectionnez Transcript."
            )
        else:
            self.inspect_norm_btn.setEnabled(has_raw)
            self.inspect_norm_btn.setToolTip(
                "Applique la normalisation (RAW → CLEAN) à l'épisode affiché, avec le profil choisi."
                if has_raw
                else "Indisponible : aucun texte RAW pour cet épisode. Téléchargez d'abord le transcript."
            )

        # Segmenter : nécessite CLEAN + source transcript
        if not is_transcript:
            self.inspect_segment_btn.setEnabled(False)
            self.inspect_segment_btn.setToolTip(
                "Source SRT sélectionnée — segmentation transcript non applicable. Sélectionnez Transcript."
            )
        else:
            self.inspect_segment_btn.setEnabled(has_clean)
            self.inspect_segment_btn.setToolTip(
                ""
                if has_clean
                else "Indisponible : aucun texte CLEAN pour cet épisode. Normalisez d'abord le transcript."
            )

        # Exporter : nécessite des segments
        self.inspect_export_segments_btn.setEnabled(has_segments)
        self.inspect_export_segments_btn.setToolTip(
            "Exporte les segments de l'épisode affiché : TXT (une ligne par segment), CSV/TSV (colonnes détaillées), "
            "SRT-like (blocs numérotés), Word (.docx)."
            if has_segments
            else "Indisponible : aucun segment pour cet épisode. Lancez d'abord « Découper en segments »."
        )

        # Statut Prêt alignement (US-104)
        manquants = []
        if not has_clean:
            manquants.append("CLEAN")
        if not has_segments:
            manquants.append("segments")
        if not has_tracks:
            manquants.append("tracks SRT")

        if eid is None:
            self.pret_alignement_label.setText("Prêt alignement : —")
        elif not manquants:
            self.pret_alignement_label.setText("Prêt alignement : Oui")
        else:
            self.pret_alignement_label.setText(
                f"Prêt alignement : Non (manquants : {', '.join(manquants)})"
            )

        # CTA Prochaine action recommandée (US-302)
        if eid is None:
            self.cta_label.setText("Prochaine action : —")
        else:
            state = EpisodeState(
                has_raw=has_raw,
                has_clean=has_clean,
                has_segments=has_segments,
                has_tracks=has_tracks,
                has_alignment_run=has_alignment_run,
                use_similarity=use_similarity,
            )
            rec = recommend(state)
            # INS-006 — Si source SRT active, les actions Produire sont désactivées :
            # neutraliser les recommandations qui pointeraient vers ces actions.
            if not is_transcript and rec.action_id in ("normalize_episode", "segment_episode", "segment_or_srt_only"):
                self.cta_label.setText("Prochaine action : Source SRT sélectionnée — Ouvrez l'onglet Alignement pour lancer.")
                self.cta_label.setToolTip(
                    "Mode SRT actif. Les actions Normaliser et Découper ne sont pas disponibles pour cette source.\n"
                    "Sélectionnez « Transcript » dans Source pour accéder à ces actions,\n"
                    "ou ouvrez l'onglet Alignement pour lancer directement avec la piste SRT."
                )
            else:
                self.cta_label.setText(f"Prochaine action : {rec.label}")
                self.cta_label.setToolTip(rec.detail)

    def _restore_splitter_sizes(self) -> None:
        def to_sizes(val) -> list[int] | None:
            if val is None:
                return None
            if isinstance(val, (list, tuple)):
                try:
                    return [int(x) for x in val][:10]
                except (TypeError, ValueError):
                    return None
            if isinstance(val, str):
                try:
                    return [int(x) for x in val.split(",") if x.strip()][:10]
                except ValueError:
                    return None
            return None

        settings = QSettings()
        outer = to_sizes(settings.value("inspecteur/outerSplitter"))
        main = to_sizes(settings.value("inspecteur/mainSplitter"))
        if outer is not None and len(outer) >= 2:
            self._outer_split.setSizes(outer)
        if main is not None and len(main) >= 2:
            self.inspect_main_split.setSizes(main)

    def save_state(self) -> None:
        """Sauvegarde les proportions des splitters et les notes de l'épisode courant (appelé à la fermeture)."""
        settings = QSettings()
        settings.setValue("inspecteur/outerSplitter", self._outer_split.sizes())
        settings.setValue("inspecteur/mainSplitter", self.inspect_main_split.sizes())
        store = self._get_store()
        if self._current_episode_id and store:
            store.save_episode_notes(
                self._current_episode_id,
                self.inspect_notes_edit.toPlainText(),
            )

    def refresh(self) -> None:
        """Recharge la liste des épisodes et l'épisode courant (préserve la sélection si possible)."""
        current_episode_id = self.inspect_episode_combo.currentData()
        self.inspect_episode_combo.clear()
        store = self._get_store()
        if not store:
            return
        index = store.load_series_index()
        if index and index.episodes:
            for e in index.episodes:
                self.inspect_episode_combo.addItem(f"{e.episode_id} - {e.title}", e.episode_id)
            # Restaurer la sélection d'épisode (évite le retour à S01E01 après enregistrement)
            if current_episode_id:
                for i in range(self.inspect_episode_combo.count()):
                    if self.inspect_episode_combo.itemData(i) == current_episode_id:
                        self.inspect_episode_combo.setCurrentIndex(i)
                        break
        self._load_episode()

    def refresh_profile_combo(self, profile_ids: list[str], current: str | None) -> None:
        """Met à jour la liste des profils (après ouverture projet ou dialogue profils)."""
        current_inspect = self.inspect_profile_combo.currentText()
        self.inspect_profile_combo.clear()
        self.inspect_profile_combo.addItems(profile_ids)
        if current_inspect and current_inspect in profile_ids:
            self.inspect_profile_combo.setCurrentText(current_inspect)
        elif current and current in profile_ids:
            self.inspect_profile_combo.setCurrentText(current)

    def set_episode_selector_visible(self, visible: bool) -> None:
        """§15.4 — Masque ou affiche le sélecteur d'épisode (quand intégré dans l'onglet fusionné)."""
        self._inspect_episode_label.setVisible(visible)
        self.inspect_episode_combo.setVisible(visible)

    def set_episode_and_load(self, episode_id: str) -> None:
        """Sélectionne l'épisode donné et charge son contenu (ex. depuis Concordance « Ouvrir dans Inspecteur »)."""
        for i in range(self.inspect_episode_combo.count()):
            if self.inspect_episode_combo.itemData(i) == episode_id:
                self.inspect_episode_combo.setCurrentIndex(i)
                break
        self._load_episode()

    def _load_episode(self) -> None:
        eid = self.inspect_episode_combo.currentData()
        store = self._get_store()
        if not eid or not store:
            self._current_episode_id = None
            self.raw_edit.clear()
            self.clean_edit.clear()
            self.inspect_stats_label.setText("Stats: —")
            self.merge_examples_edit.clear()
            self.inspect_notes_edit.clear()
            self.inspect_segments_list.clear()
            self._refresh_file_combo(None)  # INS-005 — reset à Transcript
            self._update_action_buttons()
            return
        if self._current_episode_id and self._current_episode_id != eid:
            store.save_episode_notes(
                self._current_episode_id,
                self.inspect_notes_edit.toPlainText(),
            )
        self._current_episode_id = eid
        self.inspect_notes_edit.setPlainText(store.load_episode_notes(eid))
        meta = store.load_episode_transform_meta(eid)
        if meta is not None:
            stats = meta.get("raw_lines", 0), meta.get("clean_lines", 0), meta.get("merges", 0)
            self.inspect_stats_label.setText(
                f"Stats: raw_lines={stats[0]}, clean_lines={stats[1]}, merges={stats[2]}"
            )
            examples = meta.get("debug", {}).get("merge_examples", [])
            self.merge_examples_edit.setPlainText(
                "\n".join(
                    f"{x.get('before', '')} | {x.get('after', '')}" for x in examples[:15]
                )
            )
        else:
            self.inspect_stats_label.setText("Stats: —")
            self.merge_examples_edit.clear()
        config = self._get_config()
        episode_preferred = store.load_episode_preferred_profiles()
        source_defaults = store.load_source_profile_defaults()
        index = store.load_series_index()
        ref = (
            next((e for e in (index.episodes or []) if e.episode_id == eid), None)
            if index
            else None
        )
        profile = (
            episode_preferred.get(eid)
            or (source_defaults.get(ref.source_id or "") if ref else None)
            or (config.normalize_profile if config else DEFAULT_NORMALIZE_PROFILE)
        )
        all_ids = get_all_profile_ids(store.load_custom_profiles() if store else None)
        if profile and profile in all_ids:
            self.inspect_profile_combo.setCurrentText(profile)
        self._refresh_file_combo(eid)  # INS-005 — mettre à jour les sources disponibles
        self._load_source_content()    # INS-014 — charger le contenu selon la source active
        self._fill_segments(eid)
        self._update_action_buttons()

    def _toggle_avance(self) -> None:
        self._avance_expanded = not self._avance_expanded
        self._avance_group.setVisible(self._avance_expanded)
        self._avance_toggle_btn.setText("Avancé ▾" if self._avance_expanded else "Avancé ▸")

    def _switch_view(self) -> None:
        is_segments = self.inspect_view_combo.currentData() == "segments"
        self.inspect_segments_list.setVisible(is_segments)
        self.inspect_kind_combo.setVisible(is_segments)
        self._kind_label.setVisible(is_segments)
        self._goto_label.setVisible(is_segments)
        self.segment_goto_edit.setVisible(is_segments)
        self.segment_goto_btn.setVisible(is_segments)
        eid = self.inspect_episode_combo.currentData()
        if eid:
            self._fill_segments(eid)

    def _on_kind_filter_changed(self) -> None:
        """Filtre les segments par kind (appelé par le combo Kind)."""
        eid = self.inspect_episode_combo.currentData()
        if eid:
            self._fill_segments(eid)
    
    def _goto_segment(self) -> None:
        """Moyenne Priorité #3 : Navigation rapide vers segment #N."""
        segment_num_str = self.segment_goto_edit.text().strip()
        if not segment_num_str:
            return
        
        try:
            segment_num = int(segment_num_str)
        except ValueError:
            QMessageBox.warning(self, "Navigation", "Entrez un numéro de segment valide (ex: 42).")
            return
        
        # Rechercher le segment dans la liste
        for i in range(self.inspect_segments_list.count()):
            item = self.inspect_segments_list.item(i)
            seg = item.data(Qt.ItemDataRole.UserRole) if item else None
            if seg and seg.get("n") == segment_num:
                self.inspect_segments_list.setCurrentItem(item)
                self.inspect_segments_list.scrollToItem(item)
                self._on_segment_selected(item)
                self.segment_goto_edit.clear()
                return
        
        QMessageBox.information(
            self,
            "Navigation",
            f"Segment #{segment_num} introuvable.\n\n"
            f"Vérifiez que l'épisode est segmenté et que le numéro existe."
        )

    def _fill_segments(self, episode_id: str) -> None:
        self.inspect_segments_list.clear()
        if self.inspect_view_combo.currentData() != "segments":
            return
        db = self._get_db()
        if not db:
            return
        kind_filter = self.inspect_kind_combo.currentData() or ""
        segments = db.get_segments_for_episode(episode_id, kind=kind_filter if kind_filter else None)
        for s in segments:
            kind = s.get("kind", "")
            n = s.get("n", 0)
            speaker = s.get("speaker_explicit") or ""
            text = (s.get("text") or "")[:60]
            if len((s.get("text") or "")) > 60:
                text += "…"
            if speaker:
                label = f"[{kind}] {n} {speaker}: {text}"
            else:
                label = f"[{kind}] {n}: {text}"
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, s)
            self.inspect_segments_list.addItem(item)

    def _on_segment_selected(self, current: QListWidgetItem | None) -> None:
        if not current:
            return
        seg = current.data(Qt.ItemDataRole.UserRole)
        if not seg:
            return
        start_char = seg.get("start_char", 0)
        end_char = seg.get("end_char", 0)
        text = self.clean_edit.toPlainText()
        cursor = self.clean_edit.textCursor()
        cursor.setPosition(min(start_char, len(text)))
        cursor.setPosition(min(end_char, len(text)), QTextCursor.MoveMode.KeepAnchor)
        self.clean_edit.setTextCursor(cursor)
        self.clean_edit.ensureCursorVisible()

    @require_project
    def _run_normalize(self) -> None:
        # INS-015 — Guard source : normalisation transcript-only (bouton déjà désactivé par _update_action_buttons)
        if (self.inspect_file_combo.currentData() or "transcript") != "transcript":
            return
        eid = self.inspect_episode_combo.currentData()
        store = self._get_store()
        assert store is not None  # garanti par @require_project
        if not eid:
            QMessageBox.warning(self, "Normalisation", "Sélectionnez un épisode.")
            return
        if not store.has_episode_raw(eid):
            QMessageBox.warning(self, "Normalisation", "L'épisode doit d'abord être téléchargé (RAW).")
            return
        profile = self.inspect_profile_combo.currentText() or DEFAULT_NORMALIZE_PROFILE
        self._run_job([NormalizeEpisodeStep(eid, profile)])

    @require_project
    def _set_episode_preferred_profile(self) -> None:
        eid = self.inspect_episode_combo.currentData()
        store = self._get_store()
        assert store is not None  # garanti par @require_project
        if not eid:
            QMessageBox.warning(self, "Profil préféré", "Sélectionnez un épisode.")
            return
        profile = self.inspect_profile_combo.currentText() or DEFAULT_NORMALIZE_PROFILE
        preferred = store.load_episode_preferred_profiles()
        preferred[eid] = profile
        store.save_episode_preferred_profiles(preferred)
        self._show_status(f"Profil « {profile} » défini comme préféré pour {eid}.", 3000)

    def _update_profile_rules_preview(self) -> None:
        """§15.5 — Met à jour la zone « Aperçu des règles du profil » selon le profil sélectionné."""
        profile_id = (self.inspect_profile_combo.currentText() or "").strip()
        if not profile_id:
            self.inspect_profile_rules_preview.clear()
            return
        store = self._get_store()
        custom = store.load_custom_profiles() if store else None
        profile = get_profile(profile_id, custom)
        if profile:
            self.inspect_profile_rules_preview.setPlainText(format_profile_rules_summary(profile))
        else:
            self.inspect_profile_rules_preview.setPlainText(f"Profil « {profile_id} » non trouvé.")

    @require_project
    def _open_profiles_dialog(self) -> None:
        """§15.5 — Ouvre le dialogue de gestion des profils de normalisation."""
        store = self._get_store()
        assert store is not None  # garanti par @require_project
        from howimetyourcorpus.app.dialogs import ProfilesDialog
        dlg = ProfilesDialog(self, store)
        dlg.exec()
        custom = store.load_custom_profiles()
        self.refresh_profile_combo(
            get_all_profile_ids(custom),
            self.inspect_profile_combo.currentText(),
        )
        self._update_profile_rules_preview()

    @require_project_and_db
    def _run_segment(self) -> None:
        # INS-015 — Guard source : segmentation transcript-only (bouton déjà désactivé par _update_action_buttons)
        if (self.inspect_file_combo.currentData() or "transcript") != "transcript":
            return
        eid = self.inspect_episode_combo.currentData()
        store = self._get_store()
        assert store is not None  # garanti par @require_project_and_db
        if not eid:
            QMessageBox.warning(self, "Segmentation", "Sélectionnez un épisode.")
            return
        if not store.has_episode_clean(eid):
            QMessageBox.warning(self, "Segmentation", "L'épisode doit d'abord être normalisé (clean.txt).")
            return
        self._run_job([SegmentEpisodeStep(eid, lang_hint="en")])

    @require_project_and_db
    def _export_segments(self) -> None:
        eid = self.inspect_episode_combo.currentData()
        db = self._get_db()
        if not eid:
            QMessageBox.warning(self, "Export segments", "Sélectionnez un épisode.")
            return
        segments = db.get_segments_for_episode(eid)
        if not segments:
            QMessageBox.warning(
                self,
                "Export segments",
                "Aucun segment pour cet épisode. Lancez d'abord « Découper en segments ».",
            )
            return
        path, selected_filter = QFileDialog.getSaveFileName(
            self,
            "Exporter les segments",
            "",
            "TXT — un segment par ligne (*.txt);;CSV (*.csv);;TSV (*.tsv);;SRT-like (*.srt);;Word (*.docx)",
        )
        if not path:
            return
        path = Path(path)
        if path.suffix.lower() != ".docx" and "Word" in (selected_filter or ""):
            path = path.with_suffix(".docx")
        if path.suffix.lower() != ".srt" and "SRT" in (selected_filter or ""):
            path = path.with_suffix(".srt")
        try:
            if path.suffix.lower() == ".txt" or "TXT" in (selected_filter or ""):
                export_segments_txt(segments, path)
            elif path.suffix.lower() == ".tsv" or "TSV" in (selected_filter or ""):
                export_segments_tsv(segments, path)
            elif path.suffix.lower() == ".srt" or "SRT" in (selected_filter or ""):
                export_segments_srt_like(segments, path)
            elif path.suffix.lower() == ".docx" or "Word" in (selected_filter or ""):
                export_segments_docx(segments, path)
            else:
                export_segments_csv(segments, path)
            QMessageBox.information(
                self, "Export", f"Segments exportés : {len(segments)} segment(s)."
            )
        except Exception as e:
            logger.exception("Export segments Inspecteur")
            QMessageBox.critical(
                self,
                "Erreur export",
                f"Erreur lors de l'export : {e}\n\n"
                "Vérifiez les droits d'écriture, que le fichier n'est pas ouvert ailleurs et l'encodage (UTF-8)."
            )
