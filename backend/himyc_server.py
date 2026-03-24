"""
Point d'entrée PyInstaller pour le backend HIMYC.
Lance uvicorn programmatiquement — pas de CLI, pas de reload.
"""

import multiprocessing
import os
import sys

# Obligatoire pour PyInstaller --onefile + multiprocessing sur Windows
if __name__ == "__main__":
    multiprocessing.freeze_support()

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("HIMYC_API_HOST", "127.0.0.1")
    port = int(os.environ.get("HIMYC_API_PORT", "8765"))

    uvicorn.run(
        "howimetyourcorpus.api.server:app",
        host=host,
        port=port,
        access_log=False,
        reload=False,
    )
