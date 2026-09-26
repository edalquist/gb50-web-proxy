#!/usr/bin/env bash
# ==============================================================================
# Kiosk Session Launcher for Mitsubishi GB-50 Web UI
# Target OS: Debian 13 (Trixie) / Debian 12 (Bookworm)
# ==============================================================================

set -uo pipefail

# 1. Source Environment Configuration
if [[ -f /etc/default/gb50-proxy ]]; then
    # shellcheck disable=SC1091
    . /etc/default/gb50-proxy
fi

SERVER_PORT="${SERVER_PORT:-8080}"
if [[ "${SERVER_PORT}" == "80" ]]; then
    KIOSK_URL="${GB50_KIOSK_URL:-http://localhost/}"
else
    KIOSK_URL="${GB50_KIOSK_URL:-http://localhost:${SERVER_PORT}/}"
fi
HIDE_CURSOR="${GB50_KIOSK_HIDE_CURSOR:-never}" # never (always visible), auto (hide after 2s inactivity), always (hidden)
ENABLE_DPMS="${GB50_KIOSK_DPMS:-false}"       # true (sleep display after idle), false (always on)
DPMS_TIMEOUT="${GB50_KIOSK_DPMS_TIMEOUT:-900}" # seconds before display sleep if enabled (default 15m)

echo "Starting Mitsubishi GB-50 Kiosk Session..."
echo "Target URL: ${KIOSK_URL}"
echo "Cursor Mode: ${HIDE_CURSOR}"

# 2. Configure Display Blanking & Energy Settings
if [[ "${ENABLE_DPMS}" == "true" ]]; then
    xset +dpms
    xset dpms "${DPMS_TIMEOUT}" "${DPMS_TIMEOUT}" "${DPMS_TIMEOUT}"
    xset s "${DPMS_TIMEOUT}"
    echo "Display sleep configured for ${DPMS_TIMEOUT}s of inactivity."
else
    xset s off       # Turn off screen saver
    xset -dpms       # Disable DPMS power saving
    xset s noblank   # Do not blank the video device
fi

# 3. Mouse Cursor Management
# 'never': keep mouse cursor visible at all times (default)
# 'auto': hide after 2 seconds of inactivity (unhide on mouse movement)
# 'always': hide permanently (recommended for pure touchscreens)
if [[ "${HIDE_CURSOR}" == "always" ]]; then
    if command -v unclutter >/dev/null 2>&1; then
        unclutter --timeout 0 --fork 2>/dev/null || unclutter -idle 0 -root &
    fi
elif [[ "${HIDE_CURSOR}" == "auto" ]]; then
    if command -v unclutter >/dev/null 2>&1; then
        unclutter --timeout 2 --fork 2>/dev/null || unclutter -idle 2 -root &
    fi
fi

# 4. Start Stripped Window Manager (Openbox)
OPENBOX_CONFIG="/etc/gb50-kiosk/openbox-rc.xml"
if [[ ! -f "${OPENBOX_CONFIG}" && -f /opt/gb50-proxy/systemd/openbox-kiosk.xml ]]; then
    OPENBOX_CONFIG="/opt/gb50-proxy/systemd/openbox-kiosk.xml"
fi

if command -v openbox >/dev/null 2>&1; then
    if [[ -f "${OPENBOX_CONFIG}" ]]; then
        openbox --config-file "${OPENBOX_CONFIG}" &
    else
        openbox &
    fi
fi

# 5. Wait for GB-50 Web Proxy Backend to become responsive
echo "Waiting for GB-50 web proxy backend at ${KIOSK_URL}..."
MAX_WAIT=60
WAIT_COUNT=0
HEALTH_URL="${KIOSK_URL%/}health"
until curl -s -f "${HEALTH_URL}" >/dev/null 2>&1 || curl -s -f "${KIOSK_URL}" >/dev/null 2>&1; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [[ ${WAIT_COUNT} -ge ${MAX_WAIT} ]]; then
        echo "Warning: GB-50 backend did not respond within ${MAX_WAIT}s. Proceeding with browser launch."
        break
    fi
done

# 6. Persistent Browser Profile & Crash State Auto-Recovery
PROFILE_DIR="${HOME:-/home/kiosk}/.config/chromium-kiosk"
mkdir -p "${PROFILE_DIR}/Default"

# Supervised Browser Restart Loop
while true; do
    # Self-heal Chromium preferences so "Restore pages? Chromium didn't shut down correctly" never appears
    PREFS="${PROFILE_DIR}/Default/Preferences"
    if [[ -f "${PREFS}" ]]; then
        sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "${PREFS}" 2>/dev/null || true
        sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "${PREFS}" 2>/dev/null || true
    fi
    # Clear stale lock files from abrupt power loss or reboot
    rm -rf "${PROFILE_DIR}/Singleton"* 2>/dev/null || true

    # Locate installed browser
    if command -v chromium >/dev/null 2>&1; then
        BROWSER_BIN="chromium"
    elif command -v chromium-browser >/dev/null 2>&1; then
        BROWSER_BIN="chromium-browser"
    elif command -v firefox-esr >/dev/null 2>&1; then
        BROWSER_BIN="firefox-esr"
    else
        echo "Error: Neither Chromium nor Firefox ESR is installed on this system!"
        sleep 5
        continue
    fi

    if [[ "${BROWSER_BIN}" == *"chromium"* ]]; then
        "${BROWSER_BIN}" \
            --kiosk \
            --app="${KIOSK_URL}" \
            --user-data-dir="${PROFILE_DIR}" \
            --noerrdialogs \
            --disable-infobars \
            --no-first-run \
            --fast \
            --fast-start \
            --disable-pinch \
            --overscroll-history-navigation=0 \
            --disable-features=TranslateUI,TouchpadOverscrollHistoryNavigation \
            --disable-session-crashed-bubble \
            --check-for-update-interval=31536000 \
            --simulate-outdated-no-au='Tue, 31 Dec 2099 23:59:59 GMT' \
            --password-store=basic \
            --touch-events=enabled \
            --pull-to-refresh=0 \
            --autoplay-policy=no-user-gesture-required \
            "${KIOSK_URL}"
    else
        # Firefox ESR Kiosk fallback
        "${BROWSER_BIN}" --kiosk "${KIOSK_URL}"
    fi

    echo "Browser process exited. Relaunching in 2 seconds..."
    sleep 2
done
