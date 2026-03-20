"""Onglet Personnages : noms canoniques, par langue, assignation, propagation."""

from __future__ import annotations

import json
import logging
from typing import Callable

from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.app.ui_utils import require_project, require_project_and_db
from howimetyourcorpus.core.align import format_segment_kind_label, parse_run_segment_kind

logger = logging.getLogger(__name__)


class PersonnagesTabWidget(QWidget):
    """Widget de l'onglet Personnages : liste personnages, assignation segment/cue → personnage, propagation."""

    def __init__(
        self,
        get_store: Callable[[], object],
        get_db: Callable[[], object],
        show_status: Callable[[str, int], None],
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._show_status = show_status

        layout = QVBoxLayout(self)
        workflow_label = QLabel(
            "Workflow : 1) Définir la liste des personnages (Nouveau / Importer depuis les segments). "
            "2) Par épisode : Charger Segments ou Cues, assigner, Enregistrer assignations. "
            "3) Propager vers les fichiers (utilise l’alignement ; les noms apparaissent dans l’export SRT et le concordancier)."
        )
        workflow_label.setWordWrap(True)
        workflow_label.setStyleSheet("color: #555; font-style: italic;")
        layout.addWidget(workflow_label)

        layout.addWidget(QLabel("1. Liste des personnages"))
        self.personnages_table = QTableWidget()
        self.personnages_table.setColumnCount(5)
        self.personnages_table.setHorizontalHeaderLabels(["Id", "Canonique", "EN", "FR", "Alias"])
        self.personnages_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.personnages_table.setToolTip("§8 — Alias : variantes (TED, Marshall:, etc.) pour la suggestion d'assignation. Séparez par des virgules.")
        layout.addWidget(self.personnages_table)
        btn_row = QHBoxLayout()
        self.personnages_add_btn = QPushButton("Nouveau")
        self.personnages_add_btn.setToolTip("Ajoute une ligne vide pour créer un personnage (Id, Canonique, noms par langue, alias).")
        self.personnages_add_btn.clicked.connect(self._add_row)
        self.personnages_remove_btn = QPushButton("Supprimer")
        self.personnages_remove_btn.setToolTip("Supprime le personnage de la ligne sélectionnée.")
        self.personnages_remove_btn.clicked.connect(self._remove_row)
        self.personnages_save_btn = QPushButton("Enregistrer")
        self.personnages_save_btn.setToolTip("Enregistre la liste des personnages (à faire après ajout ou modification).")
        self.personnages_save_btn.clicked.connect(self._save)
        self.personnages_import_speakers_btn = QPushButton("Importer depuis les segments")
        self.personnages_import_speakers_btn.setToolTip(
            "Récupère les noms de locuteurs (Marshall, Ted, etc.) détectés dans les segments du transcript (format « Nom : »). "
            "N’ajoute pas les noms déjà présents dans la grille."
        )
        self.personnages_import_speakers_btn.clicked.connect(self._import_speakers_from_segments)
        btn_row.addWidget(self.personnages_add_btn)
        btn_row.addWidget(self.personnages_remove_btn)
        btn_row.addWidget(self.personnages_save_btn)
        btn_row.addWidget(self.personnages_import_speakers_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)
        layout.addWidget(QLabel("2. Assignation (segment ou cue → personnage)"))
        assign_row = QHBoxLayout()
        assign_row.addWidget(QLabel("Épisode:"))
        self.personnages_episode_combo = QComboBox()
        self.personnages_episode_combo.setMinimumWidth(200)
        self.personnages_episode_combo.setToolTip("Épisode pour lequel charger et assigner les segments ou les cues.")
        assign_row.addWidget(self.personnages_episode_combo)
        self.personnages_episode_combo.currentIndexChanged.connect(self._fill_propagate_run_combo)
        assign_row.addWidget(QLabel("Source:"))
        self.personnages_source_combo = QComboBox()
        self.personnages_source_combo.addItem("Segments (phrases)", "segments")
        self.personnages_source_combo.addItem("Segments (tours)", "segments_utterance")
        self.personnages_source_combo.addItem("Cues EN", "cues_en")
        self.personnages_source_combo.addItem("Cues FR", "cues_fr")
        self.personnages_source_combo.addItem("Cues IT", "cues_it")
        self.personnages_source_combo.setToolTip(
            "Phrases = découpage . ? ! du transcript. Tours = une ligne par prise de parole (format « Nom : »). Cues = répliques des pistes sous-titres (EN/FR/IT)."
        )
        self.personnages_source_combo.currentIndexChanged.connect(self._on_assign_source_changed)
        assign_row.addWidget(self.personnages_source_combo)
        self.personnages_load_assign_btn = QPushButton("Charger")
        self.personnages_load_assign_btn.setToolTip("Charge la liste des segments ou cues de l’épisode pour assigner un personnage à chaque ligne.")
        self.personnages_load_assign_btn.clicked.connect(self._load_assignments)
        assign_row.addWidget(self.personnages_load_assign_btn)
        self.personnages_suggest_alias_btn = QPushButton("Suggérer par alias")
        self.personnages_suggest_alias_btn.setToolTip(
            "§8 — Remplit la colonne Personnage lorsque le début du texte correspond à un alias (ex. TED:, Marshall:)."
        )
        self.personnages_suggest_alias_btn.clicked.connect(self._suggest_by_alias)
        assign_row.addWidget(self.personnages_suggest_alias_btn)
        layout.addLayout(assign_row)
        self.personnages_assign_table = QTableWidget()
        self.personnages_assign_table.setColumnCount(3)
        self.personnages_assign_table.setHorizontalHeaderLabels(["ID", "Texte", "Personnage"])
        self.personnages_assign_table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        layout.addWidget(self.personnages_assign_table)
        self.personnages_assign_note_label = QLabel("")
        self.personnages_assign_note_label.setWordWrap(True)
        self.personnages_assign_note_label.setStyleSheet("color: #666; font-size: 0.9em;")
        layout.addWidget(self.personnages_assign_note_label)
        self.personnages_save_assign_btn = QPushButton("Enregistrer assignations")
        self.personnages_save_assign_btn.setToolTip("Enregistre les personnages assignés pour cet épisode et cette source. À faire avant de lancer la propagation.")
        self.personnages_save_assign_btn.clicked.connect(self._save_assignments)
        layout.addWidget(self.personnages_save_assign_btn)

        layout.addWidget(QLabel("3. Propagation vers les fichiers"))
        prop_row = QHBoxLayout()
        prop_row.addWidget(QLabel("Run d’alignement:"))
        self.personnages_run_combo = QComboBox()
        self.personnages_run_combo.setMinimumWidth(220)
        self.personnages_run_combo.setToolTip(
            "Run utilisé pour propager les noms le long des liens d'alignement (phrase ↔ cue pivot ↔ cues cibles). Créé dans l’onglet Alignement."
        )
        prop_row.addWidget(self.personnages_run_combo)
        self.personnages_propagate_btn = QPushButton("Propager")
        self.personnages_propagate_btn.setToolTip(
            "Suit les liens du run : assignations sur les phrases ou sur les cues pivot → préfixe « Nom : » sur les cues alignées et réécriture des SRT. "
            "Les assignations sur les tours sont propagées quand le run sélectionné est basé sur les tours. "
            "Prérequis : assignations enregistrées, run sélectionné."
        )
        self.personnages_propagate_btn.clicked.connect(self._propagate)
        prop_row.addWidget(self.personnages_propagate_btn)
        prop_row.addStretch()
        layout.addLayout(prop_row)

    def refresh(self) -> None:
        """Charge la liste des personnages et le combo épisodes (préserve l'épisode courant si possible)."""
        current_episode_id = self.personnages_episode_combo.currentData()
        self.personnages_table.setRowCount(0)
        self.personnages_episode_combo.clear()
        store = self._get_store()
        if not store:
            return
        langs = store.load_project_languages()
        self.personnages_table.setColumnCount(2 + len(langs) + 1)
        self.personnages_table.setHorizontalHeaderLabels(
            ["Id", "Canonique"] + [lang.upper() for lang in langs] + ["Alias"]
        )
        self.personnages_source_combo.clear()
        self.personnages_source_combo.addItem("Segments (phrases)", "segments")
        self.personnages_source_combo.addItem("Segments (tours)", "segments_utterance")
        for lang in langs:
            self.personnages_source_combo.addItem(f"Cues {lang.upper()}", f"cues_{lang}")
        characters = store.load_character_names()
        for ch in characters:
            row = self.personnages_table.rowCount()
            self.personnages_table.insertRow(row)
            names = ch.get("names_by_lang") or {}
            self.personnages_table.setItem(row, 0, QTableWidgetItem(ch.get("id") or ""))
            self.personnages_table.setItem(row, 1, QTableWidgetItem(ch.get("canonical") or ""))
            for i, lang in enumerate(langs):
                self.personnages_table.setItem(
                    row, 2 + i, QTableWidgetItem(names.get(lang, ""))
                )
            aliases = ch.get("aliases") or []
            self.personnages_table.setItem(row, 2 + len(langs), QTableWidgetItem(", ".join(aliases)))
        index = store.load_series_index()
        if index and index.episodes:
            for e in index.episodes:
                self.personnages_episode_combo.addItem(
                    f"{e.episode_id} - {e.title}", e.episode_id
                )
            if current_episode_id:
                for i in range(self.personnages_episode_combo.count()):
                    if self.personnages_episode_combo.itemData(i) == current_episode_id:
                        self.personnages_episode_combo.setCurrentIndex(i)
                        break
        self._fill_propagate_run_combo()

    def _on_assign_source_changed(self) -> None:
        """Affiche la note explicative lorsque la source est « Segments (tours) »."""
        source_key = self.personnages_source_combo.currentData()
        if source_key == "segments_utterance":
            self.personnages_assign_note_label.setText(
                "Assignation par tours : enregistrée pour le transcript (speaker_explicit). "
                "La propagation vers les SRT utilise les liens d'alignement : si le run choisi est basé sur les tours (onglet Alignement), les assignations ici seront propagées ; "
                "si le run est basé sur les phrases, seules les assignations sur les phrases ou sur les cues sont propagées."
            )
        else:
            self.personnages_assign_note_label.setText("")

    def _ask_languages_to_rewrite(self, langs_available: list[str]) -> set[str] | None:
        """Demande à l'utilisateur quelles langues réécrire (fichiers SRT). Retourne le set des langues cochées ou None si annulé."""
        if not langs_available:
            return set()
        dlg = QDialog(self)
        dlg.setWindowTitle("Propagation — langues à réécrire")
        layout = QVBoxLayout(dlg)
        layout.addWidget(QLabel("Réécrire les fichiers SRT pour les langues suivantes :\n(Décocher pour ne pas modifier le fichier.)"))
        checkboxes: dict[str, QCheckBox] = {}
        for lang in langs_available:
            cb = QCheckBox(lang.upper(), dlg)
            cb.setChecked(True)
            checkboxes[lang] = cb
            layout.addWidget(cb)
        bbox = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        bbox.accepted.connect(dlg.accept)
        bbox.rejected.connect(dlg.reject)
        layout.addWidget(bbox)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return None
        return {lang for lang, cb in checkboxes.items() if cb.isChecked()}

    def _fill_propagate_run_combo(self) -> None:
        """Remplit le combo des runs d'alignement pour l'épisode sélectionné."""
        self.personnages_run_combo.clear()
        eid = self.personnages_episode_combo.currentData()
        db = self._get_db()
        if not eid or not db:
            return
        runs = db.get_align_runs_for_episode(eid)
        for r in runs:
            run_id = r.get("align_run_id") or ""
            summary = r.get("summary_json") or ""
            segment_kind, _ = parse_run_segment_kind(
                r.get("params_json"),
                run_id=run_id,
                logger_obj=logger,
            )
            label = f"{run_id}{format_segment_kind_label(segment_kind)}"
            if summary:
                try:
                    s = json.loads(summary)
                    if isinstance(s, dict):
                        links_count = s.get("nb_links")
                        if links_count is None:
                            links_count = s.get("total_links")
                        if links_count is not None:
                            label = f"{label} ({links_count} liens)"
                except (TypeError, ValueError) as e:
                    logger.debug("Could not parse align run summary_json for %s: %s", run_id, e)
            self.personnages_run_combo.addItem(label, run_id)

    def _add_row(self) -> None:
        row = self.personnages_table.rowCount()
        self.personnages_table.insertRow(row)
        for c in range(self.personnages_table.columnCount()):
            self.personnages_table.setItem(row, c, QTableWidgetItem(""))

    def _remove_row(self) -> None:
        row = self.personnages_table.currentRow()
        if row >= 0:
            self.personnages_table.removeRow(row)

    @require_project_and_db
    def _import_speakers_from_segments(self) -> None:
        """Récupère les noms de locuteurs des segments (Inspecteur) et les ajoute à la grille des personnages."""
        store = self._get_store()
        db = self._get_db()
        index = store.load_series_index()
        if not index or not index.episodes:
            QMessageBox.warning(
                self, "Personnages", "Aucun épisode dans l'index. Ajoutez des épisodes au corpus."
            )
            return
        episode_ids = [e.episode_id for e in index.episodes]
        speakers = db.get_distinct_speaker_explicit(episode_ids)
        if not speakers:
            QMessageBox.information(
                self,
                "Personnages",
                "Aucun nom de locuteur trouvé dans les segments. Segmentez d'abord les épisodes (Inspecteur).",
            )
            return
        characters = list(store.load_character_names())
        langs = store.load_project_languages()
        first_lang = (langs[0] if langs else "en").lower()
        existing_canonical_lower = {(ch.get("canonical") or "").strip().lower() for ch in characters}
        existing_id_lower = {(ch.get("id") or "").strip().lower() for ch in characters}
        added = 0
        for name in speakers:
            n = (name or "").strip()
            if not n:
                continue
            norm_id = n.lower().replace(" ", "_")
            if n.lower() in existing_canonical_lower or norm_id in existing_id_lower:
                continue
            characters.append({
                "id": norm_id,
                "canonical": n,
                "names_by_lang": {first_lang: n},
            })
            existing_canonical_lower.add(n.lower())
            existing_id_lower.add(norm_id)
            added += 1
        if added:
            try:
                store.save_character_names(characters)
            except ValueError as exc:
                QMessageBox.warning(self, "Personnages", str(exc))
                return
            self.refresh()
            self._show_status(f"{added} nom(s) importé(s) depuis les segments.", 4000)
        else:
            QMessageBox.information(
                self, "Personnages", "Tous les noms trouvés dans les segments sont déjà dans la grille."
            )

    @require_project
    def _save(self) -> None:
        store = self._get_store()
        langs = store.load_project_languages()
        characters = []
        for row in range(self.personnages_table.rowCount()):
            id_item = self.personnages_table.item(row, 0)
            canon_item = self.personnages_table.item(row, 1)
            cid = (id_item.text() or "").strip() if id_item else ""
            canon = (canon_item.text() or "").strip() if canon_item else ""
            if not cid and not canon:
                continue
            names_by_lang = {}
            for i, lang in enumerate(langs):
                if 2 + i < self.personnages_table.columnCount():
                    item = self.personnages_table.item(row, 2 + i)
                    if item and (item.text() or "").strip():
                        names_by_lang[lang] = (item.text() or "").strip()
            aliases_raw = ""
            alias_col = 2 + len(langs)
            if alias_col < self.personnages_table.columnCount():
                alias_item = self.personnages_table.item(row, alias_col)
                if alias_item:
                    aliases_raw = (alias_item.text() or "").strip()
            aliases = [s.strip() for s in aliases_raw.replace(",", "\n").splitlines() if s.strip()]
            characters.append({
                "id": cid or canon.lower().replace(" ", "_"),
                "canonical": canon or cid,
                "names_by_lang": names_by_lang,
                "aliases": aliases,
            })
        try:
            store.save_character_names(characters)
        except ValueError as exc:
            QMessageBox.warning(self, "Personnages", str(exc))
            return
        self._show_status("Personnages enregistrés.", 3000)

    @require_project_and_db
    def _load_assignments(self) -> None:
        eid = self.personnages_episode_combo.currentData()
        source_key = self.personnages_source_combo.currentData() or "segments"
        store = self._get_store()
        db = self._get_db()
        if not eid:
            QMessageBox.warning(self, "Personnages", "Sélectionnez un épisode.")
            return
        character_ids = [
            ch.get("id") or ch.get("canonical", "")
            for ch in store.load_character_names()
            if ch.get("id") or ch.get("canonical")
        ]
        assignments = store.load_character_assignments()
        source_type = "segment" if source_key in ("segments", "segments_utterance") else "cue"
        assign_map = {
            a["source_id"]: a.get("character_id") or ""
            for a in assignments
            if a.get("episode_id") == eid and a.get("source_type") == source_type
        }
        self.personnages_assign_table.setRowCount(0)
        if source_key == "segments":
            segments = db.get_segments_for_episode(eid, kind="sentence")
            for s in segments:
                sid = s.get("segment_id") or ""
                text = (s.get("text") or "")[:80]
                if len((s.get("text") or "")) > 80:
                    text += "…"
                row = self.personnages_assign_table.rowCount()
                self.personnages_assign_table.insertRow(row)
                self.personnages_assign_table.setItem(row, 0, QTableWidgetItem(sid))
                self.personnages_assign_table.setItem(row, 1, QTableWidgetItem(text))
                combo = QComboBox()
                combo.addItem("—", "")
                for cid in character_ids:
                    combo.addItem(cid, cid)
                idx = combo.findData(assign_map.get(sid, ""))
                if idx >= 0:
                    combo.setCurrentIndex(idx)
                self.personnages_assign_table.setCellWidget(row, 2, combo)
        elif source_key == "segments_utterance":
            segments = db.get_segments_for_episode(eid, kind="utterance")
            for s in segments:
                sid = s.get("segment_id") or ""
                text = (s.get("text") or "")[:80]
                if len((s.get("text") or "")) > 80:
                    text += "…"
                row = self.personnages_assign_table.rowCount()
                self.personnages_assign_table.insertRow(row)
                self.personnages_assign_table.setItem(row, 0, QTableWidgetItem(sid))
                self.personnages_assign_table.setItem(row, 1, QTableWidgetItem(text))
                combo = QComboBox()
                combo.addItem("—", "")
                for cid in character_ids:
                    combo.addItem(cid, cid)
                idx = combo.findData(assign_map.get(sid, ""))
                if idx >= 0:
                    combo.setCurrentIndex(idx)
                self.personnages_assign_table.setCellWidget(row, 2, combo)
        else:
            lang = source_key.replace("cues_", "")
            cues = db.get_cues_for_episode_lang(eid, lang)
            for c in cues:
                cid = c.get("cue_id") or ""
                text = (c.get("text_clean") or c.get("text_raw") or "")[:80]
                if len((c.get("text_clean") or c.get("text_raw") or "")) > 80:
                    text += "…"
                row = self.personnages_assign_table.rowCount()
                self.personnages_assign_table.insertRow(row)
                self.personnages_assign_table.setItem(row, 0, QTableWidgetItem(cid))
                self.personnages_assign_table.setItem(row, 1, QTableWidgetItem(text))
                combo = QComboBox()
                combo.addItem("—", "")
                for char_id in character_ids:
                    combo.addItem(char_id, char_id)
                idx = combo.findData(assign_map.get(cid, ""))
                if idx >= 0:
                    combo.setCurrentIndex(idx)
                self.personnages_assign_table.setCellWidget(row, 2, combo)
        self._on_assign_source_changed()

    @require_project
    def _suggest_by_alias(self) -> None:
        """§8 — Remplit la colonne Personnage lorsque le début du texte correspond à un alias."""
        store = self._get_store()
        if not store:
            return
        characters = store.load_character_names()
        # (character_id, aliases) avec aliases triés par longueur décroissante (match le plus long d'abord)
        char_aliases: list[tuple[str, list[str]]] = []
        for ch in characters:
            cid = (ch.get("id") or ch.get("canonical") or "").strip()
            if not cid:
                continue
            aliases = ch.get("aliases") or []
            if not aliases:
                continue
            char_aliases.append((cid, sorted(aliases, key=len, reverse=True)))
        if not char_aliases:
            QMessageBox.information(
                self,
                "Suggérer par alias",
                "Aucun personnage avec alias. Ajoutez des alias dans la colonne « Alias » (ex. TED, Marshall:) et enregistrez.",
            )
            return
        filled = 0
        for row in range(self.personnages_assign_table.rowCount()):
            text_item = self.personnages_assign_table.item(row, 1)
            text = (text_item.text() or "").strip() if text_item else ""
            if not text:
                continue
            text_lower = text.lower()
            combo = self.personnages_assign_table.cellWidget(row, 2)
            if not isinstance(combo, QComboBox):
                continue
            for cid, aliases in char_aliases:
                for alias in aliases:
                    alias_lower = alias.lower()
                    if (
                        text_lower.startswith(alias_lower)
                        or text_lower.startswith(alias_lower + ":")
                        or text_lower.startswith(alias_lower + " ")
                    ):
                        idx = combo.findData(cid)
                        if idx >= 0:
                            combo.setCurrentIndex(idx)
                            filled += 1
                        break
        self._show_status(f"Suggestion par alias : {filled} ligne(s) renseignée(s).", 4000)

    @require_project
    def _save_assignments(self) -> None:
        eid = self.personnages_episode_combo.currentData()
        source_key = self.personnages_source_combo.currentData() or "segments"
        store = self._get_store()
        if not eid:
            QMessageBox.warning(self, "Personnages", "Sélectionnez un épisode.")
            return
        source_type = "segment" if source_key in ("segments", "segments_utterance") else "cue"
        new_assignments = []
        for row in range(self.personnages_assign_table.rowCount()):
            id_item = self.personnages_assign_table.item(row, 0)
            source_id = (id_item.text() or "").strip() if id_item else ""
            combo = self.personnages_assign_table.cellWidget(row, 2)
            if not isinstance(combo, QComboBox):
                continue
            character_id = (combo.currentData() or combo.currentText() or "").strip()
            if source_id and character_id:
                new_assignments.append({
                    "episode_id": eid,
                    "source_type": source_type,
                    "source_id": source_id,
                    "character_id": character_id,
                })
        all_assignments = store.load_character_assignments()

        def _assignment_belongs_to_current_source(a: dict) -> bool:
            if a.get("episode_id") != eid:
                return False
            if source_key == "segments":
                return a.get("source_type") == "segment" and ":sentence:" in (a.get("source_id") or "")
            if source_key == "segments_utterance":
                return a.get("source_type") == "segment" and ":utterance:" in (a.get("source_id") or "")
            if source_key and source_key.startswith("cues_"):
                lang = source_key.replace("cues_", "", 1).strip().lower()
                prefix = f"{eid}:{lang}:"
                return a.get("source_type") == "cue" and (a.get("source_id") or "").startswith(prefix)
            return False

        all_assignments = [a for a in all_assignments if not _assignment_belongs_to_current_source(a)]
        all_assignments.extend(new_assignments)
        store.save_character_assignments(all_assignments)
        self._show_status(f"Assignations enregistrées : {len(new_assignments)}.", 3000)

    @require_project_and_db
    def _propagate(self) -> None:
        store = self._get_store()
        db = self._get_db()
        eid = self.personnages_episode_combo.currentData()
        if not eid:
            QMessageBox.warning(self, "Personnages", "Sélectionnez un épisode (section Assignation).")
            return
        run_id = self.personnages_run_combo.currentData()
        if not run_id:
            QMessageBox.warning(
                self,
                "Propagation",
                "Aucun run d'alignement sélectionné pour cet épisode. Choisissez un run dans la liste « Run d'alignement », ou lancez l'alignement dans l'onglet Alignement.",
            )
            return
        run = db.get_align_run(run_id)
        if not run:
            QMessageBox.warning(
                self,
                "Propagation",
                "Run d'alignement introuvable. Rafraîchissez la liste des runs puis sélectionnez un run valide.",
            )
            return
        assignments = store.load_character_assignments()
        episode_assignments = [a for a in assignments if a.get("episode_id") == eid]
        if not episode_assignments:
            QMessageBox.information(
                self, "Propagation", "Aucune assignation pour cet épisode. Enregistrez des assignations (section 2) puis réessayez."
            )
            return
        run_segment_kind, _ = parse_run_segment_kind(
            run.get("params_json") if run else None,
            run_id=run_id,
            logger_obj=logger,
        )
        expected_segment_marker = ":utterance:" if run_segment_kind == "utterance" else ":sentence:"
        expected_segment_label = "tours" if run_segment_kind == "utterance" else "phrases"
        has_expected_segment_assignments = any(
            a.get("source_type") == "segment" and expected_segment_marker in (a.get("source_id") or "")
            for a in episode_assignments
        )
        has_cue_assignments = any(a.get("source_type") == "cue" for a in episode_assignments)
        if not (has_expected_segment_assignments or has_cue_assignments):
            if QMessageBox.question(
                self,
                "Propagation",
                f"Aucune assignation sur les {expected_segment_label} ni sur les cues. "
                "La propagation ne mettra à jour que les segments (speaker_explicit) ; "
                "les fichiers SRT ne seront pas modifiés.\n\nContinuer quand même ?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            ) != QMessageBox.StandardButton.Yes:
                return
        links = db.query_alignment_for_episode(eid, run_id=run_id)
        pivot_lang = (run.get("pivot_lang") or "en").strip().lower() if run else "en"
        target_langs = {(lnk.get("lang") or "").strip().lower() for lnk in links if lnk.get("role") == "target" and (lnk.get("lang") or "").strip()}
        langs_available = sorted({pivot_lang} | target_langs)
        languages_to_rewrite = self._ask_languages_to_rewrite(langs_available)
        if languages_to_rewrite is None:
            return
        try:
            nb_seg, nb_cue = store.propagate_character_names(db, eid, run_id, languages_to_rewrite=languages_to_rewrite)
            self._show_status(
                f"Propagation : {nb_seg} segment(s), {nb_cue} cue(s) mis à jour ; fichiers SRT réécrits.",
                6000,
            )
            QMessageBox.information(
                self,
                "Propagation terminée",
                f"{nb_seg} segment(s) et {nb_cue} cue(s) mis à jour.\n\n"
                "Les noms de personnages apparaissent maintenant dans :\n"
                "• l’export SRT (Inspecteur, piste sous-titres)\n"
                "• le concordancier parallèle (onglet Alignement, export).",
            )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Propagation",
                f"Erreur lors de la propagation : {e!s}",
            )
