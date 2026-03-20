"""Construction UI de l'onglet Préparer."""

from __future__ import annotations

from typing import Any

from PySide6.QtCore import QSettings
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
)

from howimetyourcorpus.app.tabs.preparer_views import CueWidgets, TranscriptWidgets
from howimetyourcorpus.core.preparer import PREP_STATUS_CHOICES


class PreparerUiBuilder:
    """Construit les widgets/rows de l'onglet Préparer."""

    def __init__(self, tab: Any) -> None:
        self._tab = tab

    def build_top_row(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        top = QHBoxLayout()
        top.addWidget(QLabel("Épisode:"))
        tab.prep_episode_combo = QComboBox()
        tab.prep_episode_combo.currentIndexChanged.connect(tab._on_episode_changed)  # noqa: SLF001
        top.addWidget(tab.prep_episode_combo)

        top.addWidget(QLabel("Fichier:"))
        tab.prep_source_combo = QComboBox()
        tab._refresh_source_combo_items()  # noqa: SLF001
        tab.prep_source_combo.currentIndexChanged.connect(tab._on_source_changed)  # noqa: SLF001
        top.addWidget(tab.prep_source_combo)

        top.addWidget(QLabel("Statut:"))
        tab.prep_status_combo = QComboBox()
        for label, value in PREP_STATUS_CHOICES:
            tab.prep_status_combo.addItem(label, value)
        tab.prep_status_combo.currentIndexChanged.connect(tab._on_status_changed)  # noqa: SLF001
        top.addWidget(tab.prep_status_combo)

        tab.dirty_label = QLabel("")
        tab.dirty_label.setStyleSheet("color: #b00020; font-weight: bold;")
        top.addWidget(tab.dirty_label)
        top.addStretch()
        layout.addLayout(top)

    def build_actions_row(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        actions = QHBoxLayout()
        tab.prep_normalize_btn = QPushButton("Nettoyer")
        tab.prep_normalize_btn.clicked.connect(tab._normalize_transcript)  # noqa: SLF001
        actions.addWidget(tab.prep_normalize_btn)

        tab.prep_search_replace_btn = QPushButton("Rechercher / Remplacer")
        tab.prep_search_replace_btn.clicked.connect(tab._search_replace)  # noqa: SLF001
        actions.addWidget(tab.prep_search_replace_btn)

        tab.prep_segment_btn = QPushButton("Segmenter en tours")
        tab.prep_segment_btn.clicked.connect(tab._segment_to_utterances)  # noqa: SLF001
        actions.addWidget(tab.prep_segment_btn)

        tab.prep_segment_options_btn = QPushButton("Paramètres segmentation")
        tab.prep_segment_options_btn.clicked.connect(tab._open_segmentation_options)  # noqa: SLF001
        actions.addWidget(tab.prep_segment_options_btn)

        tab.prep_edit_timecodes_cb = QCheckBox("Éditer timecodes")
        tab.prep_edit_timecodes_cb.setToolTip(
            "Autorise l'édition des colonnes Début/Fin sur les cues SRT."
        )
        tab.prep_edit_timecodes_cb.toggled.connect(tab._on_edit_timecodes_toggled)  # noqa: SLF001
        tab.prep_edit_timecodes_cb.setEnabled(False)
        actions.addWidget(tab.prep_edit_timecodes_cb)

        tab.prep_strict_timecodes_cb = QCheckBox("Validation stricte")
        tab.prep_strict_timecodes_cb.setToolTip(
            "En mode édition timecodes, refuse les chevauchements entre cues adjacentes."
        )
        tab.prep_strict_timecodes_cb.setEnabled(False)
        actions.addWidget(tab.prep_strict_timecodes_cb)

        tab.prep_save_btn = QPushButton("Enregistrer")
        tab.prep_save_btn.clicked.connect(tab.save_current)
        actions.addWidget(tab.prep_save_btn)

        tab.prep_go_align_btn = QPushButton("Aller à l'alignement")
        tab.prep_go_align_btn.clicked.connect(tab._go_to_alignement)  # noqa: SLF001
        actions.addWidget(tab.prep_go_align_btn)
        actions.addStretch()
        layout.addLayout(actions)

    def build_utterance_actions_row(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        utterance_actions = QHBoxLayout()
        tab.prep_add_utt_btn = QPushButton("Ajouter ligne")
        tab.prep_add_utt_btn.clicked.connect(tab._add_utterance_row_below)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_add_utt_btn)

        tab.prep_delete_utt_btn = QPushButton("Supprimer ligne")
        tab.prep_delete_utt_btn.clicked.connect(tab._delete_selected_utterance_rows)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_delete_utt_btn)

        tab.prep_merge_utt_btn = QPushButton("Fusionner")
        tab.prep_merge_utt_btn.clicked.connect(tab._merge_selected_utterances)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_merge_utt_btn)

        tab.prep_split_utt_btn = QPushButton("Scinder au curseur")
        tab.prep_split_utt_btn.clicked.connect(tab._split_selected_utterance_at_cursor)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_split_utt_btn)

        tab.prep_group_utt_btn = QPushButton("Regrouper par assignations")
        tab.prep_group_utt_btn.clicked.connect(tab._group_utterances_by_assignments)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_group_utt_btn)

        tab.prep_renumber_utt_btn = QPushButton("Renuméroter")
        tab.prep_renumber_utt_btn.clicked.connect(tab._renumber_utterances)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_renumber_utt_btn)

        tab.prep_reset_utt_btn = QPushButton("Revenir au texte")
        tab.prep_reset_utt_btn.clicked.connect(tab._reset_utterances_to_text)  # noqa: SLF001
        utterance_actions.addWidget(tab.prep_reset_utt_btn)
        utterance_actions.addStretch()
        layout.addLayout(utterance_actions)

    def build_help_label(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        tab.help_label = QLabel(
            "Transcript: normaliser, segmenter (règles paramétrables), éditer les tours.\n"
            "SRT: éditer personnage/texte des cues, timecodes éditables via « Éditer timecodes »."
        )
        tab.help_label.setWordWrap(True)
        tab.help_label.setStyleSheet("color: #666;")
        layout.addWidget(tab.help_label)

    def build_editors_stack(self, layout: QVBoxLayout) -> None:
        tab = self._tab
        settings = QSettings("HIMYC", "MainWindow")
        show_per_line_status = settings.value("Preparer/ShowPerLineStatus", False, type=bool)
        tab._transcript_widgets = TranscriptWidgets(  # noqa: SLF001
            edit_role=tab._edit_role,  # noqa: SLF001
            on_text_changed=tab._on_text_changed,  # noqa: SLF001
            on_table_item_changed=tab._on_table_item_changed,  # noqa: SLF001
            show_status_column=show_per_line_status,
        )
        tab._cue_widgets = CueWidgets(  # noqa: SLF001
            edit_role=tab._edit_role,  # noqa: SLF001
            on_table_item_changed=tab._on_table_item_changed,  # noqa: SLF001
        )
        # Attributs publics conservés pour compatibilité (tests et intégrations).
        tab.text_editor = tab._transcript_widgets.text_editor  # noqa: SLF001
        tab.utterance_table = tab._transcript_widgets.utterance_table  # noqa: SLF001
        tab.cue_table = tab._cue_widgets.cue_table  # noqa: SLF001

        tab.stack = QStackedWidget()
        tab.stack.addWidget(tab.text_editor)
        tab.stack.addWidget(tab.utterance_table)
        tab.stack.addWidget(tab.cue_table)
        layout.addWidget(tab.stack)
