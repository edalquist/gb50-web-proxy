"""Missing configuration must fail before contacting a controller."""
from unittest.mock import patch

import pytest

from server.app import create_app
from server.main import parse_args


@pytest.mark.parametrize("value", [None, "", "   "])
def test_missing_controller_host_is_rejected(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("GB50_HOST", raising=False)
    else:
        monkeypatch.setenv("GB50_HOST", value)
    with patch("server.app.GB50Client") as client:
        with pytest.raises(ValueError, match="controller host"):
            create_app()
        client.assert_not_called()
    with pytest.raises(SystemExit) as exit_info:
        parse_args([])
    assert exit_info.value.code == 2


def test_explicit_host_overrides_environment(monkeypatch):
    monkeypatch.setenv("GB50_HOST", "environment.example")
    assert parse_args([]).controller_host == "environment.example"
    assert parse_args(["--controller-host", " controller.example "]).controller_host == "controller.example"
    with patch("server.app.GB50Client") as client:
        create_app(controller_host="controller.example")
        client.assert_called_once_with(host="controller.example", port=80)
