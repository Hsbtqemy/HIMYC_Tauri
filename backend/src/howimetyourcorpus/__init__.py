"""HowIMetYourCorpus — Pipeline de corpus + exploration + QA."""

from importlib.metadata import version as _pkg_version, PackageNotFoundError as _PNF

try:
    __version__: str = _pkg_version("howimetyourcorpus")
except _PNF:
    __version__ = "0.0.0+dev"
