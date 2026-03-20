"""Non-regression checks for CI workflow wiring."""

from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def test_release_workflow_packages_macos_app_zip_and_fails_on_missing_asset() -> None:
    workflow = _read(".github/workflows/release.yml")

    assert "HowIMetYourCorpus-macos.app.zip" in workflow
    assert "ditto -c -k --sequesterRsrc --keepParent" in workflow
    assert "files: ${{ env.ZIP_PATH }}" in workflow
    assert workflow.count("fail_on_unmatched_files: true") >= 2


def test_quality_gate_workflow_runs_required_checks() -> None:
    workflow = _read(".github/workflows/quality-gate.yml")

    assert "python scripts/quality_gate.py --coverage-min" in workflow
    assert "python scripts/e2e_checklist_assist.py --skip-precheck" in workflow
    assert "pull_request:" in workflow
