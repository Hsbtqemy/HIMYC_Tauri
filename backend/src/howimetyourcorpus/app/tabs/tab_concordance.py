"""Onglet Concordance : recherche KWIC (épisodes, segments, cues) et export + Pack Rapide (C2, C9, C15, C4) + Pack Analyse (C1, C5, C8, C11)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from PySide6.QtCore import QModelIndex, QSettings, Qt
from PySide6.QtGui import QKeyEvent
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableView,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.core.export_utils import (
    export_kwic_csv,
    export_kwic_json,
    export_kwic_jsonl,
    export_kwic_tsv,
    export_kwic_docx,
)
from howimetyourcorpus.app.models_qt import KwicTableModel
from howimetyourcorpus.app.ui_utils import require_db
from howimetyourcorpus.core.constants import KWIC_CONTEXT_WINDOW, SUPPORTED_LANGUAGES

logger = logging.getLogger(__name__)


class ConcordanceTabWidget(QWidget):
    """Widget de l'onglet Concordance : recherche KWIC, filtres, table, export, ouvrir dans Inspecteur."""

    def __init__(
        self,
        get_db: Callable[[], object],
        on_open_inspector: Callable[[str], None],
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_db = get_db
        self._on_open_inspector = on_open_inspector
        
        # Pack Rapide C4: Configuration historique recherche
        self._max_history = 20
        
        layout = QVBoxLayout(self)
        row = QHBoxLayout()
        row.addWidget(QLabel("Recherche:"))
        
        # Pack Rapide C4: ComboBox éditable avec historique au lieu de QLineEdit
        self.kwic_search_edit = QComboBox()
        self.kwic_search_edit.setEditable(True)
        self.kwic_search_edit.setPlaceholderText("Terme...")
        self.kwic_search_edit.setToolTip("Recherche KWIC (Entrée pour lancer, historique disponible)")
        self.kwic_search_edit.lineEdit().setPlaceholderText("Terme...")
        self.kwic_search_edit.lineEdit().returnPressed.connect(self._run_kwic)
        self._load_search_history()  # Pack Rapide C4
        row.addWidget(self.kwic_search_edit)
        
        self.kwic_go_btn = QPushButton("Rechercher")
        self.kwic_go_btn.clicked.connect(self._run_kwic)
        row.addWidget(self.kwic_go_btn)
        
        # Pack Analyse C11: Bouton graphique fréquence
        self.graph_btn = QPushButton("📊 Graphique")
        self.graph_btn.setToolTip("Affiche un graphique des occurrences par épisode")
        self.graph_btn.clicked.connect(self._show_frequency_graph)
        row.addWidget(self.graph_btn)
        
        self.export_kwic_btn = QPushButton("Exporter résultats")
        self.export_kwic_btn.clicked.connect(self._export_kwic)
        row.addWidget(self.export_kwic_btn)
        row.addWidget(QLabel("Scope:"))
        self.kwic_scope_combo = QComboBox()
        self.kwic_scope_combo.addItem("Épisodes (texte)", "episodes")
        self.kwic_scope_combo.addItem("Segments", "segments")
        self.kwic_scope_combo.addItem("Cues (sous-titres)", "cues")
        row.addWidget(self.kwic_scope_combo)
        row.addWidget(QLabel("Kind:"))
        self.kwic_kind_combo = QComboBox()
        self.kwic_kind_combo.addItem("—", "")
        self.kwic_kind_combo.addItem("Phrases", "sentence")
        self.kwic_kind_combo.addItem("Tours", "utterance")
        row.addWidget(self.kwic_kind_combo)
        row.addWidget(QLabel("Langue:"))
        self.kwic_lang_combo = QComboBox()
        self.kwic_lang_combo.addItem("—", "")
        for lang in SUPPORTED_LANGUAGES:
            self.kwic_lang_combo.addItem(lang, lang)
        row.addWidget(self.kwic_lang_combo)
        
        # Pack Analyse C5: Filtre par speaker
        row.addWidget(QLabel("Personnage:"))
        self.kwic_speaker_combo = QComboBox()
        self.kwic_speaker_combo.addItem("—", "")
        self.kwic_speaker_combo.setToolTip("Filtre segments/cues par personnage")
        self.kwic_speaker_combo.currentIndexChanged.connect(self._on_speaker_changed)
        row.addWidget(self.kwic_speaker_combo)
        
        row.addWidget(QLabel("Saison:"))
        self.kwic_season_spin = QSpinBox()
        self.kwic_season_spin.setMinimum(0)
        self.kwic_season_spin.setMaximum(99)
        self.kwic_season_spin.setSpecialValueText("—")
        row.addWidget(self.kwic_season_spin)
        row.addWidget(QLabel("Épisode:"))
        self.kwic_episode_spin = QSpinBox()
        self.kwic_episode_spin.setMinimum(0)
        self.kwic_episode_spin.setMaximum(999)
        self.kwic_episode_spin.setSpecialValueText("—")
        row.addWidget(self.kwic_episode_spin)
        row.addWidget(QLabel("Page:"))
        self.kwic_page_spin = QSpinBox()
        self.kwic_page_spin.setMinimum(1)
        self.kwic_page_spin.setMaximum(1)
        self.kwic_page_spin.setSpecialValueText("1")
        self.kwic_page_spin.setToolTip("Navigation pagination (200 résultats par page)")
        self.kwic_page_spin.valueChanged.connect(self._on_page_changed)
        row.addWidget(self.kwic_page_spin)
        self.kwic_page_label = QLabel("/ 1")
        row.addWidget(self.kwic_page_label)
        layout.addLayout(row)
        
        # Pack Rapide : Row 2 avec options avancées (C2: Case-sensitive, C4: Historique)
        row2 = QHBoxLayout()
        row2.addWidget(QLabel("Options:"))
        self.case_sensitive_cb = QCheckBox("Respecter la casse")
        self.case_sensitive_cb.setToolTip("Recherche sensible à la casse (A ≠ a)")
        row2.addWidget(self.case_sensitive_cb)
        
        # Pack Analyse C1: Regex/Wildcards
        self.regex_cb = QCheckBox("Regex")
        self.regex_cb.setToolTip("Recherche avec expressions régulières (ex: .*, [abc]+, etc.)")
        row2.addWidget(self.regex_cb)
        
        self.wildcard_cb = QCheckBox("Wildcards")
        self.wildcard_cb.setToolTip("Support * (n'importe quel texte) et ? (1 caractère)")
        row2.addWidget(self.wildcard_cb)
        
        row2.addStretch()
        layout.addLayout(row2)
        
        # Pack Analyse C8: Label statistiques résultats
        self.stats_label = QLabel("")
        self.stats_label.setStyleSheet("color: gray; font-size: 0.9em; padding: 5px;")
        self.stats_label.setWordWrap(True)
        layout.addWidget(self.stats_label)
        
        self.kwic_table = QTableView()
        self.kwic_model = KwicTableModel()
        self.kwic_table.setModel(self.kwic_model)
        self.kwic_table.doubleClicked.connect(self._on_double_click)
        self.kwic_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.kwic_table.setSortingEnabled(True)  # Activer le tri par colonne
        layout.addWidget(self.kwic_table)
        
        # Pack Rapide C15: Copier presse-papier avec Ctrl+C
        self.kwic_table.keyPressEvent = self._handle_table_key_press
        
        self._all_hits: list = []  # Stocker tous les résultats pour pagination
        self._page_size = 200

    def set_languages(self, langs: list[str]) -> None:
        """Met à jour la liste des langues (projet). Appelé par la fenêtre principale."""
        self.kwic_lang_combo.clear()
        self.kwic_lang_combo.addItem("—", "")
        for lang in langs:
            self.kwic_lang_combo.addItem(lang, lang)
    
    def refresh_speakers(self) -> None:
        """Pack Analyse C5: Charge la liste des speakers depuis la DB."""
        db = self._get_db()
        if not db:
            return
        
        try:
            with db.connection() as conn:
                cursor = conn.execute(
                    """SELECT DISTINCT speaker_explicit 
                       FROM segments 
                       WHERE speaker_explicit IS NOT NULL 
                         AND trim(speaker_explicit) != ''
                       ORDER BY speaker_explicit"""
                )
                speakers = [row[0] for row in cursor.fetchall()]
            
            self.kwic_speaker_combo.clear()
            self.kwic_speaker_combo.addItem("—", "")
            for speaker in speakers:
                self.kwic_speaker_combo.addItem(speaker, speaker)
        except Exception:
            logger.exception("Refresh speakers")
    
    def _on_speaker_changed(self) -> None:
        """Pack Analyse C5: Relance la recherche si un speaker est sélectionné."""
        # Optionnel : auto-refresh si déjà une recherche active
        if self._all_hits:
            self._run_kwic()
    
    def _load_search_history(self) -> None:
        """Pack Rapide C4: Charge l'historique depuis QSettings."""
        settings = QSettings()
        history = settings.value("concordance/search_history", [])
        if isinstance(history, list):
            self.kwic_search_edit.clear()
            for term in history[-self._max_history:]:  # Limiter à N dernières
                if term and isinstance(term, str):
                    self.kwic_search_edit.addItem(term)
    
    def _save_search_to_history(self, term: str) -> None:
        """Pack Rapide C4: Ajoute le terme à l'historique (sans doublons)."""
        if not term or not term.strip():
            return
        
        term = term.strip()
        settings = QSettings()
        history = settings.value("concordance/search_history", [])
        if not isinstance(history, list):
            history = []
        
        # Retirer terme s'il existe déjà (on le remettra en dernier)
        history = [h for h in history if h != term]
        history.append(term)
        
        # Limiter à N dernières recherches
        history = history[-self._max_history:]
        
        settings.setValue("concordance/search_history", history)
        
        # Mettre à jour le combo
        self._load_search_history()
        self.kwic_search_edit.setCurrentText(term)

    def _run_kwic(self) -> None:
        term = self.kwic_search_edit.currentText().strip()  # Pack Rapide C4: currentText() au lieu de text()
        if not term:
            return
        self._run_kwic_for_term(term)

    @require_db
    def _run_kwic_for_term(self, term: str) -> None:
        db = self._get_db()
        assert db is not None  # garanti par @require_db
        
        # Pack Rapide C4: Sauvegarder dans l'historique
        self._save_search_to_history(term)
        
        season = self.kwic_season_spin.value() if self.kwic_season_spin.value() > 0 else None
        episode = self.kwic_episode_spin.value() if self.kwic_episode_spin.value() > 0 else None
        scope = self.kwic_scope_combo.currentData() or "episodes"
        
        # Pack Analyse C1: Déterminer mode recherche
        use_regex = self.regex_cb.isChecked()
        use_wildcard = self.wildcard_cb.isChecked()
        
        # Récupérer TOUS les résultats (sans limite) pour pagination
        if scope == "segments":
            kind = self.kwic_kind_combo.currentData() or None
            hits = db.query_kwic_segments(term, kind=kind, season=season, episode=episode, window=KWIC_CONTEXT_WINDOW, limit=10000)
        elif scope == "cues":
            lang = self.kwic_lang_combo.currentData() or None
            hits = db.query_kwic_cues(term, lang=lang, season=season, episode=episode, window=KWIC_CONTEXT_WINDOW, limit=10000)
        else:
            hits = db.query_kwic(term, season=season, episode=episode, window=KWIC_CONTEXT_WINDOW, limit=10000)
        
        # Pack Analyse C1: Filtrer avec regex/wildcard si activé
        if use_regex or use_wildcard:
            hits = self._filter_hits_regex_wildcard(hits, term, use_regex, use_wildcard)
        
        # Pack Analyse C5: Filtrer par speaker si sélectionné
        speaker = self.kwic_speaker_combo.currentData()
        if speaker and scope in ("segments", "cues"):
            hits = self._filter_hits_by_speaker(hits, speaker)
        
        self._all_hits = hits
        # Calculer nb pages
        total_pages = max(1, (len(hits) + self._page_size - 1) // self._page_size)
        self.kwic_page_spin.setMaximum(total_pages)
        self.kwic_page_spin.setValue(1)
        self.kwic_page_label.setText(f"/ {total_pages}  ({len(hits)} résultat(s))")
        
        # Pack Analyse C8: Afficher statistiques
        self._update_stats(hits)
        
        # Afficher page 1
        self._display_page(1)
    
    def _update_stats(self, hits: list) -> None:
        """Pack Analyse C8: Calcule et affiche les statistiques des résultats."""
        if not hits:
            self.stats_label.setText("")
            return
        
        # Compter occurrences par épisode
        episodes_count = {}
        for hit in hits:
            eid = getattr(hit, "episode_id", "")
            episodes_count[eid] = episodes_count.get(eid, 0) + 1
        
        nb_episodes = len(episodes_count)
        avg_per_episode = len(hits) / nb_episodes if nb_episodes > 0 else 0
        
        # Trouver épisode avec le plus d'occurrences
        if episodes_count:
            max_eid = max(episodes_count, key=episodes_count.get)
            max_count = episodes_count[max_eid]
            stats_text = (
                f"📊 Statistiques : {len(hits)} occurrence(s) • "
                f"{nb_episodes} épisode(s) • "
                f"Moyenne : {avg_per_episode:.1f}/épisode • "
                f"Max : {max_eid} ({max_count})"
            )
        else:
            stats_text = f"📊 Statistiques : {len(hits)} occurrence(s)"
        
        self.stats_label.setText(stats_text)
    
    def _filter_hits_regex_wildcard(self, hits: list, term: str, use_regex: bool, use_wildcard: bool) -> list:
        """Pack Analyse C1: Filtre les résultats avec regex ou wildcards."""
        import re
        
        if use_wildcard:
            # Convertir wildcards en regex: * → .*, ? → .
            pattern = term.replace("*", ".*").replace("?", ".")
            use_regex = True
        else:
            pattern = term
        
        if use_regex:
            try:
                # Compiler regex (case-sensitive selon checkbox)
                flags = 0 if self.case_sensitive_cb.isChecked() else re.IGNORECASE
                regex = re.compile(pattern, flags)
                
                # Filtrer hits dont match contient le pattern
                filtered = []
                for hit in hits:
                    if regex.search(hit.match):
                        filtered.append(hit)
                
                return filtered
            except re.error as e:
                QMessageBox.warning(self, "Regex", f"Regex invalide : {e}")
                return hits
        
        return hits
    
    def _filter_hits_by_speaker(self, hits: list, speaker: str) -> list:
        """Pack Analyse C5: Filtre les hits par speaker à partir du speaker déjà présent sur les hits."""
        target = (speaker or "").strip().casefold()
        if not target:
            return hits

        filtered = []
        for hit in hits:
            hit_speaker = (getattr(hit, "speaker", None) or "").strip().casefold()
            if hit_speaker == target:
                filtered.append(hit)
        return filtered

    def _on_page_changed(self) -> None:
        """Affiche la page sélectionnée."""
        self._display_page(self.kwic_page_spin.value())

    def _display_page(self, page: int) -> None:
        """Affiche les résultats de la page donnée."""
        start = (page - 1) * self._page_size
        end = start + self._page_size
        page_hits = self._all_hits[start:end]
        # Pack Rapide C9: Passer le terme de recherche pour highlight
        search_term = self.kwic_search_edit.currentText().strip()  # Pack Rapide C4: currentText()
        self.kwic_model.set_hits(page_hits, search_term=search_term)

    def _export_kwic(self) -> None:
        from PySide6.QtWidgets import QFileDialog

        # Exporter TOUS les résultats, pas seulement la page affichée
        hits = self._all_hits if self._all_hits else self.kwic_model.get_all_hits()
        if not hits:
            QMessageBox.warning(self, "Concordance", "Effectuez d'abord une recherche ou aucun résultat à exporter.")
            return
        path, selected_filter = QFileDialog.getSaveFileName(
            self,
            "Exporter les résultats KWIC",
            "",
            "CSV (*.csv);;TSV (*.tsv);;JSON (*.json);;JSONL (*.jsonl);;Word (*.docx)",
        )
        if not path:
            return
        path = Path(path)
        selected_filter_upper = (selected_filter or "").upper()
        suffix = path.suffix.lower()
        if suffix != ".docx" and "WORD" in selected_filter_upper:
            path = path.with_suffix(".docx")
            suffix = path.suffix.lower()
        try:
            if suffix == ".csv" or "CSV" in selected_filter_upper:
                export_kwic_csv(hits, path)
            elif suffix == ".tsv" or "TSV" in selected_filter_upper:
                export_kwic_tsv(hits, path)
            elif suffix == ".jsonl" or "JSONL" in selected_filter_upper:
                export_kwic_jsonl(hits, path)
            elif suffix == ".json" or ("JSON" in selected_filter_upper and "JSONL" not in selected_filter_upper):
                export_kwic_json(hits, path)
            elif suffix == ".docx" or "WORD" in selected_filter_upper:
                export_kwic_docx(hits, path)
            else:
                QMessageBox.warning(self, "Export", "Format non reconnu. Utilisez .csv, .tsv, .json, .jsonl ou .docx")
                return
            QMessageBox.information(self, "Export", f"Résultats exportés : {len(hits)} occurrence(s).")
        except Exception as e:
            logger.exception("Export KWIC")
            QMessageBox.critical(
                self,
                "Export Concordance",
                f"L'export des résultats KWIC a échoué : {e}\n\n"
                "Vérifiez les droits d'écriture sur le fichier cible et l'encodage (UTF-8).",
            )

    def _on_double_click(self, index: QModelIndex) -> None:
        hit = self.kwic_model.get_hit_at(index.row())
        if not hit:
            return
        self._on_open_inspector(hit.episode_id)
    
    def _handle_table_key_press(self, event: QKeyEvent) -> None:
        """Pack Rapide C15: Gérer Ctrl+C pour copier vers presse-papier."""
        if event.key() == Qt.Key.Key_C and event.modifiers() == Qt.KeyboardModifier.ControlModifier:
            self._copy_selection_to_clipboard()
            event.accept()
        else:
            # Appeler la méthode originale pour autres touches
            QTableView.keyPressEvent(self.kwic_table, event)
    
    def _copy_selection_to_clipboard(self) -> None:
        """Pack Rapide C15: Copie la sélection au format TSV vers le presse-papier."""
        from PySide6.QtWidgets import QApplication
        
        selection = self.kwic_table.selectionModel()
        if not selection or not selection.hasSelection():
            return
        
        indexes = sorted(selection.selectedIndexes(), key=lambda idx: (idx.row(), idx.column()))
        if not indexes:
            return
        
        # Construire TSV (lignes séparées par \n, colonnes par \t)
        rows = {}
        for idx in indexes:
            row_num = idx.row()
            col_num = idx.column()
            value = self.kwic_model.data(idx, Qt.ItemDataRole.DisplayRole) or ""
            if row_num not in rows:
                rows[row_num] = {}
            rows[row_num][col_num] = str(value)
        
        tsv_lines = []
        for row_num in sorted(rows.keys()):
            cols = rows[row_num]
            # Construire ligne avec toutes les colonnes (remplir vides si manquantes)
            max_col = max(cols.keys()) if cols else 0
            line_parts = [cols.get(c, "") for c in range(max_col + 1)]
            tsv_lines.append("\t".join(line_parts))
        
        tsv = "\n".join(tsv_lines)
        clipboard = QApplication.clipboard()
        clipboard.setText(tsv)
    
    def _show_frequency_graph(self) -> None:
        """Pack Analyse C11: Affiche un graphique des occurrences par épisode."""
        if not self._all_hits:
            QMessageBox.warning(self, "Graphique", "Effectuez d'abord une recherche.")
            return
        
        try:
            import matplotlib
            matplotlib.use('QtAgg')  # Backend Qt (PySide6 / Qt6)
            import matplotlib.pyplot as plt
            from collections import Counter
            
            # Compter occurrences par épisode
            episodes = [getattr(hit, "episode_id", "") for hit in self._all_hits]
            counter = Counter(episodes)
            
            if not counter:
                QMessageBox.warning(self, "Graphique", "Aucune donnée à afficher.")
                return
            
            # Trier par nom d'épisode (S01E01, S01E02, etc.)
            sorted_items = sorted(counter.items(), key=lambda x: x[0])
            episode_ids = [item[0] for item in sorted_items]
            counts = [item[1] for item in sorted_items]
            
            # Limiter à 50 épisodes max pour lisibilité
            if len(episode_ids) > 50:
                QMessageBox.information(
                    self,
                    "Graphique",
                    f"Trop d'épisodes ({len(episode_ids)}). Affichage des 50 premiers."
                )
                episode_ids = episode_ids[:50]
                counts = counts[:50]
            
            # Créer graphique
            fig, ax = plt.subplots(figsize=(12, 6))
            ax.bar(range(len(episode_ids)), counts, color='#2196F3')
            ax.set_xlabel('Épisode')
            ax.set_ylabel('Occurrences')
            ax.set_title(f'Fréquence : "{self.kwic_search_edit.currentText()}" ({sum(counts)} occurrences)')
            ax.set_xticks(range(len(episode_ids)))
            ax.set_xticklabels(episode_ids, rotation=45, ha='right')
            ax.grid(axis='y', alpha=0.3)
            
            plt.tight_layout()
            plt.show()
            
        except ImportError:
            QMessageBox.warning(
                self,
                "Graphique",
                "Matplotlib non installé.\n\n"
                "Installez-le avec :\n"
                "pip install matplotlib"
            )
        except Exception as e:
            logger.exception("Show frequency graph")
            QMessageBox.critical(self, "Erreur", f"Erreur lors de l'affichage du graphique : {e}")
