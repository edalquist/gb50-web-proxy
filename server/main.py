"""Command-line entrypoint for the Mitsubishi GB-50 REST Proxy server."""

import os
import sys
import argparse

# Ensure project directory is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import uvicorn
from server.app import create_app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mitsubishi GB-50 HVAC REST & WebSocket Proxy Server")
    parser.add_argument(
        "--host",
        default=os.environ.get("SERVER_HOST", "0.0.0.0"),
        help="Proxy server bind address (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("SERVER_PORT", "8080")),
        help="Proxy server HTTP port (default: 8080)",
    )
    parser.add_argument(
        "--controller-host",
        default=os.environ.get("GB50_HOST", "192.0.2.90"),
        help="Target GB-50 controller IP address (default: 192.0.2.90)",
    )
    parser.add_argument(
        "--controller-port",
        type=int,
        default=int(os.environ.get("GB50_PORT", "80")),
        help="Target GB-50 controller HTTP port (default: 80)",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=float(os.environ.get("GB50_POLL_INTERVAL", "3.0")),
        help="Background controller polling interval in seconds (default: 3.0)",
    )
    return parser.parse_args()


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
