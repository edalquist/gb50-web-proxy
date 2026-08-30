#!/usr/bin/env python3
"""Convenience launcher for the Mitsubishi GB-50 REST Proxy & Web UI server."""

import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from server.main import main

if __name__ == "__main__":
    main()
