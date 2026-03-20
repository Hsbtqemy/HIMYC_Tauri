#!/usr/bin/env bash
# start-dev.sh — Runbook lancement pilote HIMYC (MX-001 ADR)
#
# Ce script est un GUIDE, pas un orchestrateur.
# Lancer les deux process dans des terminaux séparés pour des logs indépendants.

set -e

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  HIMYC — Runbook lancement pilote dev                        ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  Terminal 1 — Backend HIMYC Python :                        ║"
echo "║  cd backend && pip install -e '.[api,dev]'  (1ère fois)     ║"
echo "║  cd ..                                                       ║"
echo "║  uvicorn howimetyourcorpus.api.server:app --port 8765 \      ║"
echo "║           --reload                                           ║"
echo "║                                                              ║"
echo "║  Terminal 2 — Frontend Tauri (ce terminal) :                ║"
echo "║  npm install  (premiere fois seulement)                      ║"
echo "║  npm run tauri dev                                           ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Vérifier que npm est disponible
if ! command -v npm &>/dev/null; then
  echo "ERREUR : npm non trouvé. Installer Node.js >= 18."
  exit 1
fi

# Vérifier que cargo est disponible
if ! command -v cargo &>/dev/null; then
  echo "ERREUR : cargo non trouvé. Installer Rust via rustup."
  exit 1
fi

echo "Prérequis OK. Lancer 'npm install' si première exécution, puis 'npm run tauri dev'."
