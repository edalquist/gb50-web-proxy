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
  --rebuild-web      Recompile React / Vite frontend (enabled by default)
  --skip-web-build   Skip recompiling the React / Vite frontend
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
REBUILD_WEB=true
PROXY_REPO_URL="https://github.com/edalquist/gb50-web-proxy.git"

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
        --skip-web-build)
            REBUILD_WEB=false
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

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SOURCE_PROXY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
else
    SCRIPT_DIR=""
    SOURCE_PROXY_DIR=""
fi

info "Stopping gb50-proxy service..."
systemctl stop gb50-proxy.service || true

# 1. Update gb50-web-proxy application source
UPDATED_SOURCE=false
if [[ -n "${SOURCE_PROXY_DIR}" && -d "${SOURCE_PROXY_DIR}/.git" && -f "${SOURCE_PROXY_DIR}/server/main.py" ]]; then
    info "Pulling latest code updates in ${SOURCE_PROXY_DIR} via git..."
    git config --global --add safe.directory "${SOURCE_PROXY_DIR}" 2>/dev/null || true
    git -C "${SOURCE_PROXY_DIR}" pull --ff-only || warn "git pull failed or had merge conflicts. Continuing with local files."
    if [[ "${SOURCE_PROXY_DIR}" != "${TARGET_DIR}" ]]; then
        info "Synchronizing updated files from ${SOURCE_PROXY_DIR} to ${TARGET_DIR}..."
        rsync -a --delete \
            --exclude '.venv' \
            --exclude 'node_modules' \
            --exclude '__pycache__' \
            --exclude '.pytest_cache' \
            --exclude '*.pyc' \
            --exclude 'python-gb50' \
            "${SOURCE_PROXY_DIR}/" "${TARGET_DIR}/"
    fi
    UPDATED_SOURCE=true
elif [[ -d "${TARGET_DIR}/.git" ]]; then
    info "Pulling latest code updates in ${TARGET_DIR} via git..."
    git config --global --add safe.directory "${TARGET_DIR}" 2>/dev/null || true
    git -C "${TARGET_DIR}" pull --ff-only || warn "git pull failed or had merge conflicts. Continuing with local files."
    UPDATED_SOURCE=true
fi

if [[ "${UPDATED_SOURCE}" == false ]]; then
    info "Fetching latest gb50-web-proxy source from ${PROXY_REPO_URL}..."
    TMP_PROXY_DIR="$(mktemp -d)"
    if git clone --depth 1 "${PROXY_REPO_URL}" "${TMP_PROXY_DIR}" 2>/dev/null; then
        rsync -a --delete \
            --exclude '.venv' \
            --exclude 'node_modules' \
            --exclude '__pycache__' \
            --exclude '.pytest_cache' \
            --exclude '*.pyc' \
            --exclude 'python-gb50' \
            "${TMP_PROXY_DIR}/" "${TARGET_DIR}/"
        info "Synchronized latest gb50-web-proxy code into ${TARGET_DIR}."
    else
        warn "Could not clone ${PROXY_REPO_URL}; continuing with existing files in ${TARGET_DIR}."
    fi
    rm -rf "${TMP_PROXY_DIR}"
fi

# 2. Rebuild frontend web UI (enabled by default)
if [[ "${REBUILD_WEB}" == true || ! -f "${TARGET_DIR}/web/dist/index.html" ]]; then
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        info "Installing Node.js and npm for web dashboard compilation..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq && apt-get install -y --no-install-recommends nodejs npm || true
    fi
    if command -v npm >/dev/null 2>&1 && [[ -d "${TARGET_DIR}/web" ]]; then
        info "Rebuilding web dashboard..."
        pushd "${TARGET_DIR}/web" >/dev/null
        npm install --no-audit --no-fund
        npm run build
        popd >/dev/null
    else
        warn "npm not found or ${TARGET_DIR}/web missing; skipping web dashboard build."
    fi
fi

# 3. Update Python dependencies
info "Updating Python dependencies in virtual environment..."
"${TARGET_DIR}/.venv/bin/pip" install --upgrade pip setuptools wheel

if [[ -d "${TARGET_DIR}/python-gb50/.git" && -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    info "Pulling latest code for python-gb50..."
    git config --global --add safe.directory "${TARGET_DIR}/python-gb50" 2>/dev/null || true
    if ! git -C "${TARGET_DIR}/python-gb50" pull --ff-only 2>/dev/null; then
        warn "git pull for python-gb50 failed; re-fetching python-gb50 from GitHub..."
        rm -rf "${TARGET_DIR}/python-gb50"
    fi
else
    rm -rf "${TARGET_DIR}/python-gb50"
fi

if [[ ! -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    info "Fetching latest python-gb50 from GitHub..."
    rm -rf "${TARGET_DIR}/python-gb50"
    mkdir -p "${TARGET_DIR}/python-gb50"
    git clone --depth 1 https://github.com/edalquist/python-gb50.git "${TARGET_DIR}/python-gb50" 2>/dev/null || \
        curl -sSL "https://github.com/edalquist/python-gb50/archive/refs/heads/main.tar.gz" | tar -xz -C "${TARGET_DIR}/python-gb50" --strip-components=1 2>/dev/null || true
fi

if [[ -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    "${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${TARGET_DIR}/python-gb50"
else
    "${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "https://github.com/edalquist/python-gb50/archive/refs/heads/main.tar.gz"
fi
"${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${TARGET_DIR}"

# Reset ownership
chown -R gb50:gb50 "${TARGET_DIR}"

info "Starting gb50-proxy service..."
systemctl start gb50-proxy.service

if systemctl is-active --quiet gb50-kiosk.service; then
    info "Restarting gb50-kiosk display service to load updated UI..."
    systemctl restart gb50-kiosk.service || true
fi

sleep 2
if systemctl is-active --quiet gb50-proxy.service; then
    success "gb50-proxy service updated and running successfully!"
else
    error "Service failed to restart. Check logs with: journalctl -u gb50-proxy -n 25 --no-pager"
    exit 1
fi
