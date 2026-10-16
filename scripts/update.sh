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
LIB_REPO_URL="https://github.com/edalquist/python-gb50.git"
ORIG_ARGS=("$@")

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

# 1. Update gb50-web-proxy application source first and re-exec if script changed
if [[ -z "${GB50_UPDATE_REEXEC:-}" ]]; then
    UPDATED_SOURCE=false
    if [[ -n "${SOURCE_PROXY_DIR}" && -d "${SOURCE_PROXY_DIR}/.git" && -f "${SOURCE_PROXY_DIR}/server/main.py" ]]; then
        info "Fetching latest gb50-web-proxy updates in ${SOURCE_PROXY_DIR}..."
        git config --global --add safe.directory "${SOURCE_PROXY_DIR}" 2>/dev/null || true
        if git -C "${SOURCE_PROXY_DIR}" fetch "${PROXY_REPO_URL}" main && git -C "${SOURCE_PROXY_DIR}" reset --hard FETCH_HEAD; then
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
        else
            warn "git fetch in ${SOURCE_PROXY_DIR} failed; falling back to direct GitHub fetch."
        fi
    elif [[ -d "${TARGET_DIR}/.git" ]]; then
        info "Fetching latest gb50-web-proxy updates in ${TARGET_DIR}..."
        git config --global --add safe.directory "${TARGET_DIR}" 2>/dev/null || true
        if git -C "${TARGET_DIR}" fetch "${PROXY_REPO_URL}" main && git -C "${TARGET_DIR}" reset --hard FETCH_HEAD; then
            UPDATED_SOURCE=true
        else
            warn "git fetch in ${TARGET_DIR} failed; falling back to fresh clone."
        fi
    fi

    if [[ "${UPDATED_SOURCE}" == false ]]; then
        info "Fetching latest gb50-web-proxy source from ${PROXY_REPO_URL}..."
        TMP_PROXY_DIR="$(mktemp -d)"
        if git clone --depth 1 "${PROXY_REPO_URL}" "${TMP_PROXY_DIR}"; then
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

    chmod +x "${TARGET_DIR}/scripts/"*.sh 2>/dev/null || true
    export GB50_UPDATE_REEXEC=1
    exec "${TARGET_DIR}/scripts/update.sh" "${ORIG_ARGS[@]}"
fi

info "Stopping gb50-proxy service..."
systemctl stop gb50-proxy.service || true

# 2. Pull and update python-gb50 library FIRST
info "Updating python-gb50 driver library..."
if [[ -d "${TARGET_DIR}/python-gb50/.git" && -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    git config --global --add safe.directory "${TARGET_DIR}/python-gb50" 2>/dev/null || true
    if ! (git -C "${TARGET_DIR}/python-gb50" fetch "${LIB_REPO_URL}" main && git -C "${TARGET_DIR}/python-gb50" reset --hard FETCH_HEAD); then
        warn "git fetch for python-gb50 failed; re-cloning python-gb50 from GitHub..."
        rm -rf "${TARGET_DIR}/python-gb50"
    fi
else
    rm -rf "${TARGET_DIR}/python-gb50"
fi

if [[ ! -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    info "Cloning latest python-gb50 from ${LIB_REPO_URL}..."
    rm -rf "${TARGET_DIR}/python-gb50"
    mkdir -p "${TARGET_DIR}/python-gb50"
    git clone --depth 1 "${LIB_REPO_URL}" "${TARGET_DIR}/python-gb50" || \
        curl -sSL "https://github.com/edalquist/python-gb50/archive/refs/heads/main.tar.gz" | tar -xz -C "${TARGET_DIR}/python-gb50" --strip-components=1
fi

# 3. Install Python packages (python-gb50 first, then gb50-web-proxy)
info "Updating Python packages in virtual environment..."
"${TARGET_DIR}/.venv/bin/pip" install --upgrade pip setuptools wheel
"${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${TARGET_DIR}/python-gb50"
"${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${TARGET_DIR}/python-gb50" "${TARGET_DIR}"

# 4. Rebuild frontend web UI (enabled by default)
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
