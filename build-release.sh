#!/usr/bin/env bash
# build-release.sh — Build bundle release HIMYC (macOS .app/.dmg ou Windows .exe/.msi)
#
# Usage :
#   ./build-release.sh            → bundle pour la plateforme courante
#   ./build-release.sh --check    → vérification des prérequis uniquement
#
# Sorties (macOS) :
#   src-tauri/target/release/bundle/macos/HIMYC.app
#   src-tauri/target/release/bundle/dmg/HIMYC_*.dmg
#
# Sorties (Windows) :
#   src-tauri/target/release/bundle/nsis/HIMYC_*_x64-setup.exe
#   src-tauri/target/release/bundle/msi/HIMYC_*.msi
#
# ⚠️  Cross-compilation macOS → Windows :
#   Non supportée nativement. Utiliser GitHub Actions (voir ci-dessous) ou
#   une VM Windows avec ce même script.
#
# CI cross-platform (GitHub Actions) :
#   Voir https://v2.tauri.app/distribute/github-action/ pour une matrice
#   ubuntu-latest / macos-latest / windows-latest.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Couleurs ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BOLD}[build]${NC} $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[erreur]${NC} $*" >&2; }

# ── Détection plateforme ──────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin)  PLATFORM="macOS" ;;
  Linux)   PLATFORM="Linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="Windows" ;;
  *)       PLATFORM="$OS" ;;
esac

# ── Prérequis ─────────────────────────────────────────────────────────────────
check_prereqs() {
  local ok=true

  echo ""
  info "Vérification des prérequis ($PLATFORM)..."

  # Node.js >= 18
  if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
    if [ "$NODE_MAJOR" -ge 18 ]; then
      success "Node.js $NODE_VER"
    else
      error "Node.js >= 18 requis (trouvé $NODE_VER)"
      ok=false
    fi
  else
    error "Node.js non trouvé. Installer via https://nodejs.org"
    ok=false
  fi

  # npm
  if command -v npm &>/dev/null; then
    success "npm $(npm --version)"
  else
    error "npm non trouvé."
    ok=false
  fi

  # Rust / cargo
  if command -v cargo &>/dev/null; then
    success "Rust $(rustc --version 2>/dev/null | awk '{print $2}')"
  else
    error "cargo non trouvé. Installer via https://rustup.rs"
    ok=false
  fi

  # tauri-cli
  if npx tauri --version &>/dev/null 2>&1; then
    success "tauri-cli $(npx tauri --version 2>/dev/null)"
  else
    warn "tauri-cli non résolu via npx — sera installé avec npm install."
  fi

  # macOS : Xcode Command Line Tools
  if [ "$PLATFORM" = "macOS" ]; then
    if xcode-select -p &>/dev/null 2>&1; then
      success "Xcode CLT $(xcode-select -p)"
    else
      error "Xcode Command Line Tools manquants. Lancer : xcode-select --install"
      ok=false
    fi
  fi

  echo ""
  if [ "$ok" = false ]; then
    error "Prérequis manquants — build annulé."
    exit 1
  fi
  success "Tous les prérequis sont satisfaits."
}

# ── Build ─────────────────────────────────────────────────────────────────────
run_build() {
  echo ""
  info "Installation des dépendances npm..."
  npm install --prefer-offline 2>&1 | tail -3

  echo ""
  info "Build TypeScript + Vite..."
  npm run build

  echo ""
  info "Build Tauri release ($PLATFORM)..."
  npm run tauri build

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║  Build terminé ✓                                     ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Afficher les artefacts produits
  BUNDLE_DIR="$SCRIPT_DIR/src-tauri/target/release/bundle"
  if [ -d "$BUNDLE_DIR" ]; then
    info "Artefacts produits dans : $BUNDLE_DIR"
    echo ""
    case "$PLATFORM" in
      macOS)
        find "$BUNDLE_DIR" \( -name "*.app" -o -name "*.dmg" \) 2>/dev/null \
          | sort | while read -r f; do
            SIZE=$(du -sh "$f" 2>/dev/null | cut -f1)
            echo -e "  ${GREEN}▸${NC} $f  ($SIZE)"
          done
        ;;
      Windows)
        find "$BUNDLE_DIR" \( -name "*.exe" -o -name "*.msi" \) 2>/dev/null \
          | sort | while read -r f; do
            echo -e "  ${GREEN}▸${NC} $f"
          done
        ;;
      Linux)
        find "$BUNDLE_DIR" \( -name "*.deb" -o -name "*.AppImage" -o -name "*.rpm" \) 2>/dev/null \
          | sort | while read -r f; do
            SIZE=$(du -sh "$f" 2>/dev/null | cut -f1)
            echo -e "  ${GREEN}▸${NC} $f  ($SIZE)"
          done
        ;;
    esac
    echo ""
  fi

  if [ "$PLATFORM" = "macOS" ]; then
    warn "Pour un .exe Windows depuis macOS, utiliser GitHub Actions :"
    warn "  https://v2.tauri.app/distribute/github-action/"
    echo ""
  fi
}

# ── Entrée ────────────────────────────────────────────────────────────────────
case "${1:-}" in
  --check)
    check_prereqs
    ;;
  *)
    check_prereqs
    run_build
    ;;
esac
