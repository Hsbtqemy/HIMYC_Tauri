"""Dialogue pour gérer les profils de normalisation (liste, nouvel / modifier / supprimer)."""

from __future__ import annotations

import difflib
from typing import Any

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
    QSplitter,
    QTableWidget,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.core.adapters.base import AdapterRegistry
from howimetyourcorpus.core.normalize.profiles import PROFILES, NormalizationProfile, get_all_profile_ids
from howimetyourcorpus.core.storage.project_store import ProjectStore


class ProfilesDialog(QDialog):
    """Dialogue pour gérer les profils de normalisation (liste, nouvel / modifier / supprimer pour les personnalisés)."""

    def __init__(self, parent: QWidget | None, store: ProjectStore | None):
        super().__init__(parent)
        self.setWindowTitle("Profils de normalisation")
        self._store = store
        self._custom_list: list[dict[str, Any]] = []
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Profils prédéfinis (lecture seule) et personnalisés (éditables)."))
        self.list_widget = QListWidget()
        self.list_widget.currentItemChanged.connect(self._on_selection_changed)
        layout.addWidget(self.list_widget)
        btn_row = QHBoxLayout()
        self.new_btn = QPushButton("Nouveau")
        self.new_btn.clicked.connect(self._new_profile)
        self.edit_btn = QPushButton("Modifier")
        self.edit_btn.clicked.connect(self._edit_profile)
        self.delete_btn = QPushButton("Supprimer")
        self.delete_btn.clicked.connect(self._delete_profile)
        btn_row.addWidget(self.new_btn)
        btn_row.addWidget(self.edit_btn)
        btn_row.addWidget(self.delete_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)
        layout.addWidget(QLabel(
            "Profil par défaut par source (pour normalisation batch / Inspecteur) :\n"
            "Si un épisode n'a pas de « profil préféré », le profil de sa source est utilisé."
        ))
        self.source_profile_table = QTableWidget()
        self.source_profile_table.setColumnCount(2)
        self.source_profile_table.setHorizontalHeaderLabels(["Source", "Profil"])
        self.source_profile_table.horizontalHeader().setStretchLastSection(True)
        layout.addWidget(self.source_profile_table)
        src_btn_row = QHBoxLayout()
        add_src_btn = QPushButton("Ajouter lien source→profil")
        add_src_btn.clicked.connect(self._add_source_profile_row)
        remove_src_btn = QPushButton("Supprimer la ligne")
        remove_src_btn.clicked.connect(self._remove_source_profile_row)
        src_btn_row.addWidget(add_src_btn)
        src_btn_row.addWidget(remove_src_btn)
        src_btn_row.addStretch()
        layout.addLayout(src_btn_row)
        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        bbox.rejected.connect(self._close_profiles_dialog)
        layout.addWidget(bbox)
        self._load_list()
        self._load_source_profile_table()
        self._on_selection_changed()

    def _load_list(self) -> None:
        self.list_widget.clear()
        self._custom_list = []
        if self._store:
            try:
                custom = self._store.load_custom_profiles()
                self._custom_list = [
                    {
                        "id": p.id,
                        "merge_subtitle_breaks": p.merge_subtitle_breaks,
                        "max_merge_examples_in_debug": p.max_merge_examples_in_debug,
                        "fix_double_spaces": getattr(p, "fix_double_spaces", True),
                        "fix_french_punctuation": getattr(p, "fix_french_punctuation", False),
                        "normalize_apostrophes": getattr(p, "normalize_apostrophes", False),
                        "normalize_quotes": getattr(p, "normalize_quotes", False),
                        "strip_line_spaces": getattr(p, "strip_line_spaces", True),
                        "case_transform": getattr(p, "case_transform", "none"),
                        "custom_regex_rules": [
                            {"pattern": rule[0], "replacement": rule[1]}
                            for rule in getattr(p, "custom_regex_rules", [])
                        ],
                    }
                    for p in custom.values()
                ]
            except ValueError as e:
                # Erreur de validation : afficher message et ne pas charger les profils
                QMessageBox.critical(
                    self, "Erreur profils",
                    f"Erreur de validation du fichier profiles.json :\n\n{e}\n\n"
                    "Corrigez le fichier ou supprimez-le pour réinitialiser."
                )
                self._custom_list = []
        for pid in PROFILES.keys():
            item = QListWidgetItem(f"{pid} (prédéfini)")
            item.setData(Qt.ItemDataRole.UserRole, ("builtin", pid))
            self.list_widget.addItem(item)
        for d in self._custom_list:
            pid = d.get("id") or ""
            if pid:
                item = QListWidgetItem(f"{pid} (personnalisé)")
                item.setData(Qt.ItemDataRole.UserRole, ("custom", pid))
                self.list_widget.addItem(item)

    def _on_selection_changed(self) -> None:
        item = self.list_widget.currentItem()
        is_custom = False
        if item:
            kind, _ = item.data(Qt.ItemDataRole.UserRole) or ("", "")
            is_custom = kind == "custom"
        self.edit_btn.setEnabled(is_custom)
        self.delete_btn.setEnabled(is_custom)

    def _save_custom(self) -> None:
        if self._store:
            try:
                self._store.save_custom_profiles(self._custom_list)
            except Exception as e:
                QMessageBox.critical(self, "Erreur", f"Impossible de sauvegarder les profils : {e}")
                return
        self._load_list()
        if self.parent() and hasattr(self.parent(), "_refresh_profile_combos"):
            self.parent()._refresh_profile_combos()

    def _new_profile(self) -> None:
        dlg = ProfileEditorDialog(self, None, self._store)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            profile_data = dlg.get_profile_data()
            pid = profile_data.get("id", "").strip()
            if not pid:
                QMessageBox.warning(self, "Profil", "Indiquez un id.")
                return
            if pid in PROFILES or any(p.get("id") == pid for p in self._custom_list):
                QMessageBox.warning(self, "Profil", "Cet id existe déjà.")
                return
            self._custom_list.append(profile_data)
            self._save_custom()

    def _edit_profile(self) -> None:
        item = self.list_widget.currentItem()
        if not item:
            return
        kind, pid = item.data(Qt.ItemDataRole.UserRole) or ("", "")
        if kind != "custom":
            return
        custom = next((p for p in self._custom_list if p.get("id") == pid), None)
        if not custom:
            return
        dlg = ProfileEditorDialog(self, custom, self._store)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            profile_data = dlg.get_profile_data()
            # Mettre à jour le profil existant
            for key, value in profile_data.items():
                custom[key] = value
            self._save_custom()

    def _delete_profile(self) -> None:
        item = self.list_widget.currentItem()
        if not item:
            return
        kind, pid = item.data(Qt.ItemDataRole.UserRole) or ("", "")
        if kind != "custom":
            return
        if QMessageBox.question(
            self, "Supprimer",
            f"Supprimer le profil « {pid} » ?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        ) != QMessageBox.StandardButton.Yes:
            return
        self._custom_list = [p for p in self._custom_list if p.get("id") != pid]
        self._save_custom()

    def _load_source_profile_table(self) -> None:
        self.source_profile_table.setRowCount(0)
        if not self._store:
            return
        defaults = self._store.load_source_profile_defaults()
        source_ids = AdapterRegistry.list_ids() or ["subslikescript"]
        profile_ids = list(get_all_profile_ids())
        for source_id, profile_id in defaults.items():
            row = self.source_profile_table.rowCount()
            self.source_profile_table.insertRow(row)
            src_combo = QComboBox()
            src_combo.addItems(source_ids)
            idx = src_combo.findText(source_id)
            if idx >= 0:
                src_combo.setCurrentIndex(idx)
            self.source_profile_table.setCellWidget(row, 0, src_combo)
            prof_combo = QComboBox()
            prof_combo.addItems(profile_ids)
            idx = prof_combo.findText(profile_id)
            if idx >= 0:
                prof_combo.setCurrentIndex(idx)
            self.source_profile_table.setCellWidget(row, 1, prof_combo)

    def _add_source_profile_row(self) -> None:
        source_ids = AdapterRegistry.list_ids() or ["subslikescript"]
        profile_ids = list(get_all_profile_ids())
        row = self.source_profile_table.rowCount()
        self.source_profile_table.insertRow(row)
        src_combo = QComboBox()
        src_combo.addItems(source_ids)
        self.source_profile_table.setCellWidget(row, 0, src_combo)
        prof_combo = QComboBox()
        prof_combo.addItems(profile_ids)
        self.source_profile_table.setCellWidget(row, 1, prof_combo)

    def _remove_source_profile_row(self) -> None:
        row = self.source_profile_table.currentRow()
        if row >= 0:
            self.source_profile_table.removeRow(row)

    def _save_source_profile_defaults(self) -> None:
        if not self._store:
            return
        defaults: dict[str, str] = {}
        for row in range(self.source_profile_table.rowCount()):
            src_w = self.source_profile_table.cellWidget(row, 0)
            prof_w = self.source_profile_table.cellWidget(row, 1)
            if src_w and prof_w:
                src = (src_w.currentText() or "").strip()
                prof = (prof_w.currentText() or "").strip()
                if src and prof:
                    defaults[src] = prof
        self._store.save_source_profile_defaults(defaults)

    def _close_profiles_dialog(self) -> None:
        self._save_source_profile_defaults()
        self.reject()


class ProfileEditorDialog(QDialog):
    """Dialogue d'édition de profil avec prévisualisation en temps réel."""
    
    def __init__(self, parent: QWidget | None, profile_data: dict[str, Any] | None, store: ProjectStore | None):
        super().__init__(parent)
        self.setWindowTitle("Éditer le profil de normalisation")
        self.resize(900, 700)
        self._store = store
        self._is_editing = profile_data is not None
        
        main_layout = QVBoxLayout(self)
        
        # Splitter : Formulaire (gauche) | Prévisualisation (droite)
        splitter = QSplitter(Qt.Orientation.Horizontal)
        
        # === Panneau gauche : Formulaire ===
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        
        # ID du profil
        id_group = QGroupBox("Identité")
        id_layout = QFormLayout(id_group)
        self.id_edit = QLineEdit()
        if profile_data:
            self.id_edit.setText(profile_data.get("id", ""))
            self.id_edit.setReadOnly(True)
        else:
            self.id_edit.setPlaceholderText("ex: mon_profil_fr")
        id_layout.addRow("ID du profil :", self.id_edit)
        left_layout.addWidget(id_group)
        
        # Règles de fusion de lignes
        merge_group = QGroupBox("Fusion de lignes (césures sous-titres)")
        merge_layout = QFormLayout(merge_group)
        self.merge_cb = QCheckBox()
        self.merge_cb.setChecked(profile_data.get("merge_subtitle_breaks", True) if profile_data else True)
        self.merge_cb.setToolTip("Fusionne les lignes coupées en milieu de phrase (typique des sous-titres)")
        merge_layout.addRow("Fusionner césures :", self.merge_cb)
        self.max_spin = QSpinBox()
        self.max_spin.setRange(0, 100)
        self.max_spin.setValue(profile_data.get("max_merge_examples_in_debug", 20) if profile_data else 20)
        self.max_spin.setToolTip("Nombre d'exemples de fusion à conserver dans les logs de debug")
        merge_layout.addRow("Max exemples debug :", self.max_spin)
        left_layout.addWidget(merge_group)
        
        # Règles de ponctuation et espaces
        punct_group = QGroupBox("Ponctuation et espaces")
        punct_layout = QFormLayout(punct_group)
        
        self.fix_double_spaces_cb = QCheckBox()
        self.fix_double_spaces_cb.setChecked(profile_data.get("fix_double_spaces", True) if profile_data else True)
        self.fix_double_spaces_cb.setToolTip("Remplace les espaces multiples consécutifs par un seul espace")
        punct_layout.addRow("Corriger doubles espaces :", self.fix_double_spaces_cb)
        
        self.fix_french_punct_cb = QCheckBox()
        self.fix_french_punct_cb.setChecked(profile_data.get("fix_french_punctuation", False) if profile_data else False)
        self.fix_french_punct_cb.setToolTip("Ajoute un espace insécable avant ; : ! ? (typographie française)")
        punct_layout.addRow("Ponctuation française :", self.fix_french_punct_cb)
        
        self.normalize_apos_cb = QCheckBox()
        self.normalize_apos_cb.setChecked(profile_data.get("normalize_apostrophes", False) if profile_data else False)
        self.normalize_apos_cb.setToolTip("Remplace les apostrophes droites (') par des apostrophes typographiques (')")
        punct_layout.addRow("Normaliser apostrophes (' → ') :", self.normalize_apos_cb)
        
        self.normalize_quotes_cb = QCheckBox()
        self.normalize_quotes_cb.setChecked(profile_data.get("normalize_quotes", False) if profile_data else False)
        self.normalize_quotes_cb.setToolTip("Remplace les guillemets droits (\") par des guillemets français (« »)")
        punct_layout.addRow("Normaliser guillemets (\" → « ») :", self.normalize_quotes_cb)
        
        self.strip_spaces_cb = QCheckBox()
        self.strip_spaces_cb.setChecked(profile_data.get("strip_line_spaces", True) if profile_data else True)
        self.strip_spaces_cb.setToolTip("Supprime les espaces en début et fin de ligne")
        punct_layout.addRow("Supprimer espaces début/fin :", self.strip_spaces_cb)
        
        left_layout.addWidget(punct_group)
        
        # Règles de casse (Phase 3)
        case_group = QGroupBox("Transformation de casse")
        case_layout = QFormLayout(case_group)
        self.case_combo = QComboBox()
        self.case_combo.addItems(["none", "lowercase", "UPPERCASE", "Title Case", "Sentence case"])
        current_case = profile_data.get("case_transform", "none") if profile_data else "none"
        idx = self.case_combo.findText(current_case)
        if idx >= 0:
            self.case_combo.setCurrentIndex(idx)
        self.case_combo.setToolTip(
            "Transformation de casse appliquée au texte final :\n"
            "- none : Pas de transformation\n"
            "- lowercase : tout en minuscules\n"
            "- UPPERCASE : TOUT EN MAJUSCULES\n"
            "- Title Case : Première Lettre De Chaque Mot\n"
            "- Sentence case : Première lettre en majuscule"
        )
        case_layout.addRow("Casse :", self.case_combo)
        left_layout.addWidget(case_group)
        
        # Règles regex personnalisées (Phase 3)
        regex_group = QGroupBox("Règles regex personnalisées (avancé)")
        regex_layout = QVBoxLayout(regex_group)
        regex_layout.addWidget(QLabel("<i>Remplacements arbitraires via expressions régulières</i>"))
        
        # Liste des règles regex
        self.regex_list_widget = QListWidget()
        self.regex_list_widget.setMaximumHeight(120)
        regex_layout.addWidget(self.regex_list_widget)
        
        # Boutons gestion regex
        regex_btn_layout = QHBoxLayout()
        add_regex_btn = QPushButton("+ Ajouter règle")
        add_regex_btn.clicked.connect(self._add_regex_rule)
        edit_regex_btn = QPushButton("✏️ Modifier")
        edit_regex_btn.clicked.connect(self._edit_regex_rule)
        remove_regex_btn = QPushButton("🗑️ Supprimer")
        remove_regex_btn.clicked.connect(self._remove_regex_rule)
        regex_btn_layout.addWidget(add_regex_btn)
        regex_btn_layout.addWidget(edit_regex_btn)
        regex_btn_layout.addWidget(remove_regex_btn)
        regex_btn_layout.addStretch()
        regex_layout.addLayout(regex_btn_layout)
        
        left_layout.addWidget(regex_group)
        
        # Charger les règles regex existantes
        self._regex_rules: list[tuple[str, str]] = []
        if profile_data and "custom_regex_rules" in profile_data:
            for rule in profile_data["custom_regex_rules"]:
                if isinstance(rule, dict) and "pattern" in rule and "replacement" in rule:
                    self._regex_rules.append((rule["pattern"], rule["replacement"]))
                elif isinstance(rule, (tuple, list)) and len(rule) == 2:
                    self._regex_rules.append((str(rule[0]), str(rule[1])))
        self._refresh_regex_list()
        
        # Bouton de test
        test_btn = QPushButton("Tester le profil →")
        test_btn.clicked.connect(self._update_preview)
        left_layout.addWidget(test_btn)
        
        left_layout.addStretch()
        
        # === Panneau droit : Prévisualisation ===
        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)
        right_layout.addWidget(QLabel("<b>Prévisualisation</b> (avant → après)"))
        
        # Onglets : Résultat | Diff | Historique
        self.preview_tabs = QTabWidget()
        
        # Tab 1 : Résultat (avant/après classique)
        result_tab = QWidget()
        result_layout = QVBoxLayout(result_tab)
        result_layout.addWidget(QLabel("Texte brut (RAW) :"))
        self.preview_input = QPlainTextEdit()
        self.preview_input.setPlaceholderText("Collez ici un extrait de texte à normaliser...")
        self.preview_input.setMaximumHeight(150)
        # Texte d'exemple par défaut
        default_text = (
            "Salut  ,  comment   ça  va?\n"
            "Je suis content de te voir!\n"
            "C'est vraiment\n"
            "génial d'être ici.\n"
            "\n"
            "Marshall: Alors,  qu'est-ce qu'on fait?\n"
            'Ted: "On pourrait aller au bar."'
        )
        self.preview_input.setPlainText(default_text)
        result_layout.addWidget(self.preview_input)
        
        result_layout.addWidget(QLabel("Texte normalisé (CLEAN) :"))
        self.preview_output = QPlainTextEdit()
        self.preview_output.setReadOnly(True)
        result_layout.addWidget(self.preview_output)
        self.preview_tabs.addTab(result_tab, "📄 Résultat")
        
        # Tab 2 : Diff coloré
        diff_tab = QWidget()
        diff_layout = QVBoxLayout(diff_tab)
        diff_layout.addWidget(QLabel("<i>Différences ligne par ligne (vert = ajouté, rouge = supprimé)</i>"))
        self.diff_output = QPlainTextEdit()
        self.diff_output.setReadOnly(True)
        self.diff_output.setStyleSheet("QPlainTextEdit { font-family: 'Courier New', monospace; }")
        diff_layout.addWidget(self.diff_output)
        self.preview_tabs.addTab(diff_tab, "🔀 Diff")
        
        # Tab 3 : Historique des transformations
        history_tab = QWidget()
        history_layout = QVBoxLayout(history_tab)
        history_layout.addWidget(QLabel("<i>Historique détaillé des transformations appliquées</i>"))
        self.history_output = QPlainTextEdit()
        self.history_output.setReadOnly(True)
        history_layout.addWidget(self.history_output)
        self.preview_tabs.addTab(history_tab, "📜 Historique")
        
        right_layout.addWidget(self.preview_tabs)
        
        # Statistiques
        self.stats_label = QLabel("")
        right_layout.addWidget(self.stats_label)
        
        # Ajouter au splitter
        splitter.addWidget(left_widget)
        splitter.addWidget(right_widget)
        splitter.setSizes([400, 500])
        main_layout.addWidget(splitter)
        
        # Boutons OK / Annuler
        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(self.accept)
        bbox.rejected.connect(self.reject)
        main_layout.addWidget(bbox)
        
        # Prévisualisation initiale
        self._update_preview()
        
        # Connexions pour mise à jour automatique
        self.merge_cb.toggled.connect(self._update_preview)
        self.fix_double_spaces_cb.toggled.connect(self._update_preview)
        self.fix_french_punct_cb.toggled.connect(self._update_preview)
        self.normalize_apos_cb.toggled.connect(self._update_preview)
        self.normalize_quotes_cb.toggled.connect(self._update_preview)
        self.strip_spaces_cb.toggled.connect(self._update_preview)
        self.case_combo.currentIndexChanged.connect(self._update_preview)
    
    def _refresh_regex_list(self) -> None:
        """Rafraîchit l'affichage de la liste des règles regex."""
        self.regex_list_widget.clear()
        for i, (pattern, replacement) in enumerate(self._regex_rules):
            display = f"{i+1}. /{pattern}/ → \"{replacement}\""
            if len(display) > 80:
                display = display[:77] + "..."
            self.regex_list_widget.addItem(display)
    
    def _add_regex_rule(self) -> None:
        """Dialogue pour ajouter une règle regex personnalisée."""
        dlg = QDialog(self)
        dlg.setWindowTitle("Ajouter une règle regex")
        layout = QFormLayout(dlg)
        
        pattern_edit = QLineEdit()
        pattern_edit.setPlaceholderText(r"ex: \s+[,;]")
        layout.addRow("Pattern (regex) :", pattern_edit)
        
        replacement_edit = QLineEdit()
        replacement_edit.setPlaceholderText(r"ex: ,")
        layout.addRow("Remplacement :", replacement_edit)
        
        layout.addWidget(QLabel("<i>Exemple : Pattern = '\\s+,' → Remplacement = ',' supprime espaces avant virgule</i>"))
        
        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(dlg.accept)
        bbox.rejected.connect(dlg.reject)
        layout.addRow(bbox)
        
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        
        pattern = pattern_edit.text().strip()
        replacement = replacement_edit.text()
        
        if not pattern:
            QMessageBox.warning(self, "Règle regex", "Le pattern ne peut pas être vide.")
            return
        
        # Valider que le pattern est une regex valide
        try:
            import re
            re.compile(pattern)
        except re.error as e:
            QMessageBox.critical(self, "Règle regex", f"Pattern regex invalide :\n\n{e}")
            return
        
        self._regex_rules.append((pattern, replacement))
        self._refresh_regex_list()
        self._update_preview()
    
    def _edit_regex_rule(self) -> None:
        """Dialogue pour modifier une règle regex existante."""
        current_idx = self.regex_list_widget.currentRow()
        if current_idx < 0 or current_idx >= len(self._regex_rules):
            QMessageBox.information(self, "Règle regex", "Sélectionnez une règle à modifier.")
            return
        
        pattern, replacement = self._regex_rules[current_idx]
        
        dlg = QDialog(self)
        dlg.setWindowTitle("Modifier la règle regex")
        layout = QFormLayout(dlg)
        
        pattern_edit = QLineEdit()
        pattern_edit.setText(pattern)
        layout.addRow("Pattern (regex) :", pattern_edit)
        
        replacement_edit = QLineEdit()
        replacement_edit.setText(replacement)
        layout.addRow("Remplacement :", replacement_edit)
        
        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(dlg.accept)
        bbox.rejected.connect(dlg.reject)
        layout.addRow(bbox)
        
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        
        new_pattern = pattern_edit.text().strip()
        new_replacement = replacement_edit.text()
        
        if not new_pattern:
            QMessageBox.warning(self, "Règle regex", "Le pattern ne peut pas être vide.")
            return
        
        # Valider que le pattern est une regex valide
        try:
            import re
            re.compile(new_pattern)
        except re.error as e:
            QMessageBox.critical(self, "Règle regex", f"Pattern regex invalide :\n\n{e}")
            return
        
        self._regex_rules[current_idx] = (new_pattern, new_replacement)
        self._refresh_regex_list()
        self._update_preview()
    
    def _remove_regex_rule(self) -> None:
        """Supprime une règle regex."""
        current_idx = self.regex_list_widget.currentRow()
        if current_idx < 0 or current_idx >= len(self._regex_rules):
            QMessageBox.information(self, "Règle regex", "Sélectionnez une règle à supprimer.")
            return
        
        del self._regex_rules[current_idx]
        self._refresh_regex_list()
        self._update_preview()
    
    def _compute_diff(self, before: str, after: str) -> str:
        """Calcule le diff ligne par ligne entre deux textes.
        
        Format simple coloré par HTML (vert = ajouté, rouge = supprimé, bleu = modifié).
        """
        
        before_lines = before.splitlines()
        after_lines = after.splitlines()
        
        diff_lines = []
        matcher = difflib.SequenceMatcher(None, before_lines, after_lines)
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'equal':
                for line in before_lines[i1:i2]:
                    diff_lines.append(f"  {line}")
            elif tag == 'replace':
                for line in before_lines[i1:i2]:
                    diff_lines.append(f"- {line}  [SUPPRIMÉ]")
                for line in after_lines[j1:j2]:
                    diff_lines.append(f"+ {line}  [AJOUTÉ]")
            elif tag == 'delete':
                for line in before_lines[i1:i2]:
                    diff_lines.append(f"- {line}  [SUPPRIMÉ]")
            elif tag == 'insert':
                for line in after_lines[j1:j2]:
                    diff_lines.append(f"+ {line}  [AJOUTÉ]")
        
        return "\n".join(diff_lines)
    
    def _update_preview(self) -> None:
        """Met à jour la prévisualisation avec les règles actuelles (résultat, diff, historique)."""
        raw_text = self.preview_input.toPlainText()
        if not raw_text.strip():
            self.preview_output.setPlainText("")
            self.diff_output.setPlainText("")
            self.history_output.setPlainText("")
            self.stats_label.setText("")
            return
        
        # Créer un profil temporaire avec les paramètres actuels
        temp_profile = NormalizationProfile(
            id="temp_preview",
            merge_subtitle_breaks=self.merge_cb.isChecked(),
            max_merge_examples_in_debug=self.max_spin.value(),
            fix_double_spaces=self.fix_double_spaces_cb.isChecked(),
            fix_french_punctuation=self.fix_french_punct_cb.isChecked(),
            normalize_apostrophes=self.normalize_apos_cb.isChecked(),
            normalize_quotes=self.normalize_quotes_cb.isChecked(),
            strip_line_spaces=self.strip_spaces_cb.isChecked(),
            case_transform=self.case_combo.currentText(),
            custom_regex_rules=self._regex_rules,
        )
        
        # Appliquer la normalisation
        clean_text, stats, debug = temp_profile.apply(raw_text)
        
        # Tab 1 : Résultat
        self.preview_output.setPlainText(clean_text)
        
        # Tab 2 : Diff coloré
        diff_text = self._compute_diff(raw_text, clean_text)
        self.diff_output.setPlainText(diff_text)
        
        # Tab 3 : Historique des transformations
        history_lines = []
        history_lines.append("=== Historique des transformations ===\n")
        
        # 1. Fusion de lignes
        if stats.merges > 0:
            history_lines.append(f"✓ Fusion de lignes : {stats.merges} fusion(s)")
            merge_examples = debug.get("merge_examples", [])
            if merge_examples:
                history_lines.append("  Exemples :")
                for ex in merge_examples[:5]:  # Limiter à 5 exemples
                    history_lines.append(f"    - \"{ex.get('before', '')}\" + \"{ex.get('after', '')}\"")
        
        # 2. Corrections ponctuation
        punct_fixes = debug.get("punctuation_fixes", 0)
        if punct_fixes > 0:
            history_lines.append(f"\n✓ Corrections ponctuation/espaces : {punct_fixes} correction(s)")
        
        # 3. Remplacements regex
        regex_repl = debug.get("regex_replacements", 0)
        if regex_repl > 0:
            history_lines.append(f"\n✓ Remplacements regex : {regex_repl} remplacement(s)")
            history_lines.append("  Règles appliquées :")
            for i, (pattern, repl) in enumerate(self._regex_rules):
                history_lines.append(f"    {i+1}. /{pattern}/ → \"{repl}\"")
        
        # 4. Transformation de casse
        case_transforms = debug.get("case_transforms", 0)
        if case_transforms > 0 or self.case_combo.currentText() != "none":
            history_lines.append(f"\n✓ Transformation de casse : {self.case_combo.currentText()}")
        
        # 5. Historique détaillé (transformations ligne par ligne)
        history_detail = debug.get("history", [])
        if history_detail:
            history_lines.append(f"\n=== Détail ligne par ligne (premiers {len(history_detail)} changements) ===\n")
            for i, h in enumerate(history_detail[:20], 1):  # Limiter à 20
                step = h.get("step", "unknown")
                before = h.get("before", "")
                after = h.get("after", "")
                history_lines.append(f"{i}. Étape: {step}")
                history_lines.append(f"   Avant : {before}")
                history_lines.append(f"   Après : {after}\n")
        
        if not any([stats.merges, punct_fixes, regex_repl, case_transforms]):
            history_lines.append("\n⚠️ Aucune transformation appliquée (toutes les règles sont désactivées ou aucune correspondance)")
        
        self.history_output.setPlainText("\n".join(history_lines))
        
        # Afficher les statistiques
        punct_fixes_stat = debug.get("punctuation_fixes", 0)
        regex_stat = debug.get("regex_replacements", 0)
        stats_text = (
            f"<b>Statistiques :</b> "
            f"{stats.raw_lines} lignes brutes → {stats.clean_lines} lignes nettoyées | "
            f"{stats.merges} fusion(s) | "
            f"{punct_fixes_stat} correction(s) ponctuation | "
            f"{regex_stat} remplacement(s) regex | "
            f"{stats.duration_ms} ms"
        )
        self.stats_label.setText(stats_text)
    
    def get_profile_data(self) -> dict[str, Any]:
        """Retourne les données du profil depuis le formulaire."""
        # Convertir les règles regex au format JSON
        regex_rules_json = [
            {"pattern": pattern, "replacement": replacement}
            for pattern, replacement in self._regex_rules
        ]
        
        return {
            "id": self.id_edit.text().strip(),
            "merge_subtitle_breaks": self.merge_cb.isChecked(),
            "max_merge_examples_in_debug": self.max_spin.value(),
            "fix_double_spaces": self.fix_double_spaces_cb.isChecked(),
            "fix_french_punctuation": self.fix_french_punct_cb.isChecked(),
            "normalize_apostrophes": self.normalize_apos_cb.isChecked(),
            "normalize_quotes": self.normalize_quotes_cb.isChecked(),
            "strip_line_spaces": self.strip_spaces_cb.isChecked(),
            "case_transform": self.case_combo.currentText(),
            "custom_regex_rules": regex_rules_json,
        }
