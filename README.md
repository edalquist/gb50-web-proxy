# Mitsubishi GB-50 REST Proxy & Modern Web UI (`gb50-web-proxy`)

[![Python 3.9+](https://img.shields.io/badge/python-3.9+-blue.svg)](https://www.python.org/downloads/)
[![React 18](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-teal.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, responsive Web Application and REST / WebSocket API Proxy for **Mitsubishi Electric GB-50**, **AG-150**, and **G-50** Central HVAC Controllers.

---

## Highlights

- **Modern Web Dashboard**: Replaces obsolete Windows 7 / Internet Explorer Java applets with a fast, touch-friendly UI for desktop, tablet, and mobile.
- **Master Church 24-Hour Timeline Matrix**: Visual overview of all church units across 24 hours with quick floor filters and event chips.
- **Weekly 7-Day Schedule Studio**: Interactive schedule creator and multi-zone floor batch programmer.
- **Dedicated Ventilation Studio**: Complete LOSSNAY Fresh Air heat recovery ventilation management with fan stage bypass controls.
- **City Multi Diagnostic Knowledge Base**: Full 4-digit error code diagnostics with start/recovery timestamps, downtime durations, and technician troubleshooting guides.
- **100% Administrative Coverage**: Interlocks, hardware topology, M-Net mapping, clock/DST sync, Night Setback, software license activation, and password management.
- **Real-Time WebSocket Streaming**: Instant sub-second UI updates upon temperature changes or remote control presses.

---

## Quickstart

### 1. Install Dependencies

Install the core Python library and server requirements:
```bash
pip install -e ../python-gb50
pip install -e .
```

### 2. Build the Web Dashboard

```bash
cd web
npm install
npm run build
cd ..
```

### 3. Launch the Server

```bash
python run_server.py --port 8080 --controller-host 192.0.2.90
```

Open [`http://localhost:8080/`](http://localhost:8080/) in your browser. Interactive OpenAPI documentation is available at [`http://localhost:8080/docs`](http://localhost:8080/docs).

---

## CLI Options

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--port` | `8080` | HTTP port for the web server and REST proxy. |
| `--host` | `0.0.0.0` | Bind network interface address. |
| `--controller-host` | `192.0.2.90` | IP address of the Mitsubishi GB-50 controller. |
| `--controller-port` | `80` | HTTP port of the GB-50 controller. |
| `--poll-interval` | `3.0` | Telemetry polling rate in seconds. |

---

## REST API Overview

- `GET /api/v1/system`: Controller hardware metadata and ROM version.
- `GET /api/v1/groups`: Real-time status for all HVAC zones.
- `PUT /api/v1/groups/{group_id}`: Control single zone (drive, mode, setpoint, fan, vane).
- `POST /api/v1/groups/batch`: Control multiple zones simultaneously.
- `GET /api/v1/schedules`: Batch fetch today's timer programs.
- `GET /api/v1/schedules/{group_id}/weekly`: Fetch 7-day weekly schedule patterns.
- `PUT /api/v1/schedules/weekly`: Save weekly schedule patterns.
- `GET /api/v1/alarms`: Active unit errors and malfunction history with City Multi diagnostics.
- `DELETE /api/v1/alarms`: Clear historical error log on controller.
- `GET /api/v1/interlocks`: LOSSNAY ventilation interlock pairings.
- `GET /api/v1/clock` & `POST /api/v1/clock/sync`: Real-time clock synchronization.
- `GET /api/v1/setback` & `PUT /api/v1/setback`: Night Setback boundary automation.
- `WS /api/v1/ws`: Live WebSocket telemetry feed.

---

## Development

Run frontend with hot module reloading:
```bash
cd web
npm run dev
```

Run test suites:
```bash
pytest tests/ -v
node web/e2e_verify.mjs
```

---

## License

MIT License.
