"""Dialogues réutilisables (import SRT masse, profils, OpenSubtitles, etc.)."""

from howimetyourcorpus.app.dialogs.opensubtitles_download import OpenSubtitlesDownloadDialog
from howimetyourcorpus.app.dialogs.normalize_options import NormalizeOptionsDialog
from howimetyourcorpus.app.dialogs.profiles import ProfilesDialog
from howimetyourcorpus.app.dialogs.segmentation_options import SegmentationOptionsDialog
from howimetyourcorpus.app.dialogs.subtitle_batch_import import SubtitleBatchImportDialog

__all__ = [
    "NormalizeOptionsDialog",
    "OpenSubtitlesDownloadDialog",
    "ProfilesDialog",
    "SegmentationOptionsDialog",
    "SubtitleBatchImportDialog",
]
