"""Onglets de la fenêtre principale (Projet, Corpus, Inspecteur, Préparer, Alignement, Concordance, Personnages, Logs, Expert)."""

from howimetyourcorpus.app.tabs.tab_alignement import AlignmentTabWidget
from howimetyourcorpus.app.tabs.tab_concordance import ConcordanceTabWidget
from howimetyourcorpus.app.tabs.tab_corpus import CorpusTabWidget
from howimetyourcorpus.app.tabs.tab_expert import ExpertTransverseTabWidget
from howimetyourcorpus.app.tabs.tab_inspecteur import InspectorTabWidget
from howimetyourcorpus.app.tabs.tab_inspecteur_sous_titres import InspecteurEtSousTitresTabWidget
from howimetyourcorpus.app.tabs.tab_logs import LogsTabWidget
from howimetyourcorpus.app.tabs.tab_personnages import PersonnagesTabWidget
from howimetyourcorpus.app.tabs.tab_preparer import PreparerTabWidget
from howimetyourcorpus.app.tabs.tab_projet import ProjectTabWidget
from howimetyourcorpus.app.tabs.tab_sous_titres import SubtitleTabWidget

__all__ = [
    "AlignmentTabWidget",
    "ConcordanceTabWidget",
    "CorpusTabWidget",
    "ExpertTransverseTabWidget",
    "InspectorTabWidget",
    "InspecteurEtSousTitresTabWidget",
    "LogsTabWidget",
    "PersonnagesTabWidget",
    "PreparerTabWidget",
    "ProjectTabWidget",
    "SubtitleTabWidget",
]
