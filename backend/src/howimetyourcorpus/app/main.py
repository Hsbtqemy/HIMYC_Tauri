"""Point d'entrée de l'application desktop HowIMetYourCorpus."""

from __future__ import annotations

import sys
import logging

from PySide6.QtWidgets import QApplication

from howimetyourcorpus.core.utils.logging import setup_logging
from howimetyourcorpus.app.ui_mainwindow import MainWindow


def main() -> int:
    setup_logging(level=logging.INFO)
    logging.getLogger("howimetyourcorpus").info("Starting HowIMetYourCorpus")
    app = QApplication(sys.argv)
    app.setApplicationName("HowIMetYourCorpus")
    win = MainWindow()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
