"""Widget Stats Alignement — Phase 7 HP4.

Panneau latéral affichant les statistiques d'un run d'alignement en temps réel.
"""

from __future__ import annotations

from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QGroupBox


class AlignStatsWidget(QWidget):
    """Panneau stats alignement (affiché en permanence à droite de la table)."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)

        self.group = QGroupBox("📊 STATISTIQUES")
        group_layout = QVBoxLayout(self.group)
        group_layout.setSpacing(4)

        # Labels stats
        self.links_label = QLabel("Liens: —")
        self.auto_label = QLabel("  ├─ Auto: —")
        self.accepted_label = QLabel("  ├─ Accepté: —")
        self.rejected_label = QLabel("  └─ Rejeté: —")
        self.confidence_label = QLabel("\nConfiance: —")
        self.segments_label = QLabel("Segments: —")
        self.cues_pivot_label = QLabel("Cues EN: —")
        self.cues_target_label = QLabel("Cues FR: —")

        # Style
        font_style = "font-family: 'Courier New', monospace; font-size: 10pt;"
        for lbl in [
            self.links_label,
            self.auto_label,
            self.accepted_label,
            self.rejected_label,
        ]:
            lbl.setStyleSheet(font_style)
            group_layout.addWidget(lbl)

        for lbl in [
            self.confidence_label,
            self.segments_label,
            self.cues_pivot_label,
            self.cues_target_label,
        ]:
            lbl.setStyleSheet(font_style)
            group_layout.addWidget(lbl)

        layout.addWidget(self.group)
        layout.addStretch()

        # Info tooltip
        self.setToolTip(
            "Statistiques du run d'alignement sélectionné.\n"
            "Mise à jour automatique après accept/reject."
        )

    def update_stats(self, stats: dict) -> None:
        """Met à jour l'affichage avec les stats du run.

        Args:
            stats: Dict retourné par db.get_align_stats_for_run()
                   (nb_links, nb_pivot, nb_target, by_status, avg_confidence)
        """
        if not stats:
            self.clear_stats()
            return

        by_status = stats.get("by_status", {})
        nb_links = stats.get("nb_links", 0)
        auto = by_status.get("auto", 0)
        accepted = by_status.get("accepted", 0)
        rejected = by_status.get("rejected", 0)

        self.links_label.setText(f"Liens: {nb_links}")
        self.auto_label.setText(f"  ├─ Auto: {auto}")
        self.accepted_label.setText(f"  ├─ Accepté: {accepted}")
        self.rejected_label.setText(f"  └─ Rejeté: {rejected}")

        conf = stats.get("avg_confidence")
        if conf is not None:
            self.confidence_label.setText(f"\nConfiance: {conf:.3f}")
        else:
            self.confidence_label.setText("\nConfiance: —")

        self.segments_label.setText(f"Segments: {stats.get('nb_pivot', 0)}")
        
        # Cues pivot et target (selon pivot_lang et target_langs)
        nb_pivot = stats.get("nb_pivot", 0)
        nb_target = stats.get("nb_target", 0)
        self.cues_pivot_label.setText(f"Cues EN: {nb_pivot}")
        self.cues_target_label.setText(f"Cues FR: {nb_target}")

    def clear_stats(self) -> None:
        """Efface l'affichage (aucun run sélectionné)."""
        self.links_label.setText("Liens: —")
        self.auto_label.setText("  ├─ Auto: —")
        self.accepted_label.setText("  ├─ Accepté: —")
        self.rejected_label.setText("  └─ Rejeté: —")
        self.confidence_label.setText("\nConfiance: —")
        self.segments_label.setText("Segments: —")
        self.cues_pivot_label.setText("Cues EN: —")
        self.cues_target_label.setText("Cues FR: —")
