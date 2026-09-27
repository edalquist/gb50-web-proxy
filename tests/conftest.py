"""Keep test accounts and schedules out of an installation's persistent database."""
import os
import secrets
import tempfile
from pathlib import Path

# Configure before test modules import server.auth and instantiate its repository.
_test_state = tempfile.TemporaryDirectory(prefix="gb50-test-state-")
_previous = {key: value for key, value in os.environ.items() if key.startswith("GB50_")}
for _key in _previous:
    del os.environ[_key]
os.environ.update(
    GB50_DB_PATH=str(Path(_test_state.name) / "test.db"),
    GB50_ADMIN_PASSWORD="admin",  # Synthetic account used by the API tests only.
    GB50_JWT_SECRET=secrets.token_urlsafe(32),
    GB50_HOST="192.0.2.90",
)


def pytest_unconfigure(config):
    _test_state.cleanup()
    for key in list(os.environ):
        if key.startswith("GB50_"):
            del os.environ[key]
    os.environ.update(_previous)
