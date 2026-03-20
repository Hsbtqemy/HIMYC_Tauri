"""Contrôleur de gestion du cycle projet pour la fenêtre principale."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from howimetyourcorpus.core.constants import DEFAULT_NORMALIZE_PROFILE, SUPPORTED_LANGUAGES
from howimetyourcorpus.core.models import ProjectConfig, SeriesIndex
from howimetyourcorpus.core.normalize.profiles import get_all_profile_ids
from howimetyourcorpus.core.storage.db import CorpusDB
from howimetyourcorpus.core.storage.project_store import ProjectStore, load_project_config
from howimetyourcorpus.core.utils.logging import get_log_file_for_project


class MainWindowProjectController:
    """Regroupe la logique projet/config/logging de `MainWindow`."""

    def __init__(self, window: Any, logger_obj: logging.Logger) -> None:
        self._window = window
        self._logger = logger_obj

    def refresh_language_combos(self) -> None:
        """Met à jour les listes de langues (Sous-titres, Concordance, Préparer, Alignement, Personnages)."""
        win = self._window
        langs = win._store.load_project_languages() if win._store else list(SUPPORTED_LANGUAGES)  # noqa: SLF001
        if hasattr(win, "inspector_tab") and win.inspector_tab and hasattr(win.inspector_tab, "has_subtitle_panel") and win.inspector_tab.has_subtitle_panel():
            win.inspector_tab.set_subtitle_languages(langs)
        if hasattr(win, "concordance_tab") and hasattr(win.concordance_tab, "set_languages"):
            win.concordance_tab.set_languages(langs)
            win.concordance_tab.refresh_speakers()
        if hasattr(win, "preparer_tab") and win.preparer_tab:
            current_episode = win.preparer_tab.current_episode_id()  # noqa: SLF001
            win.preparer_tab._refresh_source_combo_items()  # noqa: SLF001
            win.preparer_tab._refresh_source_availability(current_episode)  # noqa: SLF001
        if hasattr(win, "alignment_tab") and win.alignment_tab and hasattr(win.alignment_tab, "_refresh_language_combos"):
            win.alignment_tab._refresh_language_combos()  # noqa: SLF001
        if hasattr(win, "personnages_tab") and win.personnages_tab:
            win.personnages_tab.refresh()
        if hasattr(win, "expert_tab") and win.expert_tab:
            win.expert_tab.refresh()

    def validate_and_init_project_from_tab(self, *, message_box: Any, timer: Any) -> None:
        """Valide le formulaire Projet puis initialise/charge le projet."""
        win = self._window
        data = win.project_tab.get_form_data()
        root = data["root"]
        if not root:
            message_box.warning(win, "Projet", "Indiquez un dossier projet.")
            return
        root_path = Path(root)
        config_toml = root_path / "config.toml"
        try:
            if config_toml.exists():
                win._load_existing_project(root_path)  # noqa: SLF001 - wrapper compatibilité
                return
            config = ProjectConfig(
                project_name=root_path.name,
                root_dir=root_path,
                source_id=data["source_id"],
                series_url=data["series_url"],
                rate_limit_s=float(data["rate_limit"]),
                user_agent="HowIMetYourCorpus/0.1 (research)",
                normalize_profile=data["normalize_profile"],
            )
            ProjectStore.init_project(config)
            win._config = config  # noqa: SLF001
            win._store = ProjectStore(config.root_dir)  # noqa: SLF001
            win._db = CorpusDB(win._store.get_db_path())  # noqa: SLF001
            win._db.init()  # noqa: SLF001
            win._setup_logging_for_project()  # noqa: SLF001 - wrapper compatibilité
            if data["srt_only"]:
                win._store.save_series_index(SeriesIndex(series_title="", series_url="", episodes=[]))  # noqa: SLF001
            win.project_tab.set_project_state(root_path, config)
            win.project_tab.refresh_languages_list()
            win._refresh_profile_combos()  # noqa: SLF001
            win._refresh_language_combos()  # noqa: SLF001
            self._refresh_tabs_after_project_open(deferred=False, timer=timer)
            message_box.information(win, "Projet", "Projet initialisé.")
        except Exception as exc:
            self._logger.exception("Init project failed")
            message_box.critical(win, "Erreur", str(exc))

    def load_existing_project(self, root_path: Path, *, message_box: Any, timer: Any) -> None:
        """Charge un projet existant (`config.toml` présent)."""
        win = self._window
        data = load_project_config(root_path / "config.toml")
        config = ProjectConfig(
            project_name=data.get("project_name", root_path.name),
            root_dir=root_path,
            source_id=data.get("source_id", "subslikescript"),
            series_url=data.get("series_url", ""),
            rate_limit_s=float(data.get("rate_limit_s", 2)),
            user_agent=data.get("user_agent", "HowIMetYourCorpus/0.1 (research)"),
            normalize_profile=data.get("normalize_profile", DEFAULT_NORMALIZE_PROFILE),
        )
        win._config = config  # noqa: SLF001
        win._store = ProjectStore(config.root_dir)  # noqa: SLF001
        win._db = CorpusDB(win._store.get_db_path())  # noqa: SLF001
        if not win._db.db_path.exists():  # noqa: SLF001
            win._db.init()  # noqa: SLF001
        else:
            win._db.ensure_migrated()  # noqa: SLF001
        win._setup_logging_for_project()  # noqa: SLF001 - wrapper compatibilité
        win.project_tab.set_project_state(root_path, config)
        win.project_tab.refresh_languages_list()
        win._refresh_profile_combos()  # noqa: SLF001
        win._refresh_language_combos()  # noqa: SLF001
        message_box.information(win, "Projet", "Projet ouvert.")
        self._refresh_tabs_after_project_open(deferred=True, timer=timer)

    def _refresh_tabs_after_project_open(self, *, deferred: bool, timer: Any) -> None:
        """Rafraîchit les onglets dépendants après ouverture/initialisation projet."""
        win = self._window
        has_combined_inspector = bool(
            hasattr(win, "inspector_tab")
            and win.inspector_tab
            and hasattr(win.inspector_tab, "has_subtitle_panel")
            and win.inspector_tab.has_subtitle_panel()
        )

        def _refresh() -> None:
            win._refresh_inspecteur_episodes()  # noqa: SLF001
            win._refresh_preparer()  # noqa: SLF001
            if not has_combined_inspector:
                win._refresh_subs_tracks()  # noqa: SLF001
            win._refresh_align_runs()  # noqa: SLF001
            win._refresh_personnages()  # noqa: SLF001
            win._refresh_expert()  # noqa: SLF001

        if deferred:
            # Ne pas remplir le Corpus ici : provoque segfault Qt/macOS.
            timer.singleShot(0, _refresh)
            return
        _refresh()

    def setup_logging_for_project(self, *, tab_logs_index: int) -> None:
        """Configure le fichier de log projet et met à jour l'onglet Logs."""
        win = self._window
        corpus_logger = logging.getLogger("howimetyourcorpus")
        if win._log_handler:  # noqa: SLF001
            corpus_logger.removeHandler(win._log_handler)  # noqa: SLF001
        if not win._config:  # noqa: SLF001
            return
        log_file = get_log_file_for_project(win._config.root_dir)  # noqa: SLF001
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        corpus_logger.addHandler(file_handler)
        win._log_handler = file_handler  # noqa: SLF001
        if hasattr(win, "tabs") and win.tabs.count() > tab_logs_index:
            log_widget = win.tabs.widget(tab_logs_index)
            if hasattr(log_widget, "set_log_path"):
                log_widget.set_log_path(str(log_file))

    def sync_config_from_project_tab(self, *, show_mismatch_status: bool = False) -> bool:
        """
        Synchronise config en mémoire + `config.toml` depuis le formulaire Projet.

        Retourne `True` si la synchro est appliquée, `False` sinon.
        """
        win = self._window
        if not win._config or not win._store or not (hasattr(win, "project_tab") and win.project_tab):  # noqa: SLF001
            return False
        data = win.project_tab.get_form_data()
        root = data.get("root")
        if not root or Path(root).resolve() != win._config.root_dir.resolve():  # noqa: SLF001
            if show_mismatch_status:
                win.statusBar().showMessage("Ouvrez un projet puis modifiez le formulaire du projet ouvert.", 4000)
            return False
        win._store.save_config_main(  # noqa: SLF001
            series_url=data.get("series_url", ""),
            source_id=data.get("source_id"),
            rate_limit_s=float(data.get("rate_limit", 2)),
            normalize_profile=data.get("normalize_profile"),
        )
        win._config = ProjectConfig(  # noqa: SLF001
            project_name=win._config.project_name,
            root_dir=win._config.root_dir,
            source_id=data.get("source_id", win._config.source_id),
            series_url=data.get("series_url", win._config.series_url),
            rate_limit_s=float(data.get("rate_limit", win._config.rate_limit_s)),
            user_agent=win._config.user_agent,
            normalize_profile=data.get("normalize_profile", win._config.normalize_profile),
        )
        return True

    def refresh_profile_combos(self) -> None:
        """Met à jour les listes de profils (prédéfinis + personnalisés projet)."""
        win = self._window
        custom = win._store.load_custom_profiles() if win._store else {}  # noqa: SLF001
        profile_ids = get_all_profile_ids(custom)
        current = win._config.normalize_profile if win._config else None  # noqa: SLF001
        if hasattr(win, "corpus_tab") and win.corpus_tab:
            win.corpus_tab.refresh_profile_combo(profile_ids, current)
        if hasattr(win, "inspector_tab") and win.inspector_tab:
            win.inspector_tab.refresh_profile_combo(profile_ids, current)
