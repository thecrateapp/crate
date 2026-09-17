from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from unittest.mock import patch
from xml.etree import ElementTree

from crate.api.subsonic import create_subsonic_router
from crate.subsonic.serializers import serialize_user


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(create_subsonic_router("v1"))
    return TestClient(app)


def _auth(user: dict | None = None):
    return patch(
        "crate.subsonic.auth.authenticate",
        return_value=user
        or {
            "id": 1,
            "username": "admin",
            "email": "admin@example.test",
            "role": "admin",
            "status": "active",
        },
    )


def _params(**extra: str) -> dict[str, str]:
    return {
        "u": "admin",
        "p": "secret",
        "v": "1.16.1",
        "c": "system-operations-tests",
        "f": "json",
        **extra,
    }


def _response(client: TestClient, path: str, **params: str) -> dict:
    return client.get(path, params=_params(**params)).json()["subsonic-response"]


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_user_admin_role_matches_scan_authorization(role: str) -> None:
    user = serialize_user(
        {"username": "test", "email": "test@example.test", "role": role}
    )

    assert user["adminRole"] is True


def test_user_does_not_advertise_unimplemented_operations() -> None:
    user = serialize_user(
        {"username": "test", "email": "test@example.test", "role": "user"}
    )

    assert user["uploadRole"] is False
    assert user["commentRole"] is False
    assert user["podcastRole"] is False
    assert user["jukeboxRole"] is False
    assert user["shareRole"] is False


def test_get_avatar_returns_image_bytes_for_requested_username(
    client: TestClient,
) -> None:
    user = {
        "id": 7,
        "username": "listener",
        "avatar": "https://lh3.googleusercontent.com/avatar",
    }
    with (
        _auth(),
        patch("crate.api.subsonic.system.get_user_by_username", return_value=user),
        patch(
            "crate.api.subsonic.system.fetch_avatar",
            return_value=(b"avatar-bytes", "image/jpeg"),
        ) as fetch_avatar,
    ):
        response = client.get("/rest/getAvatar", params=_params(username="listener"))

    assert response.status_code == 200
    assert response.content == b"avatar-bytes"
    assert response.headers["content-type"].startswith("image/jpeg")
    fetch_avatar.assert_called_once_with(user["avatar"])


def test_get_avatar_returns_protocol_not_found_when_user_has_no_avatar(
    client: TestClient,
) -> None:
    user = {"id": 7, "username": "listener", "avatar": None}
    with (
        _auth(),
        patch("crate.api.subsonic.system.get_user_by_username", return_value=user),
        patch("crate.api.subsonic.system.fetch_avatar") as fetch_avatar,
    ):
        response = client.get("/rest/getAvatar", params=_params(username="listener"))

    root = ElementTree.fromstring(response.content)
    error = root.find("{http://subsonic.org/restapi}error")
    assert response.headers["content-type"].startswith("text/xml")
    assert error is not None
    assert error.attrib["code"] == "70"
    fetch_avatar.assert_not_called()


def test_get_scan_status_reports_idle_and_active_progress(client: TestClient) -> None:
    with (
        _auth(),
        patch("crate.subsonic.services.system_operations.list_tasks", return_value=[]),
    ):
        idle = _response(client, "/rest/getScanStatus")
    assert idle["scanStatus"] == {"scanning": False, "count": 0}

    with (
        _auth(),
        patch(
            "crate.subsonic.services.system_operations.list_tasks",
            return_value=[
                {"status": "running", "progress": '{"done": 12, "total": 40}'}
            ],
        ),
    ):
        active = _response(client, "/rest/getScanStatus")
    assert active["scanStatus"] == {"scanning": True, "count": 12}


def test_get_scan_status_reports_failed_scan_as_not_scanning_with_partial_count(
    client: TestClient,
) -> None:
    with (
        _auth(),
        patch(
            "crate.subsonic.services.system_operations.list_tasks",
            return_value=[{"status": "failed", "progress": '{"done": 9, "total": 40}'}],
        ),
    ):
        envelope = _response(client, "/rest/getScanStatus")

    assert envelope["scanStatus"] == {"scanning": False, "count": 9}


def test_start_scan_rejects_non_admin_without_creating_task(client: TestClient) -> None:
    with (
        _auth({"id": 2, "username": "listener", "role": "user", "status": "active"}),
        patch("crate.subsonic.services.system_operations.create_task") as create_task,
    ):
        envelope = _response(client, "/rest/startScan")

    assert envelope["status"] == "failed"
    assert envelope["error"]["code"] == 50
    create_task.assert_not_called()


def test_start_scan_dispatches_existing_scan_worker_task(client: TestClient) -> None:
    with (
        _auth({"id": 1, "username": "admin", "role": "owner", "status": "active"}),
        patch("crate.subsonic.services.system_operations.list_tasks", return_value=[]),
        patch(
            "crate.subsonic.services.system_operations.create_task",
            return_value="task-123",
        ) as create_task,
    ):
        envelope = _response(client, "/rest/startScan")

    assert envelope["scanStatus"] == {"scanning": True, "count": 0}
    create_task.assert_called_once_with("scan", {})


def test_start_scan_does_not_enqueue_duplicate_pending_scan(client: TestClient) -> None:
    with (
        _auth(),
        patch(
            "crate.subsonic.services.system_operations.list_tasks",
            return_value=[{"status": "pending", "progress": '{"done": 2}'}],
        ),
        patch("crate.subsonic.services.system_operations.create_task") as create_task,
    ):
        envelope = _response(client, "/rest/startScan")

    assert envelope["scanStatus"] == {"scanning": True, "count": 2}
    create_task.assert_not_called()


def test_get_avatar_requires_username_and_returns_xml_protocol_error(
    client: TestClient,
) -> None:
    with _auth():
        response = client.get("/rest/getAvatar", params=_params())

    root = ElementTree.fromstring(response.content)
    error = root.find("{http://subsonic.org/restapi}error")
    assert response.headers["content-type"].startswith("text/xml")
    assert error is not None
    assert error.attrib["code"] == "10"


def test_new_system_operations_are_only_routed_by_v1() -> None:
    legacy_paths = {route.path for route in create_subsonic_router("legacy").routes}
    v1_paths = {route.path for route in create_subsonic_router("v1").routes}

    assert "/rest/getAvatar" not in legacy_paths
    assert "/rest/getScanStatus" not in legacy_paths
    assert "/rest/startScan" not in legacy_paths
    assert {"/rest/getAvatar", "/rest/getScanStatus", "/rest/startScan"} <= v1_paths


def test_avatar_proxy_rejects_untrusted_redirect() -> None:
    from crate.user_avatars import AvatarUnavailable, fetch_avatar

    redirect = type(
        "Redirect",
        (),
        {
            "status_code": 302,
            "headers": {"location": "https://attacker.test/x"},
            "close": lambda _self: None,
        },
    )()
    with patch("crate.user_avatars.requests.get", return_value=redirect) as get:
        with pytest.raises(AvatarUnavailable):
            fetch_avatar("https://lh3.googleusercontent.com/avatar")

    get.assert_called_once()


def test_avatar_proxy_bounds_download_before_buffering_image() -> None:
    from crate.user_avatars import AvatarProxyError, fetch_avatar

    class StreamingResponse:
        status_code = 200
        headers = {"content-type": "image/jpeg"}

        def __init__(self) -> None:
            self.closed = False

        @property
        def content(self) -> bytes:
            raise AssertionError("avatar body must be consumed incrementally")

        def iter_content(self, chunk_size: int):
            assert chunk_size == 64 * 1024
            yield b"x" * 1_500_000
            yield b"y" * 1_500_000

        def close(self) -> None:
            self.closed = True

    response = StreamingResponse()
    with patch("crate.user_avatars.requests.get", return_value=response):
        with pytest.raises(AvatarProxyError):
            fetch_avatar("https://lh3.googleusercontent.com/avatar")

    assert response.closed is True
