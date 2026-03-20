"""Onglet Logs : affichage des logs applicatifs + bouton ouvrir fichier log."""

from __future__ import annotations

import logging
from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)


# Limite de lignes pour l'affichage en direct (rolling buffer)
MAX_LOG_LINES = 1000


class TextEditHandler(logging.Handler):
    """Redirige les logs vers un QPlainTextEdit avec rolling buffer (limite 1000 lignes) + stockage pour filtrage (Moyenne Priorité #2)."""

    def __init__(
        self,
        widget: QPlainTextEdit,
        max_lines: int = MAX_LOG_LINES,
        log_widget: "LogsTabWidget | None" = None,
    ) -> None:
        super().__init__()
        self.widget = widget
        self.max_lines = max_lines
        self.line_count = 0
        self.log_widget = log_widget  # Moyenne Priorité #2 : référence au widget pour stockage

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            self.widget.appendPlainText(msg)
            self.line_count += 1
            
            # Moyenne Priorité #2 : Stocker dans le widget pour filtrage
            if self.log_widget:
                self.log_widget.add_log_entry(record.levelname, msg)
            
            # Rolling buffer : supprimer les premières lignes si > max_lines
            if self.line_count > self.max_lines:
                cursor = self.widget.textCursor()
                cursor.movePosition(cursor.MoveOperation.Start)
                cursor.movePosition(cursor.MoveOperation.Down, cursor.MoveMode.KeepAnchor, self.line_count - self.max_lines)
                cursor.removeSelectedText()
                self.line_count = self.max_lines
        except Exception:
            logging.getLogger(__name__).exception("TextEditHandler.emit")


class LogsTabWidget(QWidget):
    """Widget de l'onglet Logs : zone lecture seule + recherche Ctrl+F + bouton ouvrir fichier log + filtrage niveau (Moyenne Priorité #2)."""

    def __init__(
        self,
        on_open_log: Callable[[], None] | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        
        # Info rolling buffer
        info_label = QLabel(
            f"Affichage en direct (max {MAX_LOG_LINES} lignes). "
            "Pour voir l'historique complet : « Ouvrir fichier log »."
        )
        info_label.setStyleSheet("color: gray; font-size: 0.9em;")
        info_label.setWordWrap(True)
        layout.addWidget(info_label)
        
        # Moyenne Priorité #2 : Filtrage par niveau
        filter_row = QHBoxLayout()
        filter_row.addWidget(QLabel("Filtrer :"))
        self.level_filter_combo = QComboBox()
        self.level_filter_combo.addItems(["Tout", "Info", "Warning", "Error"])
        self.level_filter_combo.setToolTip("Filtrer l'affichage par niveau de log")
        self.level_filter_combo.currentTextChanged.connect(self._apply_filter)
        filter_row.addWidget(self.level_filter_combo)
        filter_row.addStretch()
        layout.addLayout(filter_row)
        
        self.logs_edit = QPlainTextEdit()
        self.logs_edit.setReadOnly(True)
        layout.addWidget(self.logs_edit)
        
        # Raccourci Ctrl+F pour rechercher dans les logs
        find_action = QAction("Rechercher", self)
        find_action.setShortcut(QKeySequence.StandardKey.Find)
        find_action.triggered.connect(self._show_find_dialog)
        self.logs_edit.addAction(find_action)
        
        row = QHBoxLayout()
        open_log_btn = QPushButton("Ouvrir fichier log")
        open_log_btn.clicked.connect(on_open_log or (lambda: None))
        row.addWidget(open_log_btn)
        
        # Moyenne Priorité #2 : Bouton Export logs
        export_btn = QPushButton("Exporter logs.txt")
        export_btn.setToolTip("Exporte les logs affichés vers un fichier texte")
        export_btn.clicked.connect(self._export_logs)
        row.addWidget(export_btn)
        
        clear_btn = QPushButton("Effacer l'affichage")
        clear_btn.setToolTip("Efface les logs affichés (le fichier log n'est pas modifié)")
        clear_btn.clicked.connect(self.logs_edit.clear)
        row.addWidget(clear_btn)
        self.log_path_label = QLabel("")
        self.log_path_label.setStyleSheet("color: gray; font-size: 0.85em;")
        self.log_path_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.log_path_label.setToolTip("Chemin du fichier log du projet")
        row.addWidget(self.log_path_label)
        row.addStretch()
        layout.addLayout(row)
        
        # Connect app logger to this widget
        self._handler = TextEditHandler(self.logs_edit, max_lines=MAX_LOG_LINES, log_widget=self)
        self._handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logging.getLogger("howimetyourcorpus").addHandler(self._handler)
        
        # Moyenne Priorité #2 : Stocker tous les logs (pour filtrage)
        self._all_logs: list[tuple[str, str]] = []  # (levelname, message)

    def set_log_path(self, path: str) -> None:
        """Met à jour le label avec le chemin du fichier log."""
        self.log_path_label.setText(f"Fichier : {path}")
    
    def add_log_entry(self, levelname: str, message: str) -> None:
        """Ajoute une entrée log au stockage interne (Moyenne Priorité #2)."""
        self._all_logs.append((levelname, message))
        if len(self._all_logs) > MAX_LOG_LINES:
            self._all_logs = self._all_logs[-MAX_LOG_LINES:]
    
    def _apply_filter(self) -> None:
        """Filtre l'affichage selon le niveau sélectionné (Moyenne Priorité #2)."""
        filter_level = self.level_filter_combo.currentText()
        self.logs_edit.clear()
        
        for levelname, message in self._all_logs:
            if filter_level == "Tout":
                self.logs_edit.appendPlainText(message)
            elif filter_level == "Info" and "INFO" in message:
                self.logs_edit.appendPlainText(message)
            elif filter_level == "Warning" and "WARNING" in message:
                self.logs_edit.appendPlainText(message)
            elif filter_level == "Error" and "ERROR" in message:
                self.logs_edit.appendPlainText(message)
    
    def _export_logs(self) -> None:
        """Exporte les logs affichés vers un fichier texte (Moyenne Priorité #2)."""
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Exporter les logs",
            "logs.txt",
            "Fichiers texte (*.txt);;Tous (*.*)"
        )
        if not path:
            return
        
        try:
            content = self.logs_edit.toPlainText()
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            QMessageBox.information(self, "Export", f"Logs exportés : {path}")
        except Exception as e:
            QMessageBox.critical(self, "Erreur", f"Erreur lors de l'export : {e}")

    def _show_find_dialog(self) -> None:
        """Affiche le dialogue de recherche natif (Ctrl+F)."""
        from PySide6.QtWidgets import QInputDialog
        text, ok = QInputDialog.getText(self, "Rechercher dans les logs", "Terme :")
        if ok and text:
            # Rechercher dans le texte (case-insensitive)
            cursor = self.logs_edit.textCursor()
            cursor.movePosition(cursor.MoveOperation.Start)
            self.logs_edit.setTextCursor(cursor)
            if not self.logs_edit.find(text):
                # Pas trouvé : message
                from PySide6.QtWidgets import QMessageBox
                QMessageBox.information(self, "Recherche", f"Aucune occurrence de « {text} » trouvée.")
