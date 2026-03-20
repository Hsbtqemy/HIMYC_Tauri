"""Onglet Sous-titres : pistes par épisode, import SRT/VTT, édition contenu."""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from howimetyourcorpus.core.pipeline.tasks import DownloadOpenSubtitlesStep, ImportSubtitlesStep
from howimetyourcorpus.core.normalize.profiles import get_all_profile_ids
from howimetyourcorpus.core.subtitles.parsers import cues_to_srt
from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE, SUPPORTED_LANGUAGES
from howimetyourcorpus.app.dialogs import OpenSubtitlesDownloadDialog, SubtitleBatchImportDialog
from howimetyourcorpus.app.ui_utils import require_project, require_project_and_db, confirm_action
from howimetyourcorpus.app.undo_commands import DeleteSubtitleTrackCommand

logger = logging.getLogger(__name__)


def _normalize_episode_id(s: str) -> str | None:
    """Normalise S01E01 ou 1x01 -> S01E01 (2 chiffres)."""
    if not s:
        return None
    m = re.match(r"(?i)S(\d+)E(\d+)$", s.strip())
    if m:
        return f"S{int(m.group(1)):02d}E{int(m.group(2)):02d}"
    m = re.match(r"(?i)(\d+)x(\d+)$", s.strip())
    if m:
        return f"S{int(m.group(1)):02d}E{int(m.group(2)):02d}"
    return None


def _parse_subtitle_filename(path: Path) -> tuple[str | None, str | None]:
    """Extrait (episode_id, lang) du nom de fichier.
    Ex. S01E01_en.srt -> (S01E01, en) ; Show - 1x01 - Title.en.srt -> (S01E01, en).
    """
    name = path.name
    # S01E01 ou s01e01 + _/-/. + 2 lettres + .srt/.vtt
    m = re.match(r"(?i)(S\d+E\d+)[_\-\.]?(\w{2})\.(srt|vtt)$", name)
    if m:
        return (m.group(1).upper(), m.group(2).lower())
    # 1x01 ou 101 style + optionnel _lang + .srt/.vtt
    m = re.match(r"(?i).*?(\d+)x(\d+).*?[_\-\.]?(\w{2})?\.(srt|vtt)$", name)
    if m:
        ep = f"S{int(m.group(1)):02d}E{int(m.group(2)):02d}"
        lang = m.group(3).lower() if m.group(3) else None
        return (ep, lang)
    return (None, None)


class SubtitleTabWidget(QWidget):
    """Widget de l'onglet Sous-titres : épisode, pistes, import fichier/masse, édition contenu."""

    def __init__(
        self,
        get_store: Callable[[], object],
        get_db: Callable[[], object],
        run_job: Callable[[list], None],
        refresh_episodes: Callable[[], None],
        show_status: Callable[[str, int], None],
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._get_store = get_store
        self._get_db = get_db
        self._run_job = run_job
        self._refresh_episodes = refresh_episodes
        self._show_status = show_status

        layout = QVBoxLayout(self)
        row = QHBoxLayout()
        self._subs_episode_label = QLabel("Épisode:")
        row.addWidget(self._subs_episode_label)
        self.subs_episode_combo = QComboBox()
        self.subs_episode_combo.currentIndexChanged.connect(self._on_episode_changed)
        row.addWidget(self.subs_episode_combo)
        row.addWidget(QLabel("Langue:"))
        self.subs_lang_combo = QComboBox()
        self.subs_lang_combo.addItems(list(SUPPORTED_LANGUAGES))
        self.subs_lang_combo.setToolTip(
            "Le format SRT ne contient pas de langue. Choisissez ici la langue de ce fichier (EN, FR, etc.)."
        )
        row.addWidget(self.subs_lang_combo)
        self.subs_import_btn = QPushButton("Importer SRT/VTT...")
        self.subs_import_btn.clicked.connect(self._import_file)
        row.addWidget(self.subs_import_btn)
        self.subs_apply_profile_on_import_cb = QCheckBox("Appliquer le profil à l'import")
        self.subs_apply_profile_on_import_cb.setToolTip(
            "§11 — Si coché, le profil sélectionné ci-dessous (Profil piste) est appliqué aux sous-titres juste après l'import (text_clean en base)."
        )
        self.subs_apply_profile_on_import_cb.setChecked(False)
        row.addWidget(self.subs_apply_profile_on_import_cb)
        self.subs_import_batch_btn = QPushButton("Importer SRT en masse...")
        self.subs_import_batch_btn.setToolTip(
            "Choisir un dossier (racine et sous-dossiers). "
            "Épisode et langue sont devinés : S01E01_fr.srt, 1x01.en.srt, ou S01E01/fr.srt. "
            "Vérifiez ou corrigez dans le tableau avant d'importer."
        )
        self.subs_import_batch_btn.clicked.connect(self._import_batch)
        row.addWidget(self.subs_import_batch_btn)
        self.subs_opensubtitles_btn = QPushButton("Télécharger depuis OpenSubtitles…")
        self.subs_opensubtitles_btn.setToolTip(
            "Télécharger des sous-titres depuis OpenSubtitles (clé API requise)."
        )
        self.subs_opensubtitles_btn.clicked.connect(self._import_opensubtitles)
        row.addWidget(self.subs_opensubtitles_btn)
        layout.addLayout(row)
        help_subs = QLabel(
            "Les fichiers SRT/VTT ne déclarent pas leur langue. À l'import : choisir la langue ci-dessus (ou nommer en masse S01E01_fr.srt). "
            "Ces pistes (EN, FR, …) servent de pivot et cible dans l'onglet Alignement après segmentation (Inspecteur)."
        )
        help_subs.setStyleSheet("color: gray; font-size: 0.9em;")
        help_subs.setWordWrap(True)
        layout.addWidget(help_subs)
        row2 = QHBoxLayout()
        row2.addWidget(QLabel("Pistes pour l'épisode:"))
        self.subs_export_final_btn = QPushButton("Exporter SRT final…")
        self.subs_export_final_btn.setToolTip(
            "§15.2 — Exporte la piste sélectionnée en SRT (timecodes + text_clean, avec noms personnages si propagation faite)."
        )
        self.subs_export_final_btn.clicked.connect(self._export_srt_final)
        self.subs_export_final_btn.setEnabled(False)
        row2.addWidget(self.subs_export_final_btn)
        self.subs_delete_track_btn = QPushButton("Supprimer la piste sélectionnée")
        self.subs_delete_track_btn.setToolTip("Supprime la piste (ex. mauvaise langue) en base et le fichier sur disque.")
        self.subs_delete_track_btn.clicked.connect(self._delete_selected_track)
        self.subs_delete_track_btn.setEnabled(False)
        row2.addStretch()
        row2.addWidget(self.subs_delete_track_btn)
        layout.addLayout(row2)
        row_norm = QHBoxLayout()
        row_norm.addWidget(QLabel("§11 Profil (piste):"))
        self.subs_norm_profile_combo = QComboBox()
        self.subs_norm_profile_combo.setToolTip(
            "Profil de normalisation pour « Normaliser la piste » (fusion césures, espaces). Même moteur que les transcripts."
        )
        row_norm.addWidget(self.subs_norm_profile_combo)
        self.subs_norm_btn = QPushButton("Normaliser la piste")
        self.subs_norm_btn.setToolTip(
            "Applique le profil aux sous-titres de la piste sélectionnée : text_clean mis à jour en base (text_raw inchangé)."
        )
        self.subs_norm_btn.clicked.connect(self._normalize_track)
        self.subs_norm_btn.setEnabled(False)
        row_norm.addWidget(self.subs_norm_btn)
        self.subs_rewrite_srt_check = QCheckBox("Réécrire le fichier SRT après normalisation")
        self.subs_rewrite_srt_check.setToolTip(
            "Si coché, le fichier SRT sur disque est réécrit à partir de text_clean (écrase l'original)."
        )
        self.subs_rewrite_srt_check.setChecked(False)
        row_norm.addWidget(self.subs_rewrite_srt_check)
        row_norm.addStretch()
        layout.addLayout(row_norm)
        self.subs_tracks_list = QListWidget()
        self.subs_tracks_list.currentItemChanged.connect(self._on_track_selected)
        layout.addWidget(self.subs_tracks_list)
        layout.addWidget(QLabel("Contenu SRT/VTT (modifiable) :"))
        self.subs_content_edit = QPlainTextEdit()
        self.subs_content_edit.setPlaceholderText(
            "Sélectionnez une piste ci-dessus pour afficher et modifier le contenu…"
        )
        self.subs_content_edit.setMinimumHeight(120)
        layout.addWidget(self.subs_content_edit)
        self.subs_save_btn = QPushButton("Sauvegarder et ré-importer")
        self.subs_save_btn.clicked.connect(self._save_content)
        self.subs_save_btn.setEnabled(False)
        layout.addWidget(self.subs_save_btn)
        self._editing_lang: str | None = None
        self._editing_fmt: str | None = None

    def set_languages(self, langs: list[str]) -> None:
        """Met à jour la liste des langues (appelé quand les langues du projet changent)."""
        self.subs_lang_combo.clear()
        self.subs_lang_combo.addItems(langs)

    def set_episode_selector_visible(self, visible: bool) -> None:
        """§15.4 — Masque ou affiche le sélecteur d'épisode (quand intégré dans l'onglet fusionné)."""
        self._subs_episode_label.setVisible(visible)
        self.subs_episode_combo.setVisible(visible)

    def set_episode_and_load(self, episode_id: str) -> None:
        """§15.4 — Sélectionne l'épisode donné et charge ses pistes (synchro avec Inspecteur)."""
        for i in range(self.subs_episode_combo.count()):
            if self.subs_episode_combo.itemData(i) == episode_id:
                self.subs_episode_combo.setCurrentIndex(i)
                break

    def refresh(self) -> None:
        """Recharge la liste des épisodes et les pistes (préserve l'épisode courant si possible)."""
        current_episode_id = self.subs_episode_combo.currentData()
        self.subs_episode_combo.clear()
        store = self._get_store()
        if not store:
            return
        index = store.load_series_index()
        if index and index.episodes:
            for e in index.episodes:
                self.subs_episode_combo.addItem(f"{e.episode_id} - {e.title}", e.episode_id)
            if current_episode_id:
                for i in range(self.subs_episode_combo.count()):
                    if self.subs_episode_combo.itemData(i) == current_episode_id:
                        self.subs_episode_combo.setCurrentIndex(i)
                        break
        self._on_episode_changed()

    def _on_episode_changed(self) -> None:
        self.subs_tracks_list.clear()
        self.subs_content_edit.clear()
        self.subs_save_btn.setEnabled(False)
        self.subs_delete_track_btn.setEnabled(False)
        self.subs_export_final_btn.setEnabled(False)
        self.subs_norm_btn.setEnabled(False)
        self._editing_lang = None
        self._editing_fmt = None
        store = self._get_store()
        custom = store.load_custom_profiles() if store else {}
        profile_ids = get_all_profile_ids(custom)
        current = self.subs_norm_profile_combo.currentText()
        self.subs_norm_profile_combo.clear()
        self.subs_norm_profile_combo.addItems(profile_ids)
        if current in profile_ids:
            self.subs_norm_profile_combo.setCurrentText(current)
        eid = self.subs_episode_combo.currentData()
        db = self._get_db()
        if not eid or not db:
            return
        tracks = db.get_tracks_for_episode(eid)
        for t in tracks:
            lang = t.get("lang", "")
            fmt = t.get("format", "")
            nb = t.get("nb_cues", 0)
            item = QListWidgetItem(f"{lang} | {fmt} | {nb} cues")
            item.setData(Qt.ItemDataRole.UserRole, {"lang": lang, "format": fmt})
            self.subs_tracks_list.addItem(item)

    def _on_track_selected(self, current: QListWidgetItem | None) -> None:
        self.subs_content_edit.clear()
        self.subs_save_btn.setEnabled(False)
        self.subs_delete_track_btn.setEnabled(bool(current))
        self.subs_export_final_btn.setEnabled(bool(current))
        self.subs_norm_btn.setEnabled(bool(current))
        self._editing_lang = None
        self._editing_fmt = None
        if not current:
            return
        store = self._get_store()
        if not store:
            return
        eid = self.subs_episode_combo.currentData()
        if not eid:
            return
        data = current.data(Qt.ItemDataRole.UserRole)
        if not data or not isinstance(data, dict):
            return
        lang = data.get("lang", "")
        content_fmt = store.load_episode_subtitle_content(eid, lang)
        if not content_fmt:
            return
        content, detected_fmt = content_fmt
        self._editing_lang = lang
        self._editing_fmt = detected_fmt
        self.subs_content_edit.setPlainText(content)
        self.subs_save_btn.setEnabled(True)

    @require_project_and_db
    def _delete_selected_track(self) -> None:
        current = self.subs_tracks_list.currentItem()
        store = self._get_store()
        db = self._get_db()
        if not current:
            return
        eid = self.subs_episode_combo.currentData()
        data = current.data(Qt.ItemDataRole.UserRole)
        if not eid or not data or not isinstance(data, dict):
            return
        lang = data.get("lang", "")
        if not lang:
            return
        
        if not confirm_action(
            self,
            "Supprimer la piste",
            f"Supprimer la piste {lang} pour cet épisode ?\n\n"
            f"⚠️ Cette action est irréversible (avec Undo/Redo) :\n"
            f"• Suppression en base de données\n"
            f"• Suppression du fichier SRT sur disque\n"
            f"• Suppression des alignements associés\n\n"
            f"Note : Undo/Redo peut restaurer cette suppression (données sauvegardées)."
        ):
            return
        
        # Basse Priorité #3 : Utiliser commande Undo/Redo
        undo_stack = getattr(self, "undo_stack", None)
        if undo_stack:
            cmd = DeleteSubtitleTrackCommand(db, store, eid, lang)
            undo_stack.push(cmd)
        else:
            db.delete_subtitle_track(eid, lang)
            db.delete_align_runs_for_episode(eid)
            store.remove_episode_subtitle(eid, lang)
        self._on_episode_changed()
        self._refresh_episodes()
        self._show_status(f"Piste {lang} supprimée.", 3000)

    @require_project_and_db
    def _normalize_track(self) -> None:
        """§11 — Applique le profil de normalisation aux cues de la piste sélectionnée."""
        current = self.subs_tracks_list.currentItem()
        store = self._get_store()
        db = self._get_db()
        if not current:
            return
        eid = self.subs_episode_combo.currentData()
        data = current.data(Qt.ItemDataRole.UserRole)
        if not eid or not data or not isinstance(data, dict):
            return
        lang = data.get("lang", "")
        if not lang:
            return
        profile_id = self.subs_norm_profile_combo.currentText() or DEFAULT_NORMALIZE_PROFILE
        rewrite_srt = self.subs_rewrite_srt_check.isChecked()
        nb = store.normalize_subtitle_track(db, eid, lang, profile_id, rewrite_srt=rewrite_srt)
        self._on_episode_changed()
        self._refresh_episodes()
        if nb > 0:
            msg = f"Piste {lang} : {nb} cue(s) normalisée(s)."
            if rewrite_srt:
                msg += " Fichier SRT réécrit."
            self._show_status(msg, 4000)
        else:
            self._show_status("Aucune cue à normaliser ou profil introuvable.", 3000)

    @require_project_and_db
    def _export_srt_final(self) -> None:
        """§15.2 — Exporte la piste sélectionnée en SRT final (timecodes + text_clean)."""
        current = self.subs_tracks_list.currentItem()
        db = self._get_db()
        assert db is not None  # garanti par @require_project_and_db
        if not current:
            return
        eid = self.subs_episode_combo.currentData()
        data = current.data(Qt.ItemDataRole.UserRole)
        if not eid or not data or not isinstance(data, dict):
            return
        lang = data.get("lang", "")
        if not lang:
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Exporter SRT final", "", "SRT (*.srt);;Tous (*.*)"
        )
        if not path:
            return
        path = Path(path)
        if path.suffix.lower() != ".srt":
            path = path.with_suffix(".srt")
        try:
            cues = db.get_cues_for_episode_lang(eid, lang)
            if not cues:
                QMessageBox.warning(self, "Export SRT", "Aucune cue pour cette piste.")
                return
            srt_content = cues_to_srt(cues)
            path.write_text(srt_content, encoding="utf-8")
            self._show_status(f"SRT final exporté : {path.name}", 4000)
        except Exception as e:
            logger.exception("Export SRT final")
            QMessageBox.critical(
                self,
                "Export SRT",
                f"L'export SRT final a échoué : {e}\n\n"
                "Vérifiez les droits d'écriture et que le fichier n'est pas ouvert ailleurs.",
            )

    @require_project_and_db
    def _import_file(self) -> None:
        eid = self.subs_episode_combo.currentData()
        if not eid:
            QMessageBox.warning(self, "Sous-titres", "Sélectionnez un épisode.")
            return
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Importer sous-titres SRT/VTT",
            "",
            "Sous-titres (*.srt *.vtt);;Tous (*.*)",
        )
        if not path:
            return
        lang = self.subs_lang_combo.currentText() or "en"
        profile_id = (self.subs_norm_profile_combo.currentText() or "").strip() if self.subs_apply_profile_on_import_cb.isChecked() else None
        self._run_job([ImportSubtitlesStep(eid, lang, path, profile_id=profile_id)])
        self.refresh()

    @require_project_and_db
    def _import_batch(self) -> None:
        store = self._get_store()
        index = store.load_series_index()
        if not index or not index.episodes:
            QMessageBox.warning(self, "Sous-titres", "Découvrez d'abord les épisodes (onglet Corpus).")
            return
        folder = QFileDialog.getExistingDirectory(self, "Choisir un dossier contenant des SRT/VTT")
        if not folder:
            return
        folder_path = Path(folder)
        rows: list[tuple[str, str | None, str | None]] = []
        seen: set[str] = set()
        for p in sorted(folder_path.rglob("*.srt")) + sorted(folder_path.rglob("*.vtt")):
            if not p.is_file():
                continue
            key = str(p.resolve())
            if key in seen:
                continue
            seen.add(key)
            ep, lang = _parse_subtitle_filename(p)
            if (ep, lang) == (None, None) and p.parent != folder_path:
                parent_ep = _normalize_episode_id(p.parent.name)
                if parent_ep:
                    ep = parent_ep
                    if not lang:
                        mm = re.search(r"(?i)(?:^|[_\-\.])(\w{2})\.(srt|vtt)$", p.name)
                        if mm:
                            lang = mm.group(1).lower()
            rows.append((key, ep, lang))
        if not rows:
            QMessageBox.information(
                self,
                "Import",
                "Aucun fichier .srt ou .vtt trouvé dans ce dossier (racine et sous-dossiers).",
            )
            return
        episode_ids = [e.episode_id for e in index.episodes]
        langs = store.load_project_languages() if store else None
        profile_ids = get_all_profile_ids(store.load_custom_profiles()) if store else []
        dlg = SubtitleBatchImportDialog(self, episode_ids, rows, languages=langs, profile_ids=profile_ids)
        if dlg.exec() != QDialog.DialogCode.Accepted or not dlg.result:
            return
        profile_id = dlg.profile_id_for_import
        steps = [ImportSubtitlesStep(ep, lang, path, profile_id=profile_id) for path, ep, lang in dlg.result]
        self._run_job(steps)
        self.refresh()
        self._refresh_episodes()
        self._show_status(f"Import en masse lancé : {len(steps)} fichier(s).", 5000)

    @require_project
    def _import_opensubtitles(self) -> None:
        store = self._get_store()
        assert store is not None  # garanti par @require_project
        index = store.load_series_index()
        if not index or not index.episodes:
            QMessageBox.warning(self, "Sous-titres", "Découvrez d'abord les épisodes (onglet Corpus).")
            return
        config_extra = store.load_config_extra()
        api_key = config_extra.get("opensubtitles_api_key") or ""
        series_imdb_id = config_extra.get("series_imdb_id") or ""
        episode_refs = [(e.episode_id, e.season, e.episode) for e in index.episodes]
        langs = store.load_project_languages()
        dlg = OpenSubtitlesDownloadDialog(
            self,
            episode_refs=episode_refs,
            api_key=api_key if isinstance(api_key, str) else "",
            series_imdb_id=series_imdb_id if isinstance(series_imdb_id, str) else "",
            languages=langs,
        )
        if dlg.exec() != QDialog.DialogCode.Accepted or not dlg.result:
            return
        api_key_val, imdb_id, lang, selected = dlg.result
        store.save_config_extra({
            "opensubtitles_api_key": api_key_val,
            "series_imdb_id": imdb_id,
        })
        steps = [
            DownloadOpenSubtitlesStep(ep_id, season, episode, lang, api_key_val, imdb_id)
            for ep_id, season, episode in selected
        ]
        self._run_job(steps)
        self.refresh()
        self._refresh_episodes()
        self._show_status(f"Téléchargement OpenSubtitles lancé : {len(steps)} épisode(s).", 5000)

    @require_project_and_db
    def _save_content(self) -> None:
        eid = self.subs_episode_combo.currentData()
        store = self._get_store()
        assert store is not None  # garanti par @require_project_and_db
        if not eid:
            return
        if not self._editing_lang or not self._editing_fmt:
            QMessageBox.warning(self, "Sous-titres", "Sélectionnez une piste à modifier.")
            return
        content = self.subs_content_edit.toPlainText()
        try:
            path = store.save_episode_subtitle_content(
                eid, self._editing_lang, content, self._editing_fmt
            )
            self._run_job([ImportSubtitlesStep(eid, self._editing_lang, str(path), profile_id=None)])
            self.refresh()
        except Exception as e:
            logger.exception("Sauvegarde SRT/VTT")
            QMessageBox.critical(
                self,
                "Sous-titres",
                f"La sauvegarde des sous-titres a échoué : {e}\n\n"
                "Vérifiez les droits d'écriture sur le projet et que le fichier n'est pas ouvert ailleurs.",
            )
