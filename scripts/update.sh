#!/usr/bin/env bash
# ==============================================================================
# Updater for Mitsubishi GB-50 HVAC REST Proxy Service
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}${BOLD}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARN]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[ERROR]${NC} $*" >&2; }

for arg in "$@"; do
    if [[ "$arg" == "-h" || "$arg" == "--help" ]]; then
        cat <<EOF
Usage: sudo $0 [OPTIONS]

Options:
  --target-dir DIR   Target installation directory (default: /opt/gb50-proxy)
  --rebuild-web      Force recompilation of React / Vite frontend
  -h, --help         Show this help message
EOF
        exit 0
    fi
done

if [[ "${EUID}" -ne 0 ]]; then
    error "This script must be run as root. Please run with: sudo $0"
    exit 1
fi

TARGET_DIR="/opt/gb50-proxy"
REBUILD_WEB=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir)
            TARGET_DIR="$2"
            shift 2
            ;;
        --rebuild-web)
            REBUILD_WEB=true
            shift
            ;;
        *)
            warn "Unknown option: $1"
            shift
            ;;
    esac
done

if [[ ! -d "${TARGET_DIR}" || ! -d "${TARGET_DIR}/.venv" ]]; then
    error "Target directory ${TARGET_DIR} does not appear to be an active gb50 installation."
    exit 1
fi

info "Stopping gb50-proxy service..."
systemctl stop gb50-proxy.service || true

# If git repository is present, pull latest commits
if [[ -d "${TARGET_DIR}/.git" ]]; then
    info "Pulling latest code updates via git..."
    git -C "${TARGET_DIR}" pull --ff-only || warn "git pull failed or had merge conflicts. Continuing with local files."
fi

# Rebuild frontend if requested or if package.json is newer than dist/index.html
if [[ "${REBUILD_WEB}" == true || ! -f "${TARGET_DIR}/web/dist/index.html" ]]; then
    if command -v npm >/dev/null 2>&1 && [[ -d "${TARGET_DIR}/web" ]]; then
        info "Rebuilding web dashboard..."
        pushd "${TARGET_DIR}/web" >/dev/null
        npm install --no-audit --no-fund
        npm run build
        popd >/dev/null
    fi
fi

# Update Python dependencies
info "Updating Python dependencies in virtual environment..."
"${TARGET_DIR}/.venv/bin/pip" install --upgrade pip setuptools wheel

# Clean up any stale editable hooks or .pth files from previous attempts
rm -f "${TARGET_DIR}"/.venv/lib/python*/site-packages/__editable__* 2>/dev/null || true
rm -f "${TARGET_DIR}"/.venv/lib/python*/site-packages/*gb50*.pth 2>/dev/null || true

if [[ -d "${TARGET_DIR}/python-gb50" ]]; then
    if [[ -d "${TARGET_DIR}/python-gb50/.git" ]]; then
        info "Pulling latest code for python-gb50..."
        git config --global --add safe.directory "${TARGET_DIR}/python-gb50" 2>/dev/null || true
        git -C "${TARGET_DIR}/python-gb50" pull --ff-only 2>/dev/null || true
    fi
    "${TARGET_DIR}/.venv/bin/pip" install "${TARGET_DIR}/python-gb50"
else
    info "Installing python-gb50 from GitHub..."
    git clone https://github.com/edalquist/python-gb50.git "${TARGET_DIR}/python-gb50" 2>/dev/null && \
        "${TARGET_DIR}/.venv/bin/pip" install "${TARGET_DIR}/python-gb50" || \
        "${TARGET_DIR}/.venv/bin/pip" install "git+https://github.com/edalquist/python-gb50.git"
fi
"${TARGET_DIR}/.venv/bin/pip" install "${TARGET_DIR}"

# Reset ownership
chown -R gb50:gb50 "${TARGET_DIR}"

info "Starting gb50-proxy service..."
systemctl start gb50-proxy.service

sleep 2
if systemctl is-active --quiet gb50-proxy.service; then
    success "gb50-proxy service updated and running successfully!"
else
    error "Service failed to restart. Check logs with: journalctl -u gb50-proxy -n 25 --no-pager"
    exit 1
fi
