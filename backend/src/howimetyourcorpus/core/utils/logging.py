"""Configuration du logging pour l'application."""

import logging
import sys
from pathlib import Path
from typing import Optional


def setup_logging(
    level: int = logging.INFO,
    log_file: Optional[Path] = None,
    format_string: Optional[str] = None,
) -> logging.Logger:
    """
    Configure le logging racine et retourne le logger de l'app.

    Args:
        level: Niveau de log (DEBUG, INFO, WARNING, ERROR).
        log_file: Fichier où écrire les logs (optionnel).
        format_string: Format des messages (optionnel).

    Returns:
        Logger 'howimetyourcorpus'.
    """
    if format_string is None:
        format_string = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"

    formatter = logging.Formatter(format_string)
    root = logging.getLogger()
    root.setLevel(level)

    # Éviter double handlers si rappel
    for h in list(root.handlers):
        root.removeHandler(h)

    # Console
    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(formatter)
    root.addHandler(console)

    if log_file:
        log_file = Path(log_file)
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

    logger = logging.getLogger("howimetyourcorpus")
    logger.setLevel(level)
    return logger


def get_log_file_for_project(project_root: Path) -> Path:
    """Retourne le chemin du fichier log pour un projet (runs/app.log)."""
    return project_root / "runs" / "app.log"
