"""Admin backups API (BK4): capability, write-only secrets, re-auth for the kit."""

from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import text

from crate.backups import kit
from crate.backups.destinations import load_destination_secrets
from crate.db.queries.backup_destinations import get_backup_destination
from crate.db.repositories.backup_destinations import record_destination_check

CAP = "system.backups.manage"
BASE = "/api/admin/backups"
SECRET = "SK-never-returned-0123456789"
PASSPHRASE = "a long kit passphrase"


def _scope():
    from crate.db.tx import transaction_scope

    return transaction_scope()


def _user_id() -> int:
    with _scope() as session:
        return session.execute(text("SELECT min(id) FROM users")).scalar_one()


@pytest.fixture
def api(pg_db, test_app, monkeypatch, tmp_path):
    session = {"caps": {CAP}, "user": True}

    async def resolve_user(self, request):
        if not session["user"]:
            return None
        return {"id": _user_id(), "role": "admin", "username": "admin"}

    def has_capability(user, capability):
        return bool(user) and capability in session["caps"]

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve_user)
    monkeypatch.setattr("crate.api.permissions.has_capability", has_capability)
    monkeypatch.setenv("CRATE_BACKUP_DIR", str(tmp_path))
    monkeypatch.setenv("CRATE_ENV", "test")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("DOMAIN", "example.org")
    queued: list[tuple[str, dict, str | None]] = []

    def create_task_dedup(task_type, params, *, dedup_key=None, **kwargs):
        queued.append((task_type, params, dedup_key))
        return f"task-{len(queued)}"

    monkeypatch.setattr("crate.api.backups.create_task_dedup", create_task_dedup)
    test_app.session = session
    test_app.queued = queued
    return test_app


def _r2(api):
    response = api.post(
        f"{BASE}/destinations",
        json={
            "kind": "s3",
            "name": "Cloudflare R2",
            "config": {
                "endpoint": "https://acc.r2.cloudflarestorage.com",
                "bucket": "crate-backups",
                "region": "auto",
            },
            "secrets": {"access_key_id": "AKID", "secret_access_key": SECRET},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _audit_text() -> str:
    with _scope() as session:
        return session.execute(
            text(
                "SELECT coalesce(string_agg(details_json::text || ' ' || target_name, ' '), '') FROM audit_log"
            )
        ).scalar_one()


ROUTES = [
    ("get", f"{BASE}/overview"),
    ("get", f"{BASE}/providers"),
    ("get", f"{BASE}/destinations"),
    ("post", f"{BASE}/destinations"),
    ("post", f"{BASE}/destinations/test"),
    ("get", f"{BASE}/destinations/00000000-0000-0000-0000-000000000000"),
    ("patch", f"{BASE}/destinations/00000000-0000-0000-0000-000000000000"),
    ("delete", f"{BASE}/destinations/00000000-0000-0000-0000-000000000000"),
    ("post", f"{BASE}/destinations/00000000-0000-0000-0000-000000000000/test"),
    ("get", f"{BASE}/destinations/00000000-0000-0000-0000-000000000000/snapshots"),
    ("post", f"{BASE}/destinations/00000000-0000-0000-0000-000000000000/oauth/start"),
    ("get", f"{BASE}/oauth/callback?state=x&code=y"),
    ("get", f"{BASE}/policies"),
    ("post", f"{BASE}/policies"),
    ("patch", f"{BASE}/policies/00000000-0000-0000-0000-000000000000"),
    ("delete", f"{BASE}/policies/00000000-0000-0000-0000-000000000000"),
    ("get", f"{BASE}/runs"),
    ("post", f"{BASE}/run"),
    ("get", f"{BASE}/local-retention"),
    ("put", f"{BASE}/local-retention"),
    ("post", f"{BASE}/recovery-kit"),
    ("post", f"{BASE}/recovery-kit/confirm"),
]


BODIES = {
    f"{BASE}/destinations": {"kind": "local", "name": "x"},
    f"{BASE}/destinations/test": {"kind": "local"},
    f"{BASE}/policies": {"name": "x", "schedule_kind": "manual"},
    f"{BASE}/run": {"kind": "backup"},
    f"{BASE}/local-retention": {"keep_daily": 1, "keep_weekly": 1, "keep_monthly": 1},
    f"{BASE}/recovery-kit": {"password": "admin", "passphrase": PASSPHRASE},
}


def test_every_route_needs_the_backups_capability(api):
    api.session["caps"] = {"admin.access", "settings.manage"}
    for method, path in ROUTES:
        kwargs = {}
        if method in ("post", "put", "patch"):
            kwargs["json"] = BODIES.get(path, {})
        response = getattr(api, method)(path, **kwargs)
        assert response.status_code == 403, (method, path, response.status_code)
    assert api.queued == []


def test_the_capability_exists_and_admins_have_it():
    from crate.api.permissions import ALL_CAPABILITIES, ROLE_CAPABILITIES

    assert CAP in ALL_CAPABILITIES
    assert CAP in ROLE_CAPABILITIES["admin"]


def test_a_new_destination_starts_disabled_and_never_returns_secrets(api):
    created = _r2(api)
    assert created["enabled"] is False and created["status"] == "untested"
    assert created["secrets_set"] == ["access_key_id", "secret_access_key"]
    body = json.dumps(created)
    assert SECRET not in body and "AKID" not in body
    assert "secret_ref" not in created and "repo_password_ref" not in created
    for path in (
        f"{BASE}/destinations",
        f"{BASE}/destinations/{created['id']}",
        f"{BASE}/overview",
    ):
        response = api.get(path)
        assert response.status_code == 200, path
        assert SECRET not in response.text and "AKID" not in response.text
    audit = _audit_text()
    assert "backup_destination" in audit or "Cloudflare R2" in audit
    assert SECRET not in audit and "AKID" not in audit

    # Enabling waits for a passing test (BG1-11).
    refused = api.patch(f"{BASE}/destinations/{created['id']}", json={"enabled": True})
    assert refused.status_code == 409
    record_destination_check(created["id"], status="ok", initialized=True)
    assert api.get(f"{BASE}/destinations/{created['id']}").json()["enabled"] is True
    off = api.patch(f"{BASE}/destinations/{created['id']}", json={"enabled": False})
    assert off.status_code == 200 and off.json()["enabled"] is False

    # Replacing a secret is write-only too.
    replaced = api.patch(
        f"{BASE}/destinations/{created['id']}",
        json={"secrets": {"secret_access_key": SECRET + "-2"}},
    )
    assert replaced.status_code == 200 and SECRET not in replaced.text


def test_bad_settings_are_refused_without_echoing_secrets(api):
    response = api.post(
        f"{BASE}/destinations",
        json={
            "kind": "s3",
            "name": "R2",
            "config": {"bucket": "x"},
            "secrets": {"secret_access_key": SECRET},
        },
    )
    assert response.status_code == 400
    assert SECRET not in response.text
    assert (
        api.post(f"{BASE}/destinations", json={"kind": "ftp", "name": "x"}).status_code
        == 400
    )


def test_tests_are_queued_as_tasks(api):
    created = _r2(api)
    response = api.post(f"{BASE}/destinations/{created['id']}/test")
    assert response.status_code == 202
    assert api.queued[-1] == (
        "backup_test_destination",
        {"destination_id": created["id"]},
        f"backup_test_destination:{created['id']}",
    )
    assert (
        api.post(
            f"{BASE}/destinations/00000000-0000-0000-0000-000000000000/test"
        ).status_code
        == 404
    )


def test_unsaved_settings_are_tested_without_storing_secrets(api):
    response = api.post(
        f"{BASE}/destinations/test",
        json={
            "kind": "s3",
            "config": {
                "endpoint": "https://acc.r2.cloudflarestorage.com",
                "bucket": "crate",
            },
            "secrets": {"access_key_id": "AKID", "secret_access_key": SECRET},
        },
    )
    assert response.status_code == 202, response.text
    task_type, params, _ = api.queued[-1]
    assert task_type == "backup_probe_destination"
    assert list(params) == ["probe_id"] and SECRET not in json.dumps(params)
    from crate.backups import ephemeral

    assert ephemeral.take(params["probe_id"])["secrets"]["secret_access_key"] == SECRET
    # SFTP needs its generated key installed first.
    sftp = api.post(
        f"{BASE}/destinations/test",
        json={
            "kind": "sftp",
            "config": {"host": "h.example", "user": "u", "path": "p"},
        },
    )
    assert sftp.status_code == 409


def test_policies_with_tiers_and_validation(api):
    destination = _r2(api)
    created = api.post(
        f"{BASE}/policies",
        json={
            "name": "Nightly",
            "schedule_kind": "daily",
            "daily_at": "03:30",
            "window_start": "02:00",
            "window_end": "06:00",
            "keep_daily": 7,
            "keep_weekly": 4,
            "keep_monthly": 3,
            "destinations": {destination["id"]: ["daily", "weekly"]},
        },
    )
    assert created.status_code == 201, created.text
    policy = created.json()
    assert policy["destinations"] == {destination["id"]: ["daily", "weekly"]}
    assert policy["next_run"] is not None
    bad = api.post(f"{BASE}/policies", json={"name": "X", "schedule_kind": "daily"})
    assert bad.status_code == 400 and "time" in bad.json()["detail"]
    unknown = api.post(
        f"{BASE}/policies",
        json={
            "name": "Y",
            "schedule_kind": "manual",
            "destinations": {"00000000-0000-0000-0000-000000000000": ["daily"]},
        },
    )
    assert unknown.status_code == 400
    updated = api.patch(
        f"{BASE}/policies/{policy['id']}",
        json={
            "schedule_kind": "hours",
            "interval_hours": 6,
            "destinations": {destination["id"]: ["monthly"]},
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["interval_hours"] == 6 and updated.json()["daily_at"] is None
    assert updated.json()["destinations"] == {destination["id"]: ["monthly"]}
    assert [p["name"] for p in api.get(f"{BASE}/policies").json()] == ["Nightly"]
    assert api.delete(f"{BASE}/policies/{policy['id']}").status_code == 200
    assert api.get(f"{BASE}/policies").json() == []


def test_run_now_and_the_runs_list(api):
    destination = _r2(api)
    policy = api.post(
        f"{BASE}/policies",
        json={
            "name": "Before upgrades",
            "schedule_kind": "manual",
            "destinations": {destination["id"]: ["daily"]},
        },
    ).json()
    started = api.post(
        f"{BASE}/run", json={"kind": "backup", "policy_id": policy["id"]}
    )
    assert started.status_code == 202
    assert api.queued[-1][0] == "backup_dump"
    assert api.queued[-1][1]["policy_id"] == policy["id"]
    # Verify and drill act on the chosen destination (BG1-12).
    assert api.post(f"{BASE}/run", json={"kind": "verify"}).status_code == 400
    verify = api.post(
        f"{BASE}/run",
        json={
            "kind": "verify",
            "destination_id": destination["id"],
            "policy_id": policy["id"],
        },
    )
    assert verify.status_code == 202
    assert api.queued[-1][0] == "backup_verify"
    drill = api.post(
        f"{BASE}/run",
        json={"kind": "restore_drill", "destination_id": destination["id"]},
    )
    assert drill.status_code == 202 and api.queued[-1][0] == "backup_restore_drill"

    from crate.db.repositories.backup_runs import finish_backup_run, start_backup_run

    for _ in range(3):
        run = start_backup_run(
            "offsite", destination_id=destination["id"], policy_id=policy["id"]
        )
        finish_backup_run(run, status="failed", error="boom")
    page = api.get(
        f"{BASE}/runs", params={"destination_id": destination["id"], "limit": 2}
    )
    assert page.status_code == 200
    data = page.json()
    assert (len(data["items"]), data["total"], data["has_more"]) == (2, 3, True)
    assert data["items"][0]["destination_name"] == "Cloudflare R2"
    assert data["items"][0]["policy_name"] == "Before upgrades"
    assert api.get(f"{BASE}/runs", params={"limit": 500}).status_code == 422


def test_the_recovery_kit_needs_the_current_password(api):
    destination = _r2(api)
    url = f"{BASE}/recovery-kit"
    wrong = api.post(url, json={"password": "not-it", "passphrase": PASSPHRASE})
    assert wrong.status_code == 403
    short = api.post(url, json={"password": "admin", "passphrase": "short"})
    assert short.status_code == 400

    response = api.post(url, json={"password": "admin", "passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/octet-stream"
    assert "crate-recovery-kit-" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    document = kit.age_decrypt(response.content, PASSPHRASE).decode()
    password = load_destination_secrets(
        get_backup_destination(destination["id"])
    ).repository_password
    assert password in document and SECRET not in document
    assert password not in _audit_text()

    overview = api.get(f"{BASE}/overview").json()
    assert overview["kit"]["saved"] is False  # downloaded, not confirmed yet
    assert api.post(f"{BASE}/recovery-kit/confirm").status_code == 200
    assert api.get(f"{BASE}/overview").json()["kit"]["saved"] is True


def test_an_account_without_a_password_cannot_get_the_kit(api):
    _r2(api)
    with _scope() as session:
        session.execute(
            text("UPDATE users SET password_hash = NULL WHERE id = :id"),
            {"id": _user_id()},
        )
    response = api.post(
        f"{BASE}/recovery-kit", json={"password": "admin", "passphrase": PASSPHRASE}
    )
    assert response.status_code == 409


def test_oauth_start_and_a_bad_callback(api, monkeypatch):
    created = api.post(
        f"{BASE}/destinations",
        json={
            "kind": "gdrive",
            "name": "Google Drive",
            "config": {
                "path": "crate-backups",
                "client_id": "cid.apps.googleusercontent.com",
            },
            "secrets": {"client_secret": SECRET},
        },
    ).json()
    start = api.post(f"{BASE}/destinations/{created['id']}/oauth/start")
    assert start.status_code == 200, start.text
    query = parse_qs(urlparse(start.json()["authorize_url"]).query)
    assert query["redirect_uri"] == [
        "https://admin.example.org/api/admin/backups/oauth/callback"
    ]
    assert query["scope"] == ["https://www.googleapis.com/auth/drive.file"]
    assert SECRET not in start.text

    bad = api.get(
        f"{BASE}/oauth/callback",
        params={"state": "forged", "code": "c"},
        follow_redirects=False,
    )
    assert bad.status_code == 303
    location = bad.headers["location"]
    assert location.startswith("/backups") and "oauth=error" in location


def test_snapshots_and_local_retention(api):
    destination = _r2(api)
    record_destination_check(
        destination["id"],
        status="ok",
        snapshots=[
            {
                "id": "a91f03c2",
                "time": "2026-11-10T03:37:00Z",
                "host": "crate",
                "tags": ["daily"],
                "paths": ["/crate.dump"],
            }
        ],
    )
    snapshots = api.get(f"{BASE}/destinations/{destination['id']}/snapshots").json()
    assert [s["id"] for s in snapshots["snapshots"]] == ["a91f03c2"]
    assert snapshots["listed_at"] is not None

    assert api.get(f"{BASE}/local-retention").json() == {
        "keep_daily": 3,
        "keep_weekly": 4,
        "keep_monthly": 3,
    }
    saved = api.put(
        f"{BASE}/local-retention",
        json={"keep_daily": 7, "keep_weekly": 4, "keep_monthly": 6},
    )
    assert saved.status_code == 200 and saved.json()["keep_monthly"] == 6
    assert (
        api.put(
            f"{BASE}/local-retention",
            json={"keep_daily": 0, "keep_weekly": 0, "keep_monthly": 0},
        ).status_code
        == 400
    )


def test_the_overview_counts_failing_destinations(api):
    destination = _r2(api)
    record_destination_check(destination["id"], status="ok", initialized=True)
    record_destination_check(
        destination["id"], status="failing", error="Permission denied"
    )
    overview = api.get(f"{BASE}/overview").json()
    assert overview["failing_count"] == 1
    assert overview["destinations"][0]["health"] == "failing"
    assert overview["alerts"][0]["level"] == "danger"
    assert overview["kit"] == {
        "saved": False,
        "uncovered": 1,
        "total": 1,
        "downloaded_at": None,
    }


def test_deleting_a_destination(api):
    destination = _r2(api)
    assert api.delete(f"{BASE}/destinations/{destination['id']}").status_code == 200
    assert api.get(f"{BASE}/destinations/{destination['id']}").status_code == 404


def test_openapi_contract(test_app):
    schema = test_app.get("/openapi.json").json()
    assert any(tag["name"] == "backups" for tag in schema["tags"])
    group = next(g for g in schema["x-tagGroups"] if g["name"] == "Admin & System")
    assert "backups" in group["tags"]
    overview = schema["paths"]["/api/admin/backups/overview"]["get"]
    assert overview["tags"] == ["backups"]
    assert overview["security"]
    assert overview["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/BackupOverview")
    for path, methods in schema["paths"].items():
        if path.startswith("/api/admin/backups"):
            for operation in methods.values():
                assert operation["tags"] == ["backups"], path
                assert operation.get("summary"), path
