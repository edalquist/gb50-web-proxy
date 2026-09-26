#!/usr/bin/env bash
# ==============================================================================
# Installer for Mitsubishi GB-50 HVAC REST Proxy & Web UI Service
# Supports: Debian 12 (Bookworm), Debian 13 (Trixie), Ubuntu 22.04/24.04 LTS
# Target Hardware: Dell Wyse 5070 / x86_64 Headless Servers
# ==============================================================================

set -euo pipefail

# ANSI color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}${BOLD}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARN]${NC} $*"; }
error()   { echo -e "${RED}${BOLD}[ERROR]${NC} $*" >&2; }

# --- 1. Help flag check (can run without root) ---
for arg in "$@"; do
    if [[ "$arg" == "-h" || "$arg" == "--help" ]]; then
        cat <<EOF
Usage: sudo $0 [OPTIONS]

Options:
  --target-dir DIR        Destination directory (default: /opt/gb50-proxy)
  --in-place              Install and run service directly from current repository location
  --controller-host IP    Target Mitsubishi GB-50 controller IP (default: 192.0.2.90)
  --controller-port PORT  Target GB-50 HTTP port (default: 80)
  --server-port PORT      HTTP port for proxy & web dashboard (default: 8080)
  --poll-interval SECS    Controller polling rate in seconds (default: 3.0)
  --skip-web-build        Skip npm build if web/dist already exists
  --with-kiosk            Also install and configure locked-down kiosk display mode
  --kiosk-auto-login ROLE Auto-login role for local kiosk: viewer, operator, admin, disabled (default: viewer)
  --hide-cursor MODE      Mouse cursor hiding: never, auto, always (default: never)
  --gb50-repo URL         Git repository URL for python-gb50 library (default: https://github.com/edalquist/python-gb50.git)
  --gb50-dir DIR          Local path to python-gb50 source directory (if cloned separately)
  --non-interactive       Run without confirmation prompts
  -h, --help              Show this help message
EOF
        exit 0
    fi
done

# --- 2. Root / Sudo Privilege Check ---
if [[ "${EUID}" -ne 0 ]]; then
    error "This script must be run as root. Please run with: sudo $0"
    exit 1
fi

# --- 3. Default Configuration Variables ---
TARGET_DIR="/opt/gb50-proxy"
IN_PLACE=false
CONTROLLER_HOST="192.0.2.90"
CONTROLLER_PORT="80"
SERVER_HOST="0.0.0.0"
SERVER_PORT="8080"
POLL_INTERVAL="3.0"
SKIP_WEB_BUILD=false
WITH_KIOSK=false
KIOSK_AUTO_LOGIN="viewer"
KIOSK_HIDE_CURSOR="never"
GB50_REPO_URL="https://github.com/edalquist/python-gb50.git"
GB50_DIR=""
NON_INTERACTIVE=false

# --- 4. Parse Command-Line Arguments ---
show_help() {
    cat <<EOF
Usage: sudo $0 [OPTIONS]

Options:
  --target-dir DIR        Destination directory (default: /opt/gb50-proxy)
  --in-place              Install and run service directly from current repository location
  --controller-host IP    Target Mitsubishi GB-50 controller IP (default: 192.0.2.90)
  --controller-port PORT  Target GB-50 HTTP port (default: 80)
  --server-port PORT      HTTP port for proxy & web dashboard (default: 8080)
  --poll-interval SECS    Controller polling rate in seconds (default: 3.0)
  --skip-web-build        Skip npm build if web/dist already exists
  --with-kiosk            Also install and configure locked-down kiosk display mode
  --kiosk-auto-login ROLE Auto-login role for local kiosk: viewer, operator, admin, disabled (default: viewer)
  --hide-cursor MODE      Mouse cursor hiding: never, auto, always (default: never)
  --gb50-repo URL         Git repository URL for python-gb50 library (default: https://github.com/edalquist/python-gb50.git)
  --gb50-dir DIR          Local path to python-gb50 source directory (if cloned separately)
  --non-interactive       Run without confirmation prompts
  -h, --help              Show this help message
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir)
            TARGET_DIR="$2"
            shift 2
            ;;
        --in-place)
            IN_PLACE=true
            shift
            ;;
        --controller-host)
            CONTROLLER_HOST="$2"
            shift 2
            ;;
        --controller-port)
            CONTROLLER_PORT="$2"
            shift 2
            ;;
        --server-port)
            SERVER_PORT="$2"
            shift 2
            ;;
        --poll-interval)
            POLL_INTERVAL="$2"
            shift 2
            ;;
        --skip-web-build)
            SKIP_WEB_BUILD=true
            shift
            ;;
        --with-kiosk)
            WITH_KIOSK=true
            shift
            ;;
        --kiosk-auto-login)
            KIOSK_AUTO_LOGIN="$2"
            shift 2
            ;;
        --hide-cursor)
            KIOSK_HIDE_CURSOR="$2"
            shift 2
            ;;
        --gb50-repo)
            GB50_REPO_URL="$2"
            shift 2
            ;;
        --gb50-dir)
            GB50_DIR="$2"
            shift 2
            ;;
        --non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            error "Unknown option: $1"
            show_help
            ;;
    esac
done

# --- 4. OS Verification ---
info "Verifying host operating system..."
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_NAME="${NAME:-Linux}"
    OS_VERSION="${VERSION_ID:-}"
    info "Detected: ${OS_NAME} ${OS_VERSION}"
else
    warn "Could not detect /etc/os-release. Proceeding assuming Debian-compatible system."
fi

# --- 5. Locate Source Repositories ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SOURCE_PROXY_DIR=""
SOURCE_LIB_DIR=""

if [[ -f "${SCRIPT_DIR}/../server/main.py" ]]; then
    # Running from inside gb50-web-proxy/scripts
    SOURCE_PROXY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
elif [[ -d "${SCRIPT_DIR}/../gb50-web-proxy" ]]; then
    # Running from church_ac/scripts
    SOURCE_PROXY_DIR="$(cd "${SCRIPT_DIR}/../gb50-web-proxy" && pwd)"
elif [[ -d "${SCRIPT_DIR}/gb50-web-proxy" ]]; then
    # Running from church_ac root
    SOURCE_PROXY_DIR="$(cd "${SCRIPT_DIR}/gb50-web-proxy" && pwd)"
elif [[ -f "${SCRIPT_DIR}/server/main.py" ]]; then
    # Running from gb50-web-proxy root
    SOURCE_PROXY_DIR="${SCRIPT_DIR}"
fi

# Locate python-gb50 driver library
if [[ -n "${GB50_DIR}" && -d "${GB50_DIR}" ]]; then
    SOURCE_LIB_DIR="$(cd "${GB50_DIR}" && pwd)"
elif [[ -d "${SOURCE_PROXY_DIR}/../python-gb50" ]]; then
    SOURCE_LIB_DIR="$(cd "${SOURCE_PROXY_DIR}/../python-gb50" && pwd)"
elif [[ -d "${SOURCE_PROXY_DIR}/python-gb50" ]]; then
    SOURCE_LIB_DIR="$(cd "${SOURCE_PROXY_DIR}/python-gb50" && pwd)"
fi

if [[ -z "${SOURCE_PROXY_DIR}" || ! -f "${SOURCE_PROXY_DIR}/server/main.py" ]]; then
    error "Could not locate gb50-web-proxy repository sources."
    exit 1
fi

if [[ "${IN_PLACE}" == true ]]; then
    TARGET_DIR="${SOURCE_PROXY_DIR}"
fi

info "Source Web Proxy : ${SOURCE_PROXY_DIR}"
info "Source Driver Lib: ${SOURCE_LIB_DIR:-"(not found locally; will clone from ${GB50_REPO_URL})"}"
info "Target Directory : ${TARGET_DIR}"
info "Kiosk Mode UI    : ${WITH_KIOSK}"

# --- 6. Prompt Confirmation in Interactive Mode ---
if [[ "${NON_INTERACTIVE}" == false ]]; then
    echo ""
    echo -e "${BOLD}Installation Summary:${NC}"
    echo "  - Install Directory : ${TARGET_DIR}"
    echo "  - GB-50 Controller  : ${CONTROLLER_HOST}:${CONTROLLER_PORT}"
    echo "  - Web Dashboard Port: ${SERVER_PORT}"
    echo "  - System User       : gb50 (systemd service runner)"
    echo "  - Configuration File: /etc/default/gb50-proxy"
    echo "  - Database Location : /var/lib/gb50/gb50_users.db"
    echo "  - Setup Kiosk Mode  : ${WITH_KIOSK} (Auto-Login: ${KIOSK_AUTO_LOGIN})"
    echo ""
    read -r -p "Proceed with installation? [Y/n] " CONFIRM
    CONFIRM="${CONFIRM:-Y}"
    if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
        info "Installation cancelled by user."
        exit 0
    fi
fi

# --- 7. Install System Dependencies ---
info "Installing required Debian APT packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    python3-setuptools \
    git \
    curl \
    rsync \
    openssl \
    ca-certificates

# Check Node.js & npm (needed if web/dist is not present or rebuild requested)
HAS_PREBUILT_WEB=false
if [[ -f "${SOURCE_PROXY_DIR}/web/dist/index.html" ]]; then
    HAS_PREBUILT_WEB=true
fi

if [[ "${HAS_PREBUILT_WEB}" == false || "${SKIP_WEB_BUILD}" == false ]]; then
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        info "Installing Node.js and npm for web dashboard compilation..."
        apt-get install -y --no-install-recommends nodejs npm || {
            warn "Could not install nodejs/npm via apt."
            if [[ "${HAS_PREBUILT_WEB}" == true ]]; then
                info "Using pre-built web UI assets in web/dist/."
                SKIP_WEB_BUILD=true
            else
                error "Node.js and npm are required to build the frontend dashboard."
                exit 1
            fi
        }
    fi
fi

# --- 8. Create Dedicated System User & Directories ---
info "Setting up system user 'gb50' and persistent state directory..."
if ! getent group gb50 >/dev/null 2>&1; then
    groupadd -r gb50
fi

if ! id -u gb50 >/dev/null 2>&1; then
    useradd -r -g gb50 -s /usr/sbin/nologin -d /var/lib/gb50 -c "Mitsubishi GB-50 Proxy Service" gb50
fi

# Persistent state directory for SQLite database
mkdir -p /var/lib/gb50
chown -R gb50:gb50 /var/lib/gb50
chmod 750 /var/lib/gb50

# Seed database if not present
if [[ ! -f /var/lib/gb50/gb50_users.db && -f "${SOURCE_PROXY_DIR}/gb50_users.db" ]]; then
    info "Seeding initial user database to /var/lib/gb50/gb50_users.db..."
    cp "${SOURCE_PROXY_DIR}/gb50_users.db" /var/lib/gb50/gb50_users.db
    chown gb50:gb50 /var/lib/gb50/gb50_users.db
    chmod 640 /var/lib/gb50/gb50_users.db
fi

# --- 9. Synchronize Files to Target Directory ---
if [[ "${IN_PLACE}" == false && "${SOURCE_PROXY_DIR}" != "${TARGET_DIR}" ]]; then
    info "Deploying code to ${TARGET_DIR}..."
    mkdir -p "${TARGET_DIR}"
    rsync -a --delete \
        --exclude '.venv' \
        --exclude 'node_modules' \
        --exclude '__pycache__' \
        --exclude '.pytest_cache' \
        --exclude '*.pyc' \
        --exclude '.git' \
        --exclude 'python-gb50' \
        "${SOURCE_PROXY_DIR}/" "${TARGET_DIR}/"

    if [[ -n "${SOURCE_LIB_DIR}" && -f "${SOURCE_LIB_DIR}/gb50/__init__.py" ]]; then
        info "Deploying python-gb50 library to ${TARGET_DIR}/python-gb50..."
        mkdir -p "${TARGET_DIR}/python-gb50"
        rsync -a --delete \
            --exclude '.venv' \
            --exclude '__pycache__' \
            --exclude '.pytest_cache' \
            --exclude '*.pyc' \
            --exclude '.git' \
            "${SOURCE_LIB_DIR}/" "${TARGET_DIR}/python-gb50/"
    fi
fi

# Ensure python-gb50 is present; clone or download archive from GitHub if not found locally
if [[ ! -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    info "python-gb50 library not found at ${TARGET_DIR}/python-gb50."
    rm -rf "${TARGET_DIR}/python-gb50"
    mkdir -p "${TARGET_DIR}/python-gb50"

    FETCHED=false
    if command -v git >/dev/null 2>&1; then
        info "Cloning python-gb50 from ${GB50_REPO_URL} into ${TARGET_DIR}/python-gb50..."
        if git clone --depth 1 "${GB50_REPO_URL}" "${TARGET_DIR}/python-gb50"; then
            FETCHED=true
        else
            warn "git clone failed. Falling back to downloading release archive..."
        fi
    fi

    if [[ "${FETCHED}" == false || ! -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
        info "Downloading python-gb50 source archive via curl..."
        rm -rf "${TARGET_DIR}/python-gb50"
        mkdir -p "${TARGET_DIR}/python-gb50"
        if curl -sSL "https://github.com/edalquist/python-gb50/archive/refs/heads/main.tar.gz" | tar -xz -C "${TARGET_DIR}/python-gb50" --strip-components=1 2>/dev/null; then
            FETCHED=true
            info "Downloaded and extracted python-gb50 archive successfully."
        else
            warn "Archive download via curl also failed."
        fi
    fi
elif [[ -d "${TARGET_DIR}/python-gb50/.git" && ( -z "${SOURCE_LIB_DIR}" || ! -d "${SOURCE_LIB_DIR}" ) ]]; then
    info "Updating existing python-gb50 repository in ${TARGET_DIR}/python-gb50..."
    git config --global --add safe.directory "${TARGET_DIR}/python-gb50" 2>/dev/null || true
    git -C "${TARGET_DIR}/python-gb50" pull --ff-only 2>/dev/null || warn "Could not fast-forward python-gb50 repo; continuing with existing files."
fi

# --- 10. Build Web Dashboard ---
if [[ "${SKIP_WEB_BUILD}" == false ]]; then
    if command -v npm >/dev/null 2>&1 && [[ -f "${TARGET_DIR}/web/package.json" ]]; then
        info "Compiling React / Vite web dashboard..."
        pushd "${TARGET_DIR}/web" >/dev/null
        npm install --no-audit --no-fund
        npm run build
        popd >/dev/null
    fi
fi

if [[ ! -f "${TARGET_DIR}/web/dist/index.html" ]]; then
    error "Web UI build artifact not found at ${TARGET_DIR}/web/dist/index.html"
    exit 1
fi

# --- 11. Create Python Virtual Environment ---
info "Setting up clean Python virtual environment in ${TARGET_DIR}/.venv..."
rm -rf "${TARGET_DIR}/.venv"
python3 -m venv "${TARGET_DIR}/.venv"
"${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir --upgrade pip setuptools wheel

# Install python-gb50 library first (resolves gb50 requirement for gb50-web-proxy)
if [[ -f "${TARGET_DIR}/python-gb50/gb50/__init__.py" ]]; then
    info "Installing python-gb50 library into virtual environment..."
    "${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${TARGET_DIR}/python-gb50"
elif [[ -n "${SOURCE_LIB_DIR}" && -f "${SOURCE_LIB_DIR}/gb50/__init__.py" ]]; then
    info "Installing python-gb50 from ${SOURCE_LIB_DIR}..."
    "${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${SOURCE_LIB_DIR}"
else
    info "Installing python-gb50 directly from GitHub via pip..."
    "${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "git+${GB50_REPO_URL}" || \
    "${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "https://github.com/edalquist/python-gb50/archive/refs/heads/main.tar.gz" || {
        error "Could not install required python-gb50 library."
        error "Please clone https://github.com/edalquist/python-gb50.git next to gb50-web-proxy and re-run."
        exit 1
    }
fi

# Install gb50-web-proxy and dependencies
info "Installing gb50-web-proxy into virtual environment..."
"${TARGET_DIR}/.venv/bin/pip" install --no-cache-dir "${TARGET_DIR}"

# Verify python environment and gb50 import
info "Verifying gb50 module import in virtual environment..."
if "${TARGET_DIR}/.venv/bin/python" -c "import gb50; from gb50.client import GB50Client; print('[SUCCESS] gb50 module verified successfully')"; then
    success "Python gb50 module import verified."
else
    error "Failed to verify gb50 import in ${TARGET_DIR}/.venv."
    exit 1
fi

# --- 12. Set Directory Permissions ---
chown -R gb50:gb50 "${TARGET_DIR}"
chmod -R u=rwX,go=rX "${TARGET_DIR}"

# --- 13. Install Environment Configuration ---
ENV_FILE="/etc/default/gb50-proxy"
if [[ -f "${ENV_FILE}" ]]; then
    warn "Existing configuration file found at ${ENV_FILE}. Preserving existing configuration."
else
    info "Generating environment configuration at ${ENV_FILE}..."
    JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"

    cat <<EOF > "${ENV_FILE}"
# /etc/default/gb50-proxy
# Environment configuration file for Mitsubishi GB-50 REST Proxy & Web UI service.

# --- Mitsubishi Controller Connection ---
GB50_HOST=${CONTROLLER_HOST}
GB50_PORT=${CONTROLLER_PORT}
GB50_POLL_INTERVAL=${POLL_INTERVAL}

# --- Web Proxy Server ---
SERVER_HOST=${SERVER_HOST}
SERVER_PORT=${SERVER_PORT}

# --- Persistence ---
GB50_DB_PATH=/var/lib/gb50/gb50_users.db

# --- Security & JWT ---
GB50_JWT_SECRET=${JWT_SECRET}

# Optional CORS allowed origins
# GB50_ALLOW_ORIGINS=http://localhost:${SERVER_PORT},http://${SERVER_HOST}:${SERVER_PORT}

# --- Kiosk Mode Settings ---
# Options for GB50_KIOSK_AUTO_LOGIN: "viewer", "operator", "admin", or "disabled"
GB50_KIOSK_AUTO_LOGIN=${KIOSK_AUTO_LOGIN}
GB50_KIOSK_HIDE_CURSOR=${KIOSK_HIDE_CURSOR}
EOF

    chown root:gb50 "${ENV_FILE}"
    chmod 640 "${ENV_FILE}"
fi

# --- 14. Install and Start Systemd Unit ---
SERVICE_FILE="/etc/systemd/system/gb50-proxy.service"
info "Installing systemd service unit at ${SERVICE_FILE}..."

cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=Mitsubishi GB-50 HVAC REST Proxy & Web UI
Documentation=https://github.com/church-ac/gb50-web-proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gb50
Group=gb50
WorkingDirectory=${TARGET_DIR}
EnvironmentFile=-/etc/default/gb50-proxy
ExecStart=${TARGET_DIR}/.venv/bin/python run_server.py

# Auto-restart on failure
Restart=always
RestartSec=5s
TimeoutStopSec=15
KillMode=mixed

# Sandboxing & Security Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictSUIDSGID=true
ReadWritePaths=/var/lib/gb50 ${TARGET_DIR}

# Allow binding to privileged low ports (e.g. port 80 / 443) as unprivileged user
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gb50-proxy

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gb50-proxy.service
systemctl restart gb50-proxy.service

# --- 15. Verify Service Status ---
info "Verifying service startup..."
sleep 2

if systemctl is-active --quiet gb50-proxy.service; then
    # Fetch primary IP address
    HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")"
    if [[ -z "${HOST_IP}" ]]; then HOST_IP="localhost"; fi

    echo ""
    success "================================================================"
    success " Mitsubishi GB-50 Proxy & Web UI Service Installed Successfully!"
    success "================================================================"
    echo ""
    echo -e "  ${BOLD}Web Dashboard UI :${NC} http://${HOST_IP}:${SERVER_PORT}/"
    echo -e "  ${BOLD}REST API Docs    :${NC} http://${HOST_IP}:${SERVER_PORT}/docs"
    echo -e "  ${BOLD}Config File      :${NC} ${ENV_FILE}"
    echo -e "  ${BOLD}Database File    :${NC} /var/lib/gb50/gb50_users.db"
    echo ""
    echo -e "  ${BOLD}Service Management Commands:${NC}"
    echo "    Check status : sudo systemctl status gb50-proxy"
    echo "    View logs    : sudo journalctl -u gb50-proxy -f"
    echo "    Restart      : sudo systemctl restart gb50-proxy"
    echo "    Stop         : sudo systemctl stop gb50-proxy"
    echo ""

    if [[ "${WITH_KIOSK}" == true ]]; then
        info "Setting up Kiosk Display environment..."
        "${SCRIPT_DIR}/install-kiosk.sh" \
            --target-dir "${TARGET_DIR}" \
            --auto-login "${KIOSK_AUTO_LOGIN}" \
            --hide-cursor "${KIOSK_HIDE_CURSOR}" \
            --non-interactive
    fi
else
    error "Service failed to start. Recent log messages:"
    journalctl -u gb50-proxy -n 25 --no-pager
    exit 1
fi
