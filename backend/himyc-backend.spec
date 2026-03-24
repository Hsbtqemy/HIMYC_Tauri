# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — backend HIMYC
# Généré pour Windows x86-64. Adapter TARGET_ARCH si nécessaire.
#
# Usage :
#   cd backend
#   pyinstaller himyc-backend.spec

from pathlib import Path
from PyInstaller.utils.hooks import copy_metadata

SRC = Path("src")

a = Analysis(
    ["himyc_server.py"],
    pathex=[str(SRC)],
    binaries=[],
    datas=[
        # Fichiers SQL référencés via Path(__file__).parent dans db.py
        (str(SRC / "howimetyourcorpus" / "core" / "storage" / "schema.sql"),
         "howimetyourcorpus/core/storage"),
        (str(SRC / "howimetyourcorpus" / "core" / "storage" / "migrations" / "*.sql"),
         "howimetyourcorpus/core/storage/migrations"),
        # Métadonnées du package — nécessaire pour importlib.metadata.version()
        *copy_metadata("HowIMetYourCorpus"),
    ],
    hiddenimports=[
        # uvicorn internals non détectés par analyse statique
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.middleware",
        "uvicorn.middleware.proxy_headers",
        # FastAPI / Starlette
        "fastapi",
        "fastapi.middleware",
        "fastapi.middleware.cors",
        "starlette.routing",
        "starlette.middleware",
        "starlette.middleware.cors",
        "starlette.staticfiles",
        # Backend HIMYC
        "howimetyourcorpus",
        "howimetyourcorpus.api",
        "howimetyourcorpus.api.server",
        "howimetyourcorpus.api.jobs",
        "howimetyourcorpus.core",
        "howimetyourcorpus.core.constants",
        "howimetyourcorpus.core.models",
        "howimetyourcorpus.core.storage",
        "howimetyourcorpus.core.storage.db",
        "howimetyourcorpus.core.pipeline",
        "howimetyourcorpus.core.normalize",
        "howimetyourcorpus.core.segment",
        "howimetyourcorpus.core.align",
        "howimetyourcorpus.core.subtitles",
        "howimetyourcorpus.core.adapters",
        "howimetyourcorpus.core.preparer",
        "howimetyourcorpus.core.export_utils",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Exclure les packages lourds inutiles au backend API
    excludes=[
        "PySide6", "PySide2", "PyQt5", "PyQt6",
        "tkinter", "_tkinter",
        "matplotlib", "numpy",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="himyc-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX peut casser certains .pyd Windows — désactivé par sécurité
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,       # Logs uvicorn visibles en debug ; False possible en prod
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
