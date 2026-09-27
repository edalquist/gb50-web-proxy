"""Command-line entrypoint for the Mitsubishi GB-50 REST Proxy server."""

import os
import sys
import argparse
from typing import List, Optional

# Ensure project directory is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Ensure local python-gb50 library is importable if present
for candidate in (
    os.path.join(PROJECT_ROOT, "python-gb50"),
    os.path.join(os.path.dirname(PROJECT_ROOT), "python-gb50"),
):
    if os.path.isdir(candidate) and candidate not in sys.path:
        sys.path.insert(0, candidate)

import uvicorn
from server.app import create_app


def _parse_env_port(env_name: str, default: int, parser: argparse.ArgumentParser) -> int:
    val = os.environ.get(env_name)
    if val is None or val == "":
        return default
    try:
        port = int(val)
    except ValueError:
        parser.error(f"invalid integer value for environment variable {env_name}: {val!r}")
    if not (1 <= port <= 65535):
        parser.error(f"environment variable {env_name} must be between 1 and 65535, got {port}")
    return port


def _parse_env_float(env_name: str, default: float, parser: argparse.ArgumentParser) -> float:
    val = os.environ.get(env_name)
    if val is None or val == "":
        return default
    try:
        fval = float(val)
    except ValueError:
        parser.error(f"invalid float value for environment variable {env_name}: {val!r}")
    if fval <= 0:
        parser.error(f"environment variable {env_name} must be positive, got {fval}")
    return fval


def parse_args(args: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mitsubishi GB-50 HVAC REST & WebSocket Proxy Server")

    server_port_default = _parse_env_port("SERVER_PORT", 8080, parser)
    controller_port_default = _parse_env_port("GB50_PORT", 80, parser)
    poll_interval_default = _parse_env_float("GB50_POLL_INTERVAL", 3.0, parser)

    parser.add_argument(
        "--host",
        default=os.environ.get("SERVER_HOST", "0.0.0.0"),
        help="Proxy server bind address (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=server_port_default,
        help="Proxy server HTTP port (default: 8080)",
    )
    parser.add_argument(
        "--controller-host",
        default=os.environ.get("GB50_HOST"),
        help="Target controller IP address or hostname (required unless GB50_HOST is set)",
    )
    parser.add_argument(
        "--controller-port",
        type=int,
        default=controller_port_default,
        help="Target GB-50 controller HTTP port (default: 80)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=poll_interval_default,
        help="Background controller polling interval in seconds (default: 3.0)",
    )
    parsed = parser.parse_args(args)
    parsed.controller_host = (parsed.controller_host or "").strip()
    if not parsed.controller_host:
        parser.error("set --controller-host or GB50_HOST to your controller address")

    if not (1 <= parsed.port <= 65535):
        parser.error(f"argument --port: Port must be between 1 and 65535, got {parsed.port}")
    if not (1 <= parsed.controller_port <= 65535):
        parser.error(f"argument --controller-port: Port must be between 1 and 65535, got {parsed.controller_port}")
    if parsed.poll_interval <= 0:
        parser.error(f"argument --poll-interval: Poll interval must be positive, got {parsed.poll_interval}")

    return parsed


def main() -> None:
    args = parse_args()
    app = create_app(
        controller_host=args.controller_host,
        controller_port=args.controller_port,
        poll_interval=args.poll_interval,
    )
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
