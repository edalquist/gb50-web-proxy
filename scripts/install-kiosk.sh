#!/usr/bin/env bash
# ==============================================================================
# Installer for Mitsubishi GB-50 Kiosk Display Mode & Locked-Down UI
# Supports: Debian 13 (Trixie), Debian 12 (Bookworm), Ubuntu LTS
# Target Hardware: Dell Wyse 5070 / Thin Clients / Intel NUC / Mini PCs
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

# --- 1. Help flag check ---
for arg in "$@"; do
    if [[ "$arg" == "-h" || "$arg" == "--help" ]]; then
        cat <<EOF
Usage: sudo $0 [OPTIONS]

Options:
  --target-dir DIR        GB-50 proxy installation directory (default: /opt/gb50-proxy)
  --kiosk-user USER       Dedicated Linux user for kiosk UI (default: kiosk)
  --auto-login ROLE       Auto-login role on kiosk boot: viewer, operator, admin, disabled (default: viewer)
  --hide-cursor MODE      Mouse cursor hiding: auto, always, never (default: auto)
  --non-interactive       Run without confirmation prompts
  -h, --help              Show this help message
EOF
        exit 0
    fi
done

# --- 2. Root Check ---
if [[ "${EUID}" -ne 0 ]]; then
    error "This script must be run as root. Please run with: sudo $0"
    exit 1
fi

# --- 3. Default Configuration Variables ---
TARGET_DIR="/opt/gb50-proxy"
KIOSK_USER="kiosk"
AUTO_LOGIN="viewer"
HIDE_CURSOR="never"
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-dir)
            TARGET_DIR="$2"
            shift 2
            ;;
        --kiosk-user)
            KIOSK_USER="$2"
            shift 2
            ;;
        --auto-login)
            AUTO_LOGIN="$2"
            shift 2
            ;;
        --hide-cursor)
            HIDE_CURSOR="$2"
            shift 2
            ;;
        --non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        -h|--help)
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# --- 4. OS Verification ---
info "Verifying host operating system..."
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    info "Detected: ${NAME:-Linux} ${VERSION_ID:-}"
fi

# Locate repository directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Verify base gb50 installation exists
if [[ ! -d "${TARGET_DIR}" && -d "${REPO_DIR}/gb50-web-proxy" ]]; then
    TARGET_DIR="${REPO_DIR}/gb50-web-proxy"
fi

if [[ "${NON_INTERACTIVE}" == false ]]; then
    echo ""
    echo -e "${BOLD}GB-50 Kiosk Display Setup Summary:${NC}"
    echo "  - Install Directory : ${TARGET_DIR}"
    echo "  - Kiosk System User : ${KIOSK_USER}"
    echo "  - Kiosk Auto-Login  : ${AUTO_LOGIN}"
    echo "  - Mouse Cursor Mode : ${HIDE_CURSOR}"
    echo "  - Display Service   : /etc/systemd/system/gb50-kiosk.service"
    echo ""
    read -r -p "Proceed with kiosk installation? [Y/n] " CONFIRM
    CONFIRM="${CONFIRM:-Y}"
    if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
        info "Kiosk installation cancelled by user."
        exit 0
    fi
fi

# --- 5. Install Required Debian APT Packages ---
info "Installing required X11, Openbox, and Chromium packages via APT..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Debian package list for minimal locked down kiosk
PACKAGES=(
    xserver-xorg
    xserver-xorg-legacy
    xinit
    openbox
    x11-xserver-utils
    curl
)

# Unclutter package detection (unclutter-xfixes or unclutter)
if apt-cache show unclutter-xfixes >/dev/null 2>&1; then
    PACKAGES+=(unclutter-xfixes)
else
    PACKAGES+=(unclutter)
fi

# Browser package detection
if apt-cache show chromium >/dev/null 2>&1; then
    PACKAGES+=(chromium)
elif apt-cache show chromium-browser >/dev/null 2>&1; then
    PACKAGES+=(chromium-browser)
else
    PACKAGES+=(firefox-esr)
fi

apt-get install -y --no-install-recommends "${PACKAGES[@]}"

# --- 6. Set Up Dedicated Kiosk User ---
info "Configuring dedicated system user '${KIOSK_USER}'..."
if ! id -u "${KIOSK_USER}" >/dev/null 2>&1; then
    useradd -m -s /bin/bash -c "Mitsubishi GB-50 Kiosk Display" "${KIOSK_USER}"
fi

# Ensure user is part of hardware acceleration and input groups
for grp in video render input audio tty dialout; do
    if getent group "${grp}" >/dev/null 2>&1; then
        usermod -a -G "${grp}" "${KIOSK_USER}"
    fi
done

# --- 7. Configure Non-Root Xorg Execution ---
info "Configuring Xwrapper permissions for non-root display execution..."
mkdir -p /etc/X11
cat <<EOF > /etc/X11/Xwrapper.config
# /etc/X11/Xwrapper.config
allowed_users=anybody
needs_root_rights=yes
EOF

# --- 8. Deploy Security Lockdown Snippet (Disable VT Switch) ---
info "Locking down virtual terminal switching (Ctrl+Alt+F1-F7)..."
mkdir -p /etc/X11/xorg.conf.d
if [[ -f "${SCRIPT_DIR}/../systemd/10-kiosk-lockdown.conf" ]]; then
    cp "${SCRIPT_DIR}/../systemd/10-kiosk-lockdown.conf" /etc/X11/xorg.conf.d/10-kiosk-lockdown.conf
else
    cat <<EOF > /etc/X11/xorg.conf.d/10-kiosk-lockdown.conf
Section "ServerFlags"
    Option "DontVTSwitch" "true"
    Option "DontZap" "true"
EndSection
EOF
fi

# --- 9. Deploy Openbox Lockdown Configuration ---
info "Installing locked-down Openbox configuration..."
mkdir -p /etc/gb50-kiosk
if [[ -f "${SCRIPT_DIR}/../systemd/openbox-kiosk.xml" ]]; then
    cp "${SCRIPT_DIR}/../systemd/openbox-kiosk.xml" /etc/gb50-kiosk/openbox-rc.xml
elif [[ -f "${TARGET_DIR}/systemd/openbox-kiosk.xml" ]]; then
    cp "${TARGET_DIR}/systemd/openbox-kiosk.xml" /etc/gb50-kiosk/openbox-rc.xml
fi

# --- 10. Deploy Kiosk Session Launcher Script ---
info "Deploying kiosk session script..."
mkdir -p "${TARGET_DIR}/scripts"
if [[ -f "${SCRIPT_DIR}/kiosk-session.sh" ]]; then
    cp "${SCRIPT_DIR}/kiosk-session.sh" "${TARGET_DIR}/scripts/kiosk-session.sh"
fi
chmod 755 "${TARGET_DIR}/scripts/kiosk-session.sh"
chown root:root "${TARGET_DIR}/scripts/kiosk-session.sh"

# --- 11. Update Environment Configuration (/etc/default/gb50-proxy) ---
ENV_FILE="/etc/default/gb50-proxy"
mkdir -p /etc/default
if [[ -f "${ENV_FILE}" ]]; then
    # Update or append Kiosk configuration options
    if grep -q "GB50_KIOSK_AUTO_LOGIN" "${ENV_FILE}"; then
        sed -i "s/^GB50_KIOSK_AUTO_LOGIN=.*/GB50_KIOSK_AUTO_LOGIN=${AUTO_LOGIN}/" "${ENV_FILE}"
    else
        echo "" >> "${ENV_FILE}"
        echo "# --- Kiosk Mode Settings ---" >> "${ENV_FILE}"
        echo "GB50_KIOSK_AUTO_LOGIN=${AUTO_LOGIN}" >> "${ENV_FILE}"
    fi

    if grep -q "GB50_KIOSK_HIDE_CURSOR" "${ENV_FILE}"; then
        sed -i "s/^GB50_KIOSK_HIDE_CURSOR=.*/GB50_KIOSK_HIDE_CURSOR=${HIDE_CURSOR}/" "${ENV_FILE}"
    else
        echo "GB50_KIOSK_HIDE_CURSOR=${HIDE_CURSOR}" >> "${ENV_FILE}"
    fi

    if ! grep -q "GB50_KIOSK_SCREENSAVER" "${ENV_FILE}"; then
        echo "" >> "${ENV_FILE}"
        echo "# Screensaver / Burn-in Protection Settings" >> "${ENV_FILE}"
        echo "# Options: dpms (sleep monitor), blank (black screen), off (disabled)" >> "${ENV_FILE}"
        echo "GB50_KIOSK_SCREENSAVER=dpms" >> "${ENV_FILE}"
        echo "GB50_KIOSK_SCREENSAVER_TIMEOUT=600" >> "${ENV_FILE}"
    fi
else
    cat <<EOF > "${ENV_FILE}"
# /etc/default/gb50-proxy
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
GB50_KIOSK_AUTO_LOGIN=${AUTO_LOGIN}
GB50_KIOSK_HIDE_CURSOR=${HIDE_CURSOR}
GB50_KIOSK_SCREENSAVER=dpms
GB50_KIOSK_SCREENSAVER_TIMEOUT=600
EOF
    chown root:gb50 "${ENV_FILE}" 2>/dev/null || chown root:root "${ENV_FILE}"
    chmod 640 "${ENV_FILE}"
fi

# --- 12. Deploy and Enable Systemd Service Unit ---
SERVICE_FILE="/etc/systemd/system/gb50-kiosk.service"
info "Installing systemd unit at ${SERVICE_FILE}..."

cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=Mitsubishi GB-50 Kiosk Display UI
Documentation=https://github.com/church-ac/gb50-web-proxy
After=network-online.target gb50-proxy.service
Wants=network-online.target gb50-proxy.service
Conflicts=getty@tty7.service

[Service]
Type=simple
User=${KIOSK_USER}
Group=${KIOSK_USER}
PAMName=login
Environment=DISPLAY=:0
EnvironmentFile=-/etc/default/gb50-proxy
StandardInput=tty
TTYPath=/dev/tty7
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gb50-kiosk

# Start X11 on VT7 running our resilient kiosk session script
ExecStart=/usr/bin/xinit ${TARGET_DIR}/scripts/kiosk-session.sh -- /usr/bin/X :0 vt7 -keeptty -noreset -v

# Auto-recovery resilience
Restart=always
RestartSec=3s
TimeoutStopSec=10
KillMode=mixed

[Install]
WantedBy=graphical.target
EOF

systemctl daemon-reload
systemctl enable gb50-kiosk.service

# If the proxy service is installed, restart it to load new KIOSK_AUTO_LOGIN setting
if systemctl is-enabled --quiet gb50-proxy.service 2>/dev/null; then
    info "Restarting gb50-proxy service to reload environment..."
    systemctl restart gb50-proxy.service || true
fi

# Restart kiosk service
info "Starting gb50-kiosk service..."
systemctl restart gb50-kiosk.service || true

sleep 2

echo ""
success "================================================================"
success " Mitsubishi GB-50 Kiosk Display Mode Configured Successfully!  "
success "================================================================"
echo ""
echo -e "  ${BOLD}Kiosk User       :${NC} ${KIOSK_USER}"
echo -e "  ${BOLD}Auto-Login Role  :${NC} ${AUTO_LOGIN}"
echo -e "  ${BOLD}Kiosk Service    :${NC} sudo systemctl status gb50-kiosk"
echo -e "  ${BOLD}View Kiosk Logs  :${NC} sudo journalctl -u gb50-kiosk -f"
echo ""
echo -e "  ${BOLD}Kiosk Management Operations:${NC}"
echo "    Restart kiosk display: sudo systemctl restart gb50-kiosk"
echo "    Stop kiosk display   : sudo systemctl stop gb50-kiosk"
echo "    Start kiosk display  : sudo systemctl start gb50-kiosk"
echo ""
