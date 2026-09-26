"""Mitsubishi GB-50 REST API & WebSocket Proxy Server Package."""

import os
import sys

_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _candidate in (
    os.path.join(_PACKAGE_ROOT, "python-gb50"),
    os.path.join(os.path.dirname(_PACKAGE_ROOT), "python-gb50"),
):
    if os.path.isdir(_candidate) and _candidate not in sys.path:
        sys.path.insert(0, _candidate)

from .app import create_app

__all__ = ["create_app"]

