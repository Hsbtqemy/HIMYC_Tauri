"""Utilitaires UI : décorateurs et fonctions communes pour l'interface Qt."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, TypeVar

from PySide6.QtWidgets import QMessageBox, QWidget

T = TypeVar("T")


def _message_title_for_context(class_name: str, method_name: str) -> str:
    """Retourne le titre de message (onglet) selon le contexte classe:méthode."""
    context = f"{class_name}:{method_name}".lower()
    if "subtitle" in context or "srt" in context:
        return "Sous-titres"
    if "profile" in context:
        return "Profils"
    if "character" in context or "personnage" in context:
        return "Personnages"
    if "lang" in context:
        return "Langues"
    if "preparer" in context or "préparer" in context:
        return "Préparer"
    if "concord" in context:
        return "Concordance"
    if "align" in context:
        return "Alignement"
    return "Corpus"


def require_project(method: Callable[..., T]) -> Callable[..., T | None]:
    """Décorateur vérifiant qu'un projet est ouvert avant d'exécuter la méthode.
    
    Le widget doit avoir une méthode `_get_store()` qui retourne le ProjectStore ou None.
    
    Usage:
        @require_project
        def _my_action(self):
            # Cette méthode ne sera exécutée que si un projet est ouvert
            store = self._get_store()
            # ...
    """
    @wraps(method)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> T | None:
        if not hasattr(self, "_get_store"):
            raise AttributeError(
                f"Le widget {self.__class__.__name__} doit avoir une méthode _get_store() "
                "pour utiliser le décorateur @require_project"
            )
        
        store = self._get_store()
        if not store:
            title = _message_title_for_context(
                self.__class__.__name__, method.__name__
            )
            QMessageBox.warning(
                self,
                title,
                "Ouvrez un projet d'abord."
            )
            return None
        
        return method(self, *args, **kwargs)
    
    return wrapper


def require_db(method: Callable[..., T]) -> Callable[..., T | None]:
    """Décorateur vérifiant qu'une base de données est ouverte.

    Le widget doit avoir une méthode `_get_db()` qui retourne la DB ou None.
    """

    @wraps(method)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> T | None:
        if not hasattr(self, "_get_db"):
            raise AttributeError(
                f"Le widget {self.__class__.__name__} doit avoir une méthode _get_db() "
                "pour utiliser le décorateur @require_db"
            )

        db = self._get_db()
        if not db:
            title = _message_title_for_context(
                self.__class__.__name__, method.__name__
            )
            QMessageBox.warning(
                self,
                title,
                "Ouvrez un projet d'abord."
            )
            return None

        return method(self, *args, **kwargs)

    return wrapper


def require_project_and_db(method: Callable[..., T]) -> Callable[..., T | None]:
    """Décorateur vérifiant qu'un projet ET une base de données sont ouverts.
    
    Le widget doit avoir les méthodes `_get_store()` et `_get_db()`.
    
    Usage:
        @require_project_and_db
        def _my_action(self):
            store = self._get_store()
            db = self._get_db()
            # ...
    """
    @wraps(method)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> T | None:
        if not hasattr(self, "_get_store") or not hasattr(self, "_get_db"):
            raise AttributeError(
                f"Le widget {self.__class__.__name__} doit avoir _get_store() et _get_db() "
                "pour utiliser @require_project_and_db"
            )
        
        store = self._get_store()
        db = self._get_db()
        
        if not store or not db:
            title = _message_title_for_context(
                self.__class__.__name__, method.__name__
            )
            QMessageBox.warning(
                self,
                title,
                "Ouvrez un projet d'abord."
            )
            return None
        
        return method(self, *args, **kwargs)
    
    return wrapper


def show_info(parent: QWidget, title: str, message: str) -> None:
    """Affiche un message d'information avec un style cohérent."""
    QMessageBox.information(parent, title, message)


def show_warning(parent: QWidget, title: str, message: str) -> None:
    """Affiche un message d'avertissement avec un style cohérent."""
    QMessageBox.warning(parent, title, message)


def show_error(parent: QWidget, title: str, message: str) -> None:
    """Affiche un message d'erreur avec un style cohérent."""
    QMessageBox.critical(parent, title, message)


def confirm_action(parent: QWidget, title: str, message: str) -> bool:
    """Affiche un dialogue de confirmation et retourne True si l'utilisateur accepte."""
    reply = QMessageBox.question(
        parent,
        title,
        message,
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        QMessageBox.StandardButton.No,
    )
    return reply == QMessageBox.StandardButton.Yes
