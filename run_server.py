#!/usr/bin/env python3
"""Convenience launcher for the Mitsubishi GB-50 REST Proxy & Web UI server."""

import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Ensure local python-gb50 library is importable if present
for candidate in (
    os.path.join(PROJECT_ROOT, "python-gb50"),
    os.path.join(os.path.dirname(PROJECT_ROOT), "python-gb50"),
):
    if os.path.isdir(candidate) and candidate not in sys.path:
        sys.path.insert(0, candidate)

from server.main import main

if __name__ == "__main__":
    main()
