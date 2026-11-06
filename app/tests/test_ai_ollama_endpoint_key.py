"""A stored key belongs to the Ollama origin it was saved for.

Moving an endpoint needs ai.config.manage; storing a key needs ai.credentials.manage.
A move therefore revokes the stored key in the same transaction, so changing where
requests go can never send an existing key to a different server.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from crate.ai import configuration as service
from crate.credentials import CredentialSecretError, load_secret
from crate.db.repositories import ai_configuration as store
from crate.db.tx import read_scope

ADMIN = 7


@pytest.fixture
def vault(monkeypatch):
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())


def ollama_with_key(endpoint, key="origin-key"):
    conn = service.create_connection(
        {"label": "Local", "provider": "ollama", "endpoint": endpoint}, ADMIN
    )
    return service.set_credential(conn["id"], key, conn["revision"], ADMIN)


def private(conn):
    return store.get_connection(conn["persistent_id"], private=True)


def audit(conn):
    with read_scope() as session:
        return [
            (row.action, row.details_json, row.user_id)
            for row in session.execute(
                text(
                    "SELECT action,details_json,user_id FROM audit_log "
                    "WHERE target_type='ai_configuration' AND target_name=:id ORDER BY id"
                ),
                {"id": conn["persistent_id"]},
            )
        ]


def patch(conn, **changes):
    return service.patch_connection(conn["id"], changes, conn["revision"], ADMIN)


@pytest.mark.parametrize(
    "destination",
    [
        "http://ollama-b.example.test:11434",  # host
        "http://ollama.example.test:11435",  # port
        "https://ollama.example.test:11434",  # scheme
    ],
)
def test_moving_an_ollama_endpoint_drops_its_key(pg_db, vault, destination):
    conn = ollama_with_key("http://ollama.example.test:11434")
    old_ref = private(conn)["secret_ref"]
    logged = audit(conn)

    moved = patch(conn, endpoint=destination)

    assert (moved["endpoint"], moved["has_key"], moved["source"]) == (
        destination,
        False,
        "none",
    )
    row = private(conn)
    assert (row["secret_ref"], row["secret_source"]) == (None, "none")
    with pytest.raises(CredentialSecretError):
        load_secret(old_ref, scope="ai")
    # One audited write, like a key removed on the credential route.
    assert audit(conn) == [
        *logged,
        ("ai.connection.update", {"revision": moved["revision"]}, ADMIN),
    ]
    # A keyless connection moves again without anything to revoke.
    again = patch(moved, endpoint="http://ollama-c.example.test:11434")
    assert (again["has_key"], again["source"]) == (False, "none")


def test_a_failed_move_changes_neither_endpoint_nor_key(pg_db, vault, monkeypatch):
    import crate.credentials

    conn = ollama_with_key("http://ollama.example.test:11434")
    before, logged = private(conn), audit(conn)

    def broken(*args, **kwargs):
        raise RuntimeError("vault unavailable")

    monkeypatch.setattr(crate.credentials, "revoke_secret", broken)
    with pytest.raises(RuntimeError):
        patch(conn, endpoint="http://ollama-b.example.test:11434")

    assert private(conn) == before
    assert audit(conn) == logged
    assert load_secret(before["secret_ref"], scope="ai") == {"api_key": "origin-key"}


@pytest.mark.parametrize(
    "same",
    [
        "http://ollama.example.test:11434",
        "http://ollama.example.test:11434/",
        "HTTP://Ollama.Example.TEST.:11434/",
    ],
)
def test_same_ollama_endpoint_keeps_its_key(pg_db, vault, same):
    conn = ollama_with_key("http://ollama.example.test:11434")
    ref = private(conn)["secret_ref"]

    # Admin's settings form always sends the endpoint along with other fields.
    saved = patch(conn, endpoint=same, label="Renamed")

    assert (saved["endpoint"], saved["label"]) == (
        "http://ollama.example.test:11434",
        "Renamed",
    )
    assert (saved["has_key"], saved["source"]) == (True, "stored")
    assert private(conn)["secret_ref"] == ref
    assert load_secret(ref, scope="ai") == {"api_key": "origin-key"}


class Origin:
    """A local Ollama stand-in that records each request's Authorization header."""

    SHOW = {
        "capabilities": ["completion"],
        "model_info": {
            "general.architecture": "llama",
            "llama.context_length": 131072,
        },
    }
    CHAT = {
        "message": {"content": '{"ok": true}'},
        "prompt_eval_count": 2,
        "eval_count": 1,
    }

    def __init__(self):
        self.seen = []
        origin = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, payload):
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                origin.seen.append((self.path, self.headers.get("Authorization")))
                self.reply({"models": [{"name": "local-model"}]})

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                origin.seen.append((self.path, self.headers.get("Authorization")))
                self.reply(origin.SHOW if self.path == "/api/show" else origin.CHAT)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = Thread(
            target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True
        )
        self.thread.start()

    def take(self):
        seen, self.seen = self.seen, []
        return seen

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


@pytest.fixture
def origins():
    started = [Origin(), Origin()]
    yield started
    for origin in started:
        origin.close()


def test_moved_ollama_endpoint_sends_no_key_until_one_is_set(
    pg_db, vault, origins, monkeypatch
):
    from crate.ai import operations
    from crate.worker_handlers import ai_configuration as worker

    first, second = origins
    monkeypatch.setattr(worker, "get_user_by_id", lambda uid: {"role": "admin"})
    task = {}
    monkeypatch.setattr(worker, "get_task", lambda task_id: task)
    queued = []
    monkeypatch.setattr(
        operations,
        "create_task_dedup",
        lambda kind, params, **kw: queued.append(params) or "job",
    )

    def refresh(conn):
        task.update(type="ai_catalog_refresh", actor_user_id=ADMIN)
        operations.queue_refresh(conn["id"], conn["revision"], ADMIN)
        result = worker.handle_refresh("job", queued.pop(), {})
        assert result == {"status": "succeeded", "model_count": 1}
        return service._public_connection(store.get_connection(conn["id"]))

    def probe(profile_id, run):
        # A real queued test: same worker, reservation, transport and child process.
        task.update(type="ai_profile_test", actor_user_id=None)
        params = {
            "profile_id": profile_id,
            "version": 1,
            "fingerprint": service.resolve_profile(profile_id, 1)["config_fingerprint"],
            "actor_id": None,
            "idempotency_key": run,
        }
        assert worker.handle_probe("job", params, {}) == {
            "status": "succeeded",
            "compatible": True,
        }

    conn = ollama_with_key(first.endpoint, "first-origin-key")
    conn = refresh(conn)
    profile = service.create_profile(
        {
            "label": "Local",
            "connection_id": conn["id"],
            "model_id": "local-model",
            "config": {},
        },
        ADMIN,
    )
    probe(profile["id"], "before-move")
    bearer = "Bearer first-origin-key"
    assert first.take() == [
        ("/api/tags", bearer),
        ("/api/show", bearer),
        ("/api/chat", bearer),
    ]

    conn = refresh(patch(conn, endpoint=second.endpoint))
    probe(profile["id"], "after-move")
    assert second.take() == [
        ("/api/tags", None),
        ("/api/show", None),
        ("/api/chat", None),
    ]

    conn = service.set_credential(
        conn["id"], "second-origin-key", conn["revision"], ADMIN
    )
    refresh(conn)
    probe(profile["id"], "new-key")
    bearer = "Bearer second-origin-key"
    assert second.take() == [
        ("/api/tags", bearer),
        ("/api/show", bearer),
        ("/api/chat", bearer),
    ]
    assert first.take() == []


def test_config_manager_moves_an_endpoint_but_cannot_set_its_key(
    test_app, pg_db, vault, monkeypatch
):
    from fastapi import HTTPException

    from crate.api import ai_agents as api

    def config_manager(request, capability):
        if capability != "ai.config.manage":
            raise HTTPException(403, "Permission denied")
        return {"id": ADMIN, "capabilities": ["ai.config.read", "ai.config.manage"]}

    conn = ollama_with_key("http://ollama.example.test:11434")
    monkeypatch.setattr(api, "require_agent_admin_session", config_manager)
    path = f"/api/admin/ai/connections/{conn['id']}"

    moved = test_app.patch(
        path,
        json={
            "expected_revision": conn["revision"],
            "endpoint": "http://ollama-b.example.test:11434",
        },
    )
    assert moved.status_code == 200, moved.text
    assert (moved.json()["has_key"], moved.json()["source"]) == (False, "none")
    denied = test_app.post(
        path + "/credential",
        json={"expected_revision": moved.json()["revision"], "api_key": "other"},
    )
    assert denied.status_code == 403
    assert private(conn)["secret_ref"] is None
