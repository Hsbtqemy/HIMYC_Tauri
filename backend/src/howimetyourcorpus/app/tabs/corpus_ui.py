"""Construction UI de l'onglet Corpus."""

from __future__ import annotations

from typing import Any

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QProgressBar,
    QPushButton,
    QTableView,
    QToolButton,
    QTreeView,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.app.models_qt import (
    EpisodesFilterProxyModel,
    EpisodesTableModel,
    EpisodesTreeFilterProxyModel,
    EpisodesTreeModel,
)
from howimetyourcorpus.core.normalize.profiles import PROFILES


class CorpusUiBuilder:
    """Construit les blocs UI de l'onglet Corpus."""

    def __init__(self, tab: Any) -> None:
        self._tab = tab

    def build_filter_row(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        filter_row = QHBoxLayout()
        filter_row.addWidget(QLabel("Saison:"))
        tab.season_filter_combo = QComboBox()
        tab.season_filter_combo.setMinimumWidth(140)
        tab.season_filter_combo.currentIndexChanged.connect(tab._on_season_filter_changed)  # noqa: SLF001
        filter_row.addWidget(tab.season_filter_combo)
        tab.check_season_btn = QPushButton("Cocher la saison")
        tab.check_season_btn.setToolTip(
            "Coche tous les épisodes de la saison choisie dans le filtre (ou tout si « Toutes les saisons »). "
            "Pratique pour un batch par saison : choisir Saison N → Cocher la saison → lancer Normaliser / Segmenter."
        )
        tab.check_season_btn.clicked.connect(tab._on_check_season_clicked)  # noqa: SLF001
        filter_row.addWidget(tab.check_season_btn)
        tab.uncheck_season_btn = QPushButton("Décocher la saison")
        tab.uncheck_season_btn.setToolTip(
            "Décoche tous les épisodes de la saison choisie (ou tout si « Toutes les saisons »)."
        )
        tab.uncheck_season_btn.clicked.connect(tab._on_uncheck_season_clicked)  # noqa: SLF001
        filter_row.addWidget(tab.uncheck_season_btn)
        filter_row.addStretch()
        layout.addLayout(filter_row)

    def build_episodes_view(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        # QTreeView+proxy provoque des segfaults sur certains environnements; TableView partout.
        use_table = True
        if use_table:
            tab.episodes_tree = QTableView()
            tab.episodes_tree.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
            tab.episodes_tree.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
            tab.episodes_tree.setAlternatingRowColors(True)
            tab.episodes_tree_model = EpisodesTableModel()
            tab.episodes_tree_proxy = EpisodesFilterProxyModel()
            tab.episodes_tree_proxy.setSourceModel(tab.episodes_tree_model)
            tab.episodes_tree.setModel(tab.episodes_tree_proxy)
        else:
            tab.episodes_tree = QTreeView()
            tab.episodes_tree.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
            tab.episodes_tree.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
            tab.episodes_tree.setRootIsDecorated(True)
            tab.episodes_tree.setAlternatingRowColors(True)
            tab.episodes_tree_model = EpisodesTreeModel()
            tab.episodes_tree_proxy = EpisodesTreeFilterProxyModel()
            tab.episodes_tree_proxy.setSourceModel(tab.episodes_tree_model)
            tab.episodes_tree.setModel(tab.episodes_tree_proxy)
        header = tab.episodes_tree.horizontalHeader() if use_table else tab.episodes_tree.header()
        header.setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Fixed)
        tab.episodes_tree.setColumnWidth(0, 32)
        tab.episodes_tree.setToolTip(
            "Colonne ☑ : cocher pour inclure l'épisode dans les actions (Télécharger, Normaliser, etc.). "
            "Double-clic : ouvrir dans l'Inspecteur (raw/clean, segments)."
        )
        tab.episodes_tree.doubleClicked.connect(tab._on_episode_double_clicked)  # noqa: SLF001
        layout.addWidget(tab.episodes_tree)

    def build_ribbon_container(self, layout: QVBoxLayout) -> QVBoxLayout:
        tab = self._tab
        tab.corpus_ribbon_toggle_btn = QToolButton()
        tab.corpus_ribbon_toggle_btn.setCheckable(True)
        tab.corpus_ribbon_toggle_btn.setChecked(True)
        tab.corpus_ribbon_toggle_btn.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        tab.corpus_ribbon_toggle_btn.setArrowType(Qt.ArrowType.DownArrow)
        tab.corpus_ribbon_toggle_btn.setText("Masquer le panneau d'actions")
        tab.corpus_ribbon_toggle_btn.toggled.connect(tab._on_corpus_ribbon_toggled)  # noqa: SLF001
        layout.addWidget(tab.corpus_ribbon_toggle_btn, alignment=Qt.AlignmentFlag.AlignLeft)

        tab.corpus_ribbon_content = QWidget()
        ribbon_layout = QVBoxLayout(tab.corpus_ribbon_content)
        ribbon_layout.setContentsMargins(0, 0, 0, 0)
        ribbon_layout.setSpacing(layout.spacing())
        layout.addWidget(tab.corpus_ribbon_content)
        return ribbon_layout

    def build_sources_group(self, ribbon_layout: QVBoxLayout) -> None:
        tab = self._tab
        group_sources = QGroupBox("1. SOURCES — Constitution du corpus")
        group_sources.setToolTip(
            "Choisissez une ou deux sources pour constituer votre corpus. "
            "Les deux sources sont équivalentes et peuvent être utilisées indépendamment ou ensemble."
        )
        sources_main_layout = QVBoxLayout()

        global_btn_row = QHBoxLayout()
        tab.check_all_btn = QPushButton("Tout cocher")
        tab.check_all_btn.setToolTip(
            "Coche tous les épisodes du corpus. Les actions (Télécharger, Normaliser, etc.) s'appliquent aux épisodes cochés."
        )
        tab.check_all_btn.clicked.connect(lambda: tab.episodes_tree_model.set_all_checked(True))
        tab.uncheck_all_btn = QPushButton("Tout décocher")
        tab.uncheck_all_btn.setToolTip(
            "Décoche tous les épisodes. Utilisez ensuite les cases de la table ou « Cocher la saison » pour cibler une sélection."
        )
        tab.uncheck_all_btn.clicked.connect(lambda: tab.episodes_tree_model.set_all_checked(False))
        global_btn_row.addWidget(tab.check_all_btn)
        global_btn_row.addWidget(tab.uncheck_all_btn)
        global_btn_row.addStretch()
        sources_main_layout.addLayout(global_btn_row)
        selection_help = QLabel(
            "📌 <b>Sélection pour les actions :</b> "
            "Les boutons Télécharger, Normaliser, Segmenter, etc. s'appliquent aux épisodes <b>cochés</b> "
            "(ou aux lignes sélectionnées au clavier si aucun n'est coché). "
            "Pour un <b>batch par saison</b> : choisir une saison dans le filtre puis « Cocher la saison »."
        )
        selection_help.setWordWrap(True)
        selection_help.setStyleSheet("color: #555; font-size: 0.95em;")
        sources_main_layout.addWidget(selection_help)

        # Passer par les wrappers du tab pour préserver la compatibilité des patchs/tests.
        two_columns_layout = QHBoxLayout()
        two_columns_layout.addWidget(tab._build_transcripts_group())  # noqa: SLF001
        two_columns_layout.addWidget(tab._build_subtitles_group())  # noqa: SLF001
        sources_main_layout.addLayout(two_columns_layout)

        workflow_help = QLabel(
            "💡 <b>Workflows flexibles :</b> "
            "Transcripts seuls, Sous-titres seuls, ou les deux ensemble. "
            "Commencez par la source de votre choix !"
        )
        workflow_help.setWordWrap(True)
        workflow_help.setStyleSheet("background-color: #f0f8ff; padding: 8px; border-radius: 4px;")
        sources_main_layout.addWidget(workflow_help)

        group_sources.setLayout(sources_main_layout)
        ribbon_layout.addWidget(group_sources)

    def build_transcripts_group(self) -> QGroupBox:
        tab = self._tab
        transcripts_group = QGroupBox("📄 TRANSCRIPTS")
        transcripts_group.setToolTip(
            "Texte narratif complet récupéré depuis des sites web spécialisés (subslikescript, etc.). "
            "Récupération automatique via URL de la série."
        )
        transcripts_layout = QVBoxLayout()
        transcripts_layout.addWidget(QLabel("<b>Récupération automatique depuis le web</b>"))
        transcripts_layout.addWidget(QLabel("<i>Source configurée dans l'onglet Projet</i>"))

        tab.discover_btn = QPushButton("🔍 Découvrir épisodes")
        tab.discover_btn.setToolTip(
            "Récupère automatiquement la liste des épisodes depuis la source web configurée "
            "(URL série dans l'onglet Projet)."
        )
        tab.discover_btn.clicked.connect(tab._discover_episodes)  # noqa: SLF001
        transcripts_layout.addWidget(tab.discover_btn)

        tab.discover_merge_btn = QPushButton("🔀 Fusionner autre source...")
        tab.discover_merge_btn.setToolTip(
            "Découvre une série depuis une autre source/URL et fusionne avec l'index existant "
            "(sans écraser les épisodes déjà présents)."
        )
        tab.discover_merge_btn.clicked.connect(tab._discover_merge)  # noqa: SLF001
        transcripts_layout.addWidget(tab.discover_merge_btn)

        tab.fetch_sel_btn = QPushButton("⬇️ Télécharger sélection")
        tab.fetch_sel_btn.setToolTip(
            "Télécharge le texte narratif des épisodes cochés (ou des lignes sélectionnées au clic)."
        )
        tab.fetch_sel_btn.clicked.connect(lambda: tab._fetch_episodes(selection_only=True))  # noqa: SLF001
        transcripts_layout.addWidget(tab.fetch_sel_btn)

        tab.fetch_all_btn = QPushButton("⬇️ Télécharger tout")
        tab.fetch_all_btn.setToolTip("Télécharge le texte narratif de tous les épisodes découverts.")
        tab.fetch_all_btn.clicked.connect(lambda: tab._fetch_episodes(selection_only=False))  # noqa: SLF001
        transcripts_layout.addWidget(tab.fetch_all_btn)

        tab.transcripts_status_label = QLabel("Status : 0/0 téléchargés")
        tab.transcripts_status_label.setStyleSheet("color: gray; font-style: italic;")
        transcripts_layout.addWidget(tab.transcripts_status_label)

        transcripts_layout.addStretch()
        transcripts_group.setLayout(transcripts_layout)
        return transcripts_group

    def build_subtitles_group(self) -> QGroupBox:
        tab = self._tab
        subtitles_group = QGroupBox("📺 SOUS-TITRES (SRT)")
        subtitles_group.setToolTip(
            "Fichiers de sous-titres (.srt) alignés précisément sur la vidéo avec timestamps. "
            "Import manuel depuis votre ordinateur."
        )
        subtitles_layout = QVBoxLayout()
        subtitles_layout.addWidget(QLabel("<b>Import manuel depuis votre ordinateur</b>"))
        subtitles_layout.addWidget(QLabel("<i>Fichiers .srt avec timestamps vidéo</i>"))

        tab.add_episodes_btn = QPushButton("➕ Ajouter épisodes (liste)")
        tab.add_episodes_btn.setToolTip(
            "Créer manuellement la liste des épisodes (ex: S01E01, S01E02...). "
            "Nécessaire avant d'importer les fichiers .srt si vous n'avez pas découvert via transcripts."
        )
        tab.add_episodes_btn.clicked.connect(tab._add_episodes_manually)  # noqa: SLF001
        subtitles_layout.addWidget(tab.add_episodes_btn)

        tab.import_srt_sel_btn = QPushButton("📥 Importer SRT sélection")
        tab.import_srt_sel_btn.setToolTip(
            "Importer les fichiers .srt depuis votre ordinateur pour les épisodes sélectionnés. "
            "Vous serez invité à choisir les fichiers .srt un par un."
        )
        tab.import_srt_sel_btn.clicked.connect(tab._import_srt_selection)  # noqa: SLF001
        subtitles_layout.addWidget(tab.import_srt_sel_btn)

        tab.import_srt_batch_btn = QPushButton("📁 Import batch (dossier)")
        tab.import_srt_batch_btn.setToolTip(
            "Importer automatiquement tous les fichiers .srt d'un dossier. "
            "Détection automatique des épisodes depuis les noms de fichiers (ex: S01E01.srt)."
        )
        tab.import_srt_batch_btn.clicked.connect(tab._import_srt_batch)  # noqa: SLF001
        subtitles_layout.addWidget(tab.import_srt_batch_btn)

        tab.manage_srt_btn = QPushButton("⚙️ Gérer sous-titres")
        tab.manage_srt_btn.setToolTip(
            "Ouvre l'onglet Inspecteur pour gérer les pistes de sous-titres (voir, ajouter, supprimer)."
        )
        tab.manage_srt_btn.clicked.connect(tab._open_subtitles_manager)  # noqa: SLF001
        subtitles_layout.addWidget(tab.manage_srt_btn)

        tab.subtitles_status_label = QLabel("Status : 0/0 importés")
        tab.subtitles_status_label.setStyleSheet("color: gray; font-style: italic;")
        subtitles_layout.addWidget(tab.subtitles_status_label)

        subtitles_layout.addStretch()
        subtitles_group.setLayout(subtitles_layout)
        return subtitles_group

    def build_normalization_group(self, ribbon_layout: QVBoxLayout) -> None:
        tab = self._tab
        group_norm = QGroupBox("2. Normalisation / segmentation — Après import")
        group_norm.setToolTip(
            "Workflow §14 : Mise au propre des transcripts (RAW → CLEAN) et segmentation. "
            "Prérequis : au moins un épisode téléchargé (Bloc 1). L'alignement (Bloc 3) est dans les onglets Alignement, Concordance, Personnages."
        )
        btn_row2 = QHBoxLayout()
        btn_row2.addWidget(QLabel("Profil (batch):"))
        tab.norm_batch_profile_combo = QComboBox()
        tab.norm_batch_profile_combo.addItems(list(PROFILES.keys()))
        tab.norm_batch_profile_combo.setToolTip(
            "Profil pour ce batch : utilisé par « Normaliser sélection » et « Normaliser tout ». "
            "Priorité par épisode : 1) profil préféré (Inspecteur) 2) défaut de la source (Profils) 3) ce choix. "
            "Ce choix ne modifie pas le profil enregistré dans la config du projet (onglet Projet)."
        )
        btn_row2.addWidget(tab.norm_batch_profile_combo)

        tab.manage_profiles_btn = QPushButton("⚙️ Gérer profils")
        tab.manage_profiles_btn.setToolTip(
            "Ouvre le dialogue de gestion des profils de normalisation : "
            "créer, modifier, supprimer des profils personnalisés avec prévisualisation."
        )
        tab.manage_profiles_btn.clicked.connect(tab._open_profiles_dialog)  # noqa: SLF001
        btn_row2.addWidget(tab.manage_profiles_btn)

        tab.norm_sel_btn = QPushButton("Normaliser\nsélection")
        tab.norm_sel_btn.setToolTip(
            "Bloc 2 — Normalise les épisodes cochés (ou lignes sélectionnées). "
            "Périmètre : sélection uniquement. Prérequis : épisodes téléchargés (RAW)."
        )
        tab.norm_sel_btn.clicked.connect(lambda: tab._normalize_episodes(selection_only=True))  # noqa: SLF001
        tab.norm_all_btn = QPushButton("Normaliser tout")
        tab.norm_all_btn.setToolTip(
            "Bloc 2 — Normalise tout le corpus. Périmètre : tous les épisodes. Prérequis : téléchargés (RAW)."
        )
        tab.norm_all_btn.clicked.connect(lambda: tab._normalize_episodes(selection_only=False))  # noqa: SLF001
        tab.segment_sel_btn = QPushButton("Segmenter\nsélection")
        tab.segment_sel_btn.setToolTip(
            "Bloc 2 — Segmente les épisodes cochés (ou sélectionnés) ayant CLEAN. Périmètre : sélection uniquement."
        )
        tab.segment_sel_btn.clicked.connect(lambda: tab._segment_episodes(selection_only=True))  # noqa: SLF001
        tab.segment_all_btn = QPushButton("Segmenter tout")
        tab.segment_all_btn.setToolTip(
            "Bloc 2 — Segmente tout le corpus (épisodes ayant CLEAN). Périmètre : tous les épisodes."
        )
        tab.segment_all_btn.clicked.connect(lambda: tab._segment_episodes(selection_only=False))  # noqa: SLF001
        tab.all_in_one_btn = QPushButton("Tout faire\n(sélection)")
        tab.all_in_one_btn.setToolTip(
            "Enchaînement pour les épisodes cochés uniquement : Télécharger → Normaliser → Segmenter → Indexer DB. "
            "Périmètre : sélection (cochez les épisodes cibles)."
        )
        tab.all_in_one_btn.clicked.connect(tab._run_all_for_selection)  # noqa: SLF001
        tab.index_btn = QPushButton("Indexer DB")
        tab.index_btn.setToolTip(
            "Bloc 2 — Indexe en base tous les épisodes ayant un fichier CLEAN (segmentation). Tout le projet."
        )
        tab.index_btn.clicked.connect(tab._index_db)  # noqa: SLF001
        tab.export_corpus_btn = QPushButton("Exporter corpus")
        tab.export_corpus_btn.clicked.connect(tab._export_corpus)  # noqa: SLF001
        tab.cancel_job_btn = QPushButton("Annuler")
        tab.cancel_job_btn.clicked.connect(tab._emit_cancel_job)  # noqa: SLF001
        tab.cancel_job_btn.setEnabled(False)
        tab.resume_failed_btn = QPushButton("Reprendre les échecs")
        tab.resume_failed_btn.setToolTip(
            "Relance uniquement les épisodes qui ont échoué lors du dernier job (téléchargement, normalisation, etc.)"
        )
        tab.resume_failed_btn.clicked.connect(tab._resume_failed_episodes)  # noqa: SLF001
        tab.resume_failed_btn.setEnabled(False)

        for button in (
            tab.norm_sel_btn,
            tab.norm_all_btn,
            tab.segment_sel_btn,
            tab.segment_all_btn,
            tab.all_in_one_btn,
            tab.index_btn,
            tab.export_corpus_btn,
        ):
            btn_row2.addWidget(button)
        btn_row2.addWidget(tab.cancel_job_btn)
        btn_row2.addWidget(tab.resume_failed_btn)
        btn_row2.addStretch()
        group_norm.setLayout(btn_row2)
        ribbon_layout.addWidget(group_norm)

    def build_status_block(self, ribbon_layout: QVBoxLayout) -> None:
        tab = self._tab
        tab.corpus_progress = QProgressBar()
        tab.corpus_progress.setMaximum(100)
        tab.corpus_progress.setValue(0)
        ribbon_layout.addWidget(tab.corpus_progress)
        tab.corpus_status_label = QLabel("")
        tab.corpus_status_label.setToolTip(
            "Workflow §14 (3 blocs) : Bloc 1 = Découverts → Téléchargés → SRT (import). "
            "Bloc 2 = Normalisés (CLEAN) → Segmentés (DB). Bloc 3 = Alignés (onglets Alignement, Concordance, Personnages)."
        )
        ribbon_layout.addWidget(tab.corpus_status_label)
        tab.workflow_next_step_label = QLabel("")
        tab.workflow_next_step_label.setToolTip(
            "Recommandation selon l'état actuel du corpus. Cochez des épisodes pour cibler la sélection."
        )
        tab.workflow_next_step_label.setStyleSheet("font-weight: bold; color: #0066aa;")
        tab.workflow_next_step_label.setWordWrap(True)
        ribbon_layout.addWidget(tab.workflow_next_step_label)
        scope_label = QLabel(
            "Périmètre : « sélection » = épisodes cochés (ou lignes sélectionnées) ; « tout » = tout le corpus."
        )
        scope_label.setStyleSheet("color: gray; font-size: 0.9em;")
        scope_label.setWordWrap(True)
        scope_label.setToolTip(
            "Bloc 1 : Découvrir, Télécharger, SRT (onglet Sous-titres). "
            "Bloc 2 : Normaliser, Segmenter, Indexer DB. Bloc 3 : Alignement, Concordance, Personnages."
        )
        ribbon_layout.addWidget(scope_label)
