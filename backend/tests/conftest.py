"""Fixtures pytest communes."""
import pytest
from pathlib import Path

# Répertoire des fixtures
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def fixtures_dir():
    return FIXTURES_DIR
