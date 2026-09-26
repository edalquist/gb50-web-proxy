#!/usr/bin/env bash
# ==============================================================================
# Uninstaller for Mitsubishi GB-50 HVAC REST Proxy Service
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
  --purge     Completely remove all configuration, user databases, and installed files
  -h, --help  Show this help message
EOF
        exit 0
    fi
done

if [[ "${EUID}" -ne 0 ]]; then
    error "This script must be run as root. Please run with: sudo $0"
    exit 1
fi

PURGE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --purge)
            PURGE=true
            shift
            ;;
        *)
            warn "Unknown option: $1"
            shift
            ;;
    esac
done

info "Stopping and disabling services..."
systemctl stop gb50-kiosk.service 2>/dev/null || true
systemctl disable gb50-kiosk.service 2>/dev/null || true
systemctl stop gb50-proxy.service 2>/dev/null || true
systemctl disable gb50-proxy.service 2>/dev/null || true

if [[ -f /etc/systemd/system/gb50-kiosk.service ]]; then
    rm -f /etc/systemd/system/gb50-kiosk.service
    info "Removed systemd unit /etc/systemd/system/gb50-kiosk.service."
fi

if [[ -f /etc/systemd/system/gb50-proxy.service ]]; then
    rm -f /etc/systemd/system/gb50-proxy.service
    info "Removed systemd unit /etc/systemd/system/gb50-proxy.service."
fi
systemctl daemon-reload

if [[ "${PURGE}" == true ]]; then
    info "Purging configuration, database, and installed files..."
    rm -f /etc/default/gb50-proxy
    rm -rf /var/lib/gb50
    rm -rf /opt/gb50-proxy
    if id -u gb50 >/dev/null 2>&1; then
        userdel gb50 2>/dev/null || true
    fi
    success "gb50-proxy completely purged."
else
    echo ""
    warn "Kept configuration (/etc/default/gb50-proxy) and data (/var/lib/gb50)."
    warn "To completely remove all data and files, re-run with: sudo $0 --purge"
    success "gb50-proxy service uninstalled."
fi
