# Debian Deployment Guide: Mitsubishi GB-50 REST Proxy, Remote LAN Access & Locked-Down Kiosk UI

This guide covers deploying the Mitsubishi GB-50 API proxy and modern web dashboard as a resilient, self-healing systemd service on **Debian 13 (Trixie)** or **Debian 12 (Bookworm)** (such as a **Dell Wyse 5070**, Intel NUC, or mini PC).

It details two complementary access models running concurrently:
1. **Remote Network Access**: Allowing facility staff, pastors, and volunteers to securely monitor and manage HVAC systems across the church local network (LAN / Wi-Fi) from phones, tablets, laptops, and desktop PCs.
2. **Locked-Down Local Kiosk Mode UI**: Booting the physical PC directly into a full-screen, tamper-resistant web application on a local wall-mounted monitor or touchscreen without any desktop environment, window decorations, or OS escape shortcuts.

---

## 1. Hardware & BIOS Setup (Dell Wyse 5070 / Thin Client)

The Dell Wyse 5070 is an ideal 24/7 HVAC appliance (fanless, quad-core x86_64, 5–7W power consumption).

Before OS installation, enter the BIOS by tapping **F2** on power-on:

1. **AC Power Recovery**
   * Navigate to: `Power Management` → `AC Recovery`
   * Set to: **`Power On`**
   * *Purpose: Automatically powers the server and kiosk display back on immediately following a church power outage or electrical breaker trip.*
2. **Auto-On Time / Power Saving**
   * Ensure sleep, suspend, or Deep Sleep power saving states are **disabled** so the network interface never drops offline.
3. **Storage Configuration**
   * If booting from the internal 16/32 GB eMMC, verify it is recognized under UEFI boot targets. If an M.2 SATA/NVMe SSD was installed, ensure it is set as primary.

---

## 2. Fast Automated Installation

The automated installation scripts configure both the background proxy daemon and the optional locked-down kiosk display.

### Option A: Complete Install (Proxy Service + Locked-Down Kiosk UI)

Clone `gb50-web-proxy` and run the unified installer with `--with-kiosk`:

```bash
git clone https://github.com/edalquist/gb50-web-proxy.git
cd gb50-web-proxy
sudo ./scripts/install.sh --server-port 80 --with-kiosk
```
*(Note: If `python-gb50` is not found locally, `install.sh` will automatically clone it from GitHub into `/opt/gb50-proxy/python-gb50`).*

### Option B: Headless Proxy Service Only

If the machine will only be accessed over the network without a physical display:

```bash
sudo ./scripts/install.sh
```

*(You can easily add the kiosk display later at any time by running `sudo ./scripts/install-kiosk.sh`)*

### Common Installer Command-Line Flags:

```bash
sudo ./scripts/install.sh \
  --controller-host 192.0.2.90 \
  --server-port 8080 \
  --with-kiosk \
  --kiosk-auto-login viewer \
  --hide-cursor auto \
  --non-interactive
```

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--target-dir DIR` | `/opt/gb50-proxy` | Deployment target directory |
| `--controller-host IP` | `192.0.2.90` | Mitsubishi GB-50 controller IP address |
| `--controller-port PORT` | `80` | Controller HTTP port |
| `--server-port PORT` | `8080` | Port for the proxy server & web UI |
| `--poll-interval SECS` | `3.0` | Telemetry polling cadence in seconds |
| `--with-kiosk` | `false` | Installs and configures X11, Openbox, and Chromium kiosk |
| `--kiosk-auto-login ROLE`| `viewer` | Kiosk role (`viewer`, `operator`, `admin`, or `disabled`) |
| `--hide-cursor MODE` | `auto` | Mouse cursor hiding: `auto` (idle), `always` (touch), `never` |
| `--non-interactive` | `false` | Skips interactive confirmation prompts |

---

## 3. Remote Network Access Configuration

To allow church staff and volunteers to access the system from anywhere on the church network:

### A. Serving on Standard HTTP Port 80 (Recommended - No Port Number Needed)

To allow staff and volunteers to access the dashboard by simply typing `http://hvac-demo.local/` or `http://<server-ip>/` **without needing to remember or append a port number**:

1. In `/etc/default/gb50-proxy`, set `SERVER_PORT=80`:
   ```ini
   SERVER_HOST=0.0.0.0
   SERVER_PORT=80
   ```
   *(Or during initial setup: `sudo ./scripts/install.sh --server-port 80 --with-kiosk`)*

2. **Security & Capabilities**:
   Linux normally restricts binding to ports below 1024 to root. The systemd service unit (`gb50-proxy.service`) is pre-configured with:
   ```ini
   CapabilityBoundingSet=CAP_NET_BIND_SERVICE
   AmbientCapabilities=CAP_NET_BIND_SERVICE
   ```
   This securely grants the unprivileged `gb50` system user permission to bind directly to port 80 while maintaining strict OS sandboxing (`ProtectSystem=strict`, `NoNewPrivileges=true`).

3. **Check for Port Conflicts**:
   Ensure no default web server (such as Apache or Lighttpd) is occupying port 80:
   ```bash
   sudo ss -tulpn | grep ':80 '
   ```
   If Apache is running, disable it: `sudo systemctl disable --now apache2`.

### B. Firewall (UFW)
Allow HTTP traffic on the configured port (and SSH for remote administration):

```bash
# Allow web access on standard HTTP port 80 (or 8080 if using 8080)
sudo ufw allow 80/tcp

# Allow remote administrative SSH access
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable
```

### C. Zero-Configuration Local Domain (mDNS / Avahi)
Install Avahi so staff do not need to memorize or look up the server's numeric IP address:

```bash
sudo apt update && sudo apt install -y avahi-daemon
sudo hostnamectl set-hostname church-ac
sudo systemctl enable --now avahi-daemon
```

Staff and volunteers on the church Wi-Fi or office network can now simply navigate to:
```text
http://hvac-demo.local:8080/
```
*(Also accessible directly via `http://<server-ip>:8080/`)*

### D. User Roles & Remote Security
Remote connections always require credentials. The proxy supports three role tiers:

* **Administrator (`admin`)**: Full control over zone configuration, weekly and seasonal schedules, user management, and system diagnosis.
* **Facilities Operator (`operator`)**: Can adjust setpoints, change modes (Cool/Heat/Fan/Auto), adjust fan speeds, and trigger manual hold overrides.
* **Viewer (`viewer`)**: Read-only monitoring dashboard showing zone statuses, alarms, and temperatures. Cannot alter setpoints or run commands.

User accounts can be managed via the web UI under **Admin Panel** → **User Management**, or from the command line:

```bash
# List all registered users
sudo /opt/gb50-proxy/.venv/bin/python -m server.auth list

# Add a staff operator
sudo /opt/gb50-proxy/.venv/bin/python -m server.auth add-user bob SecretPass123 operator "Bob (Facilities)"

# Reset an administrator password
sudo /opt/gb50-proxy/.venv/bin/python -m server.auth reset-password admin NewSecurePassword!
```

---

## 4. Locked-Down Kiosk Mode UI

When the PC boots, it launches the physical display directly into a locked-down, tamper-resistant Chromium session locked to the web application.

### Architecture Overview

```
Debian 13 Systemd
  ├── gb50-proxy.service (Backend Python REST API & Static React Web UI)
  └── gb50-kiosk.service (Dedicated Display Manager & Chromium Runner)
        └── xinit on VT7 (Unprivileged 'kiosk' user)
              ├── Openbox (Window Manager stripped of all user keystrokes & menus)
              ├── unclutter (Mouse cursor idle auto-hider)
              └── Chromium (--kiosk locked fullscreen browser in supervised loop)
```

### Key Lockdown & Resilience Features:

1. **Tamper-Resistant Window Management (`openbox-rc.xml`)**:
   * All window borders, titlebars, and controls are stripped.
   * Keystroke bindings for window switching (`Alt+Tab`), closing (`Alt+F4`), minimizing (`Win+D`), and desktop switching are removed.
   * Right-click root context menus on the desktop are disabled.

2. **Hardware Console Lockout (`10-kiosk-lockdown.conf`)**:
   * Linux virtual console switching (`Ctrl+Alt+F1` through `F7`) is completely disabled in Xorg so users cannot drop into a Linux terminal prompt.
   * X server kill key (`Ctrl+Alt+Backspace`) is disabled.

3. **Supervised Self-Healing Browser Loop (`kiosk-session.sh`)**:
   * Before launching, the session checks that `gb50-proxy.service` is healthy on `http://localhost:8080/` so the screen never displays an initial "Connection Refused" error page.
   * Chromium crash preferences (`"exited_cleanly": false`, `"exit_type": "Crashed"`) and stale singleton locks are automatically cleaned up on every boot. This prevents the yellow "Restore pages? Chromium didn't shut down correctly" banner from ever appearing after a power outage.
   * If Chromium is closed or killed, the supervised loop restarts it in 2 seconds.

4. **Kiosk Auto-Login vs Manual Authentication**:
   * **Auto-Login (Recommended for Hallway / Narthex Displays)**:
     Set `GB50_KIOSK_AUTO_LOGIN=viewer` (or `operator`) in `/etc/default/gb50-proxy`.
     When the local screen loads `http://localhost:8080/`, it detects localhost loopback (`127.0.0.1`) and automatically enters the dashboard under the assigned role without prompting for credentials.
     *Remote network connections are strictly forbidden from auto-logging in and must always authenticate.*
   * **Manual Login (For Office Workstations)**:
     Set `GB50_KIOSK_AUTO_LOGIN=disabled`. The local screen displays the clean login page. Because Chromium uses a persistent user profile (`/home/kiosk/.config/chromium-kiosk`), once a staff member logs in, their session persists across reboots.

5. **Mouse Cursor & Screen Blanking**:
   * **Cursor Hiding**: `unclutter` hides the cursor after 2 seconds of inactivity (`GB50_KIOSK_HIDE_CURSOR=auto`). For pure touchscreens, set `GB50_KIOSK_HIDE_CURSOR=always` to hide the pointer entirely.
   * **Screen Sleep / DPMS**: By default, screen blanking is disabled (`GB50_KIOSK_DPMS=false`) so the HVAC status is always visible. If you prefer the display to sleep after 15 minutes of inactivity to conserve power, set `GB50_KIOSK_DPMS=true` in `/etc/default/gb50-proxy`. Any tap on the touchscreen instantly wakes the display.

---

## 5. Configuration Reference (`/etc/default/gb50-proxy`)

All system settings are maintained in a single configuration file at `/etc/default/gb50-proxy`:

```ini
# ==============================================================================
# Mitsubishi GB-50 HVAC Controller & Web Dashboard Configuration
# ==============================================================================

# --- Mitsubishi Hardware Connection ---
GB50_HOST=192.0.2.90
GB50_PORT=80
GB50_POLL_INTERVAL=3.0

# --- Web Server Network Bindings ---
SERVER_HOST=0.0.0.0
SERVER_PORT=8080

# --- Persistent State & Security ---
GB50_DB_PATH=/var/lib/gb50/gb50_users.db
GB50_JWT_SECRET=your_secure_random_key_here
GB50_JWT_EXPIRATION_HOURS=720  # 30 days session lifespan

# --- Kiosk Mode Display Settings ---
# Auto-login role for local monitor: "viewer", "operator", "admin", or "disabled"
GB50_KIOSK_AUTO_LOGIN=viewer

# Mouse cursor behavior: "auto" (hide on idle), "always" (touchscreen), "never"
GB50_KIOSK_HIDE_CURSOR=auto

# Display power saving: "false" (always on), "true" (sleep after timeout)
GB50_KIOSK_DPMS=false
GB50_KIOSK_DPMS_TIMEOUT=900  # 15 minutes in seconds
```

After modifying `/etc/default/gb50-proxy`, reload both services:

```bash
sudo systemctl restart gb50-proxy gb50-kiosk
```

---

## 6. Service Management Operations

| Task | Command |
| :--- | :--- |
| **Check proxy service status** | `sudo systemctl status gb50-proxy` |
| **Check kiosk display status** | `sudo systemctl status gb50-kiosk` |
| **Stream live application logs** | `sudo journalctl -u gb50-proxy -f` |
| **Stream live kiosk display logs**| `sudo journalctl -u gb50-kiosk -f` |
| **Restart proxy service** | `sudo systemctl restart gb50-proxy` |
| **Restart kiosk display** | `sudo systemctl restart gb50-kiosk` |
| **Stop kiosk display (maintenance)** | `sudo systemctl stop gb50-kiosk` |
| **Update entire application** | `sudo ./scripts/update.sh` |
| **Uninstall all services** | `sudo ./scripts/uninstall.sh` |

---

## 7. Touchscreen Tips & Screen Orientation

### Display Rotation (Portrait Orientation)
If your kiosk monitor is mounted vertically in portrait mode, add the orientation command to the start of `/opt/gb50-proxy/scripts/kiosk-session.sh`:

```bash
# Rotate display 90 degrees right (portrait)
xrandr -o right
```
*(Options: `left`, `right`, `inverted`, `normal`)*

### Touchscreen Calibration
Modern touchscreens (Elo, Dell, Planar, ViewSonic) are natively supported plug-and-play by the Linux kernel via `evdev` and `libinput`. If touch mapping requires calibration:

```bash
sudo apt install -y xinput-calibrator
xinput_calibrator
```
Copy the resulting calibration snippet into `/etc/X11/xorg.conf.d/99-touchscreen.conf`.

---

## 8. Unattended Stability & OS Maintenance

To ensure the Debian appliance stays secure without administrative maintenance:

```bash
sudo apt update && sudo apt install -y unattended-upgrades needrestart
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

To configure automatic off-hours reboots (only when a Linux kernel security update requires it), edit `/etc/apt/apt.conf.d/50unattended-upgrades`:

```ini
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
```

In `/etc/apt/sources.list`, verify your repositories pin to the release codename (e.g. `trixie` or `bookworm`) rather than `stable` to prevent unexpected major OS upgrades.
