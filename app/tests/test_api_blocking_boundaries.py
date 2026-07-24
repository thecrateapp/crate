import ast
import asyncio
import inspect
import threading
from pathlib import Path

from starlette.requests import Request

from crate.api.auth import AuthMiddleware


ROOT = Path(__file__).resolve().parents[2]


def _decorator_name(node: ast.expr) -> str:
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return f"{node.value.id}.{node.attr}"
    return ""


def test_auth_http_routes_with_sync_dependencies_run_in_threadpool():
    source = (ROOT / "app/crate/api/auth.py").read_text()
    tree = ast.parse(source)
    blocking_async_routes = []

    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        decorators = {_decorator_name(item) for item in node.decorator_list}
        if any(name.startswith(("router.", "admin_router.")) for name in decorators):
            blocking_async_routes.append(node.name)

    assert blocking_async_routes == []


def test_auth_middleware_resolves_database_identity_off_event_loop(monkeypatch):
    middleware = AuthMiddleware(lambda _scope, _receive, _send: None)
    event_loop_thread = threading.get_ident()
    lookup_threads: list[int] = []

    def resolve_token(_token: str) -> dict:
        lookup_threads.append(threading.get_ident())
        return {"id": 1, "email": "user@example.test", "role": "user"}

    monkeypatch.setattr(middleware, "_resolve_token_user", resolve_token)
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/me",
            "headers": [(b"authorization", b"Bearer token")],
            "query_string": b"",
            "client": ("127.0.0.1", 1234),
            "scheme": "http",
            "server": ("test", 80),
        }
    )

    user = asyncio.run(middleware.resolve_user(request))

    assert user and user["id"] == 1
    assert lookup_threads
    assert lookup_threads[0] != event_loop_thread
    assert inspect.iscoroutinefunction(middleware.resolve_user)
