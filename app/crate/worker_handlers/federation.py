"""Federation worker task handlers — catalog sync, import, health polling.

Phase 4/5/6 worker integration. All long-running operations go through Dramatiq.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote

from crate.db.repositories import federation as repo
from crate.task_progress import TaskProgress, emit_progress
from crate.worker_handlers import TaskHandler

log = logging.getLogger(__name__)

if TYPE_CHECKING:
    from crate.federation.client import SignedFederationClient


def _handle_catalog_sync(task_id: str, params: dict, config: dict) -> dict:
    """Sync federated catalog from a peer with pagination."""
    node_uid = params.get("node_uid", "")
    progress = TaskProgress(phase="sync_catalog")

    def on_page(peer_label: str, synced: int) -> None:
        progress.item = f"{peer_label}: {synced}"
        emit_progress(task_id, progress)

    if not node_uid:
        peers = [
            peer
            for peer in repo.list_peers(trust_state="approved")
            if peer.get("node_uid") and not peer.get("disabled_at")
        ]
        progress.total = len(peers)
        emit_progress(task_id, progress, force=True)
        results: list[dict] = []
        total_synced = 0
        for peer in peers:
            peer_uid = str(peer["node_uid"])
            peer_label = str(peer.get("display_name") or peer_uid)
            progress.item = peer_label
            emit_progress(task_id, progress, force=True)
            result = _sync_single_peer_catalog(
                peer_uid,
                params,
                on_page=lambda synced, label=peer_label: on_page(label, synced),
            )
            results.append({"node_uid": peer_uid, **result})
            total_synced += int(result.get("synced") or 0)
            progress.done += 1
            emit_progress(task_id, progress, force=True)
        return {"peers": len(results), "synced": total_synced, "results": results}

    progress.total = 1
    progress.item = str(node_uid)
    emit_progress(task_id, progress, force=True)
    result = _sync_single_peer_catalog(
        str(node_uid),
        params,
        on_page=lambda synced: on_page(str(node_uid), synced),
    )
    progress.done = 1
    emit_progress(task_id, progress, force=True)
    return result


def _duration_seconds(item: dict) -> int | None:
    value = item.get("duration_seconds", item.get("duration"))
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _manifest_page_items(items: object) -> list[dict]:
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    if isinstance(items, dict):
        page_items: list[dict] = []
        for entity_type, key in (
            ("artist", "artists"),
            ("album", "albums"),
            ("track", "tracks"),
        ):
            for item in items.get(key, []):
                if isinstance(item, dict):
                    page_items.append({"entity_type": entity_type, **item})
        return page_items
    return []


def _looks_like_opaque_cursor(value: object) -> bool:
    cursor = str(value or "")
    return len(cursor) >= 40 and not cursor.startswith("{")


def _sync_peer_catalog_delta(
    *,
    peer: dict,
    local_node: dict,
    cursor: str,
    page_size: int,
    sync_generation: int,
    max_pages: int | None = None,
) -> dict:
    from crate.db.jobs.global_catalog_reconciliation import (
        apply_federation_delta_page,
    )
    from crate.federation.client import federated_get

    current = cursor
    total_applied = 0
    pages = 0
    previous_sequence = None
    while max_pages is None or pages < max(1, max_pages):
        path = (
            "/api/federation/v1/catalog/delta"
            f"?cursor={quote(current, safe='')}&limit={page_size}"
        )
        response = federated_get(
            base_url=peer["api_base_url"],
            path=path,
            node_id=local_node["node_uid"],
            key_id=local_node["active_key_id"],
            private_key_ref=local_node["private_key_ref"],
        )
        if response.status_code == 410:
            return {
                "status": "full_sync_required",
                "synced": total_applied,
                "pages": pages,
            }
        response.raise_for_status()
        data = response.json()
        next_cursor = str(data.get("next_cursor") or "")
        if not next_cursor:
            raise RuntimeError("peer delta response is missing next_cursor")
        scanned_sequence = int(data.get("scanned_sequence") or 0)
        if data.get("has_more") and (
            next_cursor == current
            or (previous_sequence is not None and scanned_sequence <= previous_sequence)
        ):
            raise RuntimeError("peer delta response made no forward progress")
        result = apply_federation_delta_page(
            node_uid=str(peer["node_uid"]),
            items=_manifest_page_items(
                data.get("items") or data.get("operations") or []
            ),
            next_cursor=next_cursor,
            last_sequence=scanned_sequence,
            sync_generation=sync_generation,
        )
        total_applied += int(result["applied"])
        pages += 1
        current = next_cursor
        previous_sequence = scanned_sequence
        if not data.get("has_more"):
            break
    return {
        "status": "completed",
        "mode": "delta",
        "synced": total_applied,
        "pages": pages,
        "cursor": current,
    }


def _sync_single_peer_catalog(
    node_uid: str,
    params: dict,
    *,
    on_page: Callable[[int], None] | None = None,
) -> dict:
    from crate.federation.catalog import (
        CatalogSyncFenced,
        begin_catalog_sync_session,
        get_cursor,
    )

    peer = repo.get_peer(node_uid)
    if not peer:
        return {"error": "peer not found"}

    local_node = repo.get_local_node()
    if not local_node:
        return {"error": "local node not configured"}

    page_size = max(1, min(int(params.get("page_size", 500) or 500), 500))
    try:
        stored_cursor = get_cursor(node_uid) or {}
    except Exception:
        log.debug("Unable to load peer catalog checkpoint", exc_info=True)
        stored_cursor = {}
    retry_after = stored_cursor.get("retry_after")
    if isinstance(retry_after, str):
        try:
            retry_after = datetime.fromisoformat(retry_after)
        except ValueError:
            retry_after = None
    if (
        retry_after
        and retry_after > datetime.now(UTC)
        and not params.get("ignore_backoff")
    ):
        return {
            "status": "backoff",
            "retry_after": retry_after.isoformat(),
            "synced": 0,
        }
    # FED-D11: every write of this run is fenced by this generation. A newer
    # run, a disable or a revocation bumps it, and this run then stops
    # without writing instead of undoing the newer run's work.
    try:
        sync_generation = begin_catalog_sync_session(node_uid)
    except CatalogSyncFenced as exc:
        return {"status": "skipped", "reason": str(exc), "synced": 0}
    try:
        return _sync_peer_catalog_session(
            node_uid,
            params,
            peer=peer,
            local_node=local_node,
            stored_cursor=stored_cursor,
            page_size=page_size,
            sync_generation=sync_generation,
            on_page=on_page,
        )
    except CatalogSyncFenced as exc:
        log.warning("Peer catalog sync stopped: %s", exc)
        return {
            "status": "fenced",
            "error": str(exc),
            "synced": 0,
            "sync_generation": sync_generation,
        }


def _sync_peer_catalog_session(
    node_uid: str,
    params: dict,
    *,
    peer: dict,
    local_node: dict,
    stored_cursor: dict,
    page_size: int,
    sync_generation: int,
    on_page: Callable[[int], None] | None,
) -> dict:
    from crate.db.repositories.federation_manifest_import import (
        apply_federation_manifest_page,
    )
    from crate.federation.catalog import (
        CatalogSyncFenced,
        record_catalog_sync_error,
        tombstone_catalog_items_missing_from_revision,
        tombstone_catalog_items_missing_from_session,
        upsert_cursor,
    )
    from crate.federation.client import federated_get
    from crate.federation.events import (
        emit_catalog_sync_completed,
        emit_catalog_sync_failed,
    )

    def record_failure(error: str) -> None:
        # A superseded run records nothing: its failure must not put the
        # newer run in backoff or overwrite the peer's status.
        try:
            recorded = record_catalog_sync_error(
                node_uid, error, sync_generation=sync_generation
            )
        except Exception:
            log.debug("Unable to persist peer sync error", exc_info=True)
            recorded = True
        if not recorded:
            raise CatalogSyncFenced(
                node_uid,
                expected_generation=sync_generation,
                current_generation=None,
            )
        repo.update_peer(node_uid, last_error=error[:200])
        emit_catalog_sync_failed(node_uid, error[:200])

    base_path = f"/api/federation/v1/catalog/manifest?page_size={page_size}"
    total_count = 0
    revision = ""
    page = max(0, int(params.get("start_page", 0) or 0))
    stored_value = stored_cursor.get("cursor")
    if (
        "start_page" not in params
        and not params.get("force_full")
        and _looks_like_opaque_cursor(stored_value)
    ):
        try:
            delta_result = _sync_peer_catalog_delta(
                peer=peer,
                local_node=local_node,
                cursor=str(stored_value),
                page_size=page_size,
                sync_generation=sync_generation,
                max_pages=(
                    int(params["max_pages"])
                    if params.get("max_pages") is not None
                    else None
                ),
            )
        except CatalogSyncFenced:
            raise
        except Exception as exc:
            log.warning("Peer catalog delta sync failed", exc_info=True)
            record_failure(str(exc))
            return {"status": "failed", "error": str(exc)[:200], "synced": 0}
        if delta_result.get("status") != "full_sync_required":
            emit_catalog_sync_completed(
                node_uid,
                int(delta_result.get("synced") or 0),
                str(delta_result.get("cursor") or ""),
            )
            return delta_result

    sync_session_uid = str(uuid.uuid4())
    next_cursor = ""
    snapshot_cursor = ""
    snapshot_sequence = 0
    if "start_page" not in params and not params.get("force_full"):
        try:
            checkpoint = json.loads(str(stored_cursor.get("cursor") or "{}"))
        except (ValueError, TypeError, RecursionError):
            checkpoint = {}
        if (
            isinstance(checkpoint, dict)
            and checkpoint.get("status") == "partial"
            and int(checkpoint.get("page_size") or 0) == page_size
        ):
            page = max(0, int(checkpoint.get("next_page") or 0))
            revision = str(checkpoint.get("revision") or "")
            total_count = max(0, int(checkpoint.get("synced") or 0))
            next_cursor = str(checkpoint.get("next_cursor") or "")
            snapshot_cursor = str(checkpoint.get("snapshot_cursor") or "")
            sync_session_uid = str(
                checkpoint.get("sync_session_uid") or sync_session_uid
            )
    max_pages = params.get("max_pages")
    pages_fetched = 0
    manifest_completed = False
    restarted_after_revision_change = False

    while max_pages is None or pages_fetched < max(1, int(max_pages)):
        try:
            manifest_path = f"{base_path}&page={page}"
            if next_cursor:
                manifest_path = f"{base_path}&cursor={quote(next_cursor, safe='')}"
            resp = federated_get(
                base_url=peer["api_base_url"],
                path=manifest_path,
                node_id=local_node["node_uid"],
                key_id=local_node["active_key_id"],
                private_key_ref=local_node["private_key_ref"],
            )
            if (
                getattr(resp, "status_code", 200) == 410
                and not restarted_after_revision_change
            ):
                # A changed sharing scope invalidates its continuation token.
                # Restart from a fresh bootstrap, never from the previous cursor.
                page = 0
                revision = ""
                total_count = 0
                pages_fetched = 0
                next_cursor = ""
                snapshot_cursor = ""
                snapshot_sequence = 0
                sync_session_uid = str(uuid.uuid4())
                restarted_after_revision_change = True
                continue
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            log.warning("Peer catalog manifest fetch failed", exc_info=True)
            record_failure(str(e))
            return {
                "status": "failed",
                "error": str(e)[:200],
                "synced": total_count,
                "revision": revision,
                "pages": pages_fetched,
            }

        page_revision = str(data.get("revision") or "")
        if not page_revision:
            error = "peer manifest is missing a revision"
            record_failure(error)
            return {
                "status": "failed",
                "error": error,
                "synced": total_count,
                "revision": revision,
                "pages": pages_fetched,
            }
        if revision and page_revision != revision:
            if page > 0 and not restarted_after_revision_change:
                page = 0
                revision = ""
                total_count = 0
                pages_fetched = 0
                next_cursor = ""
                snapshot_cursor = ""
                snapshot_sequence = 0
                sync_session_uid = str(uuid.uuid4())
                restarted_after_revision_change = True
                continue
            error = "peer manifest revision changed during pagination"
            record_failure(error)
            return {
                "status": "failed",
                "error": error,
                "synced": total_count,
                "revision": revision,
                "pages": pages_fetched,
            }
        revision = page_revision
        snapshot_cursor = str(data.get("snapshot_cursor") or snapshot_cursor)
        snapshot_sequence = int(data.get("snapshot_sequence") or snapshot_sequence)
        page_items = _manifest_page_items(data.get("items", []))
        pages_fetched += 1

        if not page_items:
            manifest_completed = True
            break

        response_next_cursor = str(data.get("next_cursor") or "")
        valid_count = sum(
            str(item.get("entity_type") or "") in {"artist", "album", "track"}
            and bool(item.get("remote_entity_uid") or item.get("entity_uid"))
            for item in page_items
        )
        # The staged rows, dirty markers and continuation advance together.
        applied = apply_federation_manifest_page(
            node_uid=node_uid,
            items=page_items,
            revision=revision,
            sync_session_uid=sync_session_uid,
            sync_generation=sync_generation,
            checkpoint={
                "next_page": page + 1,
                "page_size": page_size,
                "synced": total_count + valid_count,
                "next_cursor": response_next_cursor or None,
                "snapshot_cursor": snapshot_cursor or None,
            },
        )
        total_count += int(applied["applied"])
        if on_page is not None:
            on_page(total_count)
        if "has_more" in data:
            if not data["has_more"]:
                manifest_completed = True
                break
            if response_next_cursor and response_next_cursor == next_cursor:
                error = "peer manifest response made no forward progress"
                record_failure(error)
                return {"status": "failed", "error": error, "synced": total_count}
        total_pages = data.get("total_pages")
        if (
            "has_more" not in data
            and total_pages is not None
            and data.get("page", page) >= int(total_pages) - 1
        ):
            manifest_completed = True
            break
        if (
            "has_more" not in data
            and total_pages is None
            and len(page_items) < page_size
        ):
            manifest_completed = True
            break
        if response_next_cursor:
            next_cursor = response_next_cursor
        page += 1

    if not manifest_completed:
        error = "peer manifest sync stopped before the final page"
        record_failure(error)
        return {
            "status": "failed",
            "error": error,
            "synced": total_count,
            "revision": revision,
            "pages": pages_fetched,
        }

    if snapshot_cursor:
        tombstoned = tombstone_catalog_items_missing_from_session(
            node_uid, sync_session_uid, sync_generation=sync_generation
        )
        upsert_cursor(
            node_uid,
            snapshot_cursor,
            last_applied_cursor=snapshot_sequence,
            snapshot_cursor=snapshot_sequence,
            sync_session_uid=sync_session_uid,
            full_verified=True,
            sync_generation=sync_generation,
        )
    else:
        tombstoned = tombstone_catalog_items_missing_from_revision(
            node_uid, revision, sync_generation=sync_generation
        )
        upsert_cursor(node_uid, revision, sync_generation=sync_generation)
    delta_synced = 0
    if snapshot_cursor:
        try:
            catch_up = _sync_peer_catalog_delta(
                peer=peer,
                local_node=local_node,
                cursor=snapshot_cursor,
                page_size=page_size,
                sync_generation=sync_generation,
            )
            if catch_up.get("status") == "full_sync_required":
                raise RuntimeError(
                    "catalog changes expired during bootstrap; retry full sync"
                )
            delta_synced = int(catch_up.get("synced") or 0)
        except CatalogSyncFenced:
            raise
        except Exception as exc:
            log.warning("Peer catalog delta catch-up failed", exc_info=True)
            error = str(exc)[:200]
            record_failure(error)
            return {
                "status": "failed",
                "error": error,
                "synced": total_count,
                "phase": "catch_up_deltas",
            }
    emit_catalog_sync_completed(node_uid, total_count, revision)
    return {
        "status": "completed",
        "synced": total_count,
        "revision": revision,
        "pages": pages_fetched,
        "tombstoned": tombstoned,
        "delta_synced": delta_synced,
    }


def _build_import_user_assertion(
    local: dict,
    peer: dict,
    user: dict,
    *,
    purpose: str,
) -> str:
    from crate.federation.assertions import build_outbound_user_assertion

    return build_outbound_user_assertion(
        local,
        peer,
        user,
        purpose=purpose,
        capabilities=["federation.import.request"],
    )


def _build_import_client(local: dict, peer: dict) -> SignedFederationClient:
    import httpx

    from crate.federation.client import SignedFederationClient

    return SignedFederationClient(
        base_url=str(peer["api_base_url"]),
        node_id=str(local["node_uid"]),
        key_id=str(local["active_key_id"]),
        private_key_ref=str(local["private_key_ref"]),
        timeout=httpx.Timeout(300.0, connect=10.0),
    )


def _handle_federation_import(task_id: str, params: dict, config: dict) -> dict:
    """Download, verify and import one approved remote album."""
    request_id = str(params.get("request_id") or "")
    if not request_id:
        return {"error": "missing request_id"}

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    from crate.db.jobs.federation_imports import (
        release_import_storage,
        reserve_import_storage,
    )
    from crate.db.repositories import federation_trust as trust_repo
    from crate.federation.imports import (
        get_import_request,
        record_import_provenance,
        update_import_request,
        verify_signed_import_manifest,
    )
    from crate.importer import ImportQueue
    from crate.worker_handlers import is_cancelled

    req = get_import_request(request_id)
    if not req:
        return {"error": "import request not found"}

    if req["status"] != "approved":
        return {"error": "import request not approved"}
    peer = repo.get_peer(str(req["node_uid"]))
    local = repo.get_local_node()
    if not peer or peer.get("trust_state") != "approved" or peer.get("disabled_at"):
        return {"error": "remote peer is not approved"}
    if not local:
        return {"error": "local node is not configured"}

    user = {"id": req.get("requested_by_user_id") or "worker", "role": "admin"}
    manifest_assertion = _build_import_user_assertion(
        local,
        peer,
        user,
        purpose="import.manifest",
    )
    library_path = Path(config["library_path"]).resolve()
    staging_relative = Path(".imports") / "federation" / request_id
    staging_dir = (library_path / staging_relative).resolve()
    if library_path not in staging_dir.parents:
        return {"error": "invalid import staging path"}

    client = _build_import_client(local, peer)
    reserved = False
    last_cancel_check = 0.0
    cancel_cached = False

    def should_cancel() -> bool:
        nonlocal last_cancel_check, cancel_cached
        now = time.monotonic()
        if now - last_cancel_check < 0.5:
            return cancel_cached
        last_cancel_check = now
        current = get_import_request(request_id) or {}
        cancel_cached = is_cancelled(task_id) or current.get("status") == "cancelled"
        return cancel_cached

    progress = TaskProgress(
        phase="manifest", phase_count=3, item=str(req.get("title") or "")
    )
    emit_progress(task_id, progress, force=True)
    try:
        response = client.request(
            "GET",
            f"/api/federation/v1/albums/{req['remote_entity_uid']}/import-manifest",
            user_assertion=manifest_assertion,
        )
        response.raise_for_status()
        envelope = response.json()
        key_id = str(envelope.get("key_id") or "")
        key = trust_repo.get_peer_verification_key(str(peer["node_uid"]), key_id)
        if not key:
            raise ValueError("Import manifest uses an unknown peer key")
        import base64

        public_key = Ed25519PublicKey.from_public_bytes(
            base64.b64decode(str(key["public_key"]), validate=True)
        )
        max_bytes = int(
            os.environ.get("CRATE_FEDERATION_IMPORT_MAX_BYTES", "100000000000")
        )
        manifest = verify_signed_import_manifest(
            envelope,
            public_key=public_key,
            max_bytes=max_bytes,
        )
        previous_digest = str(req.get("manifest_digest") or "")
        manifest_digest = str(envelope["manifest_digest"])
        if previous_digest and previous_digest != manifest_digest:
            raise ValueError("Import manifest changed during retry")
        update_import_request(
            request_id,
            status="reserving",
            metadata_patch={"manifest": manifest},
            manifest_digest=manifest_digest,
            staging_relative_path=staging_relative.as_posix(),
        )
        reserve_import_storage(
            request_id,
            expected_bytes=int(manifest["total_bytes"]),
            library_path=library_path,
        )
        reserved = True
        staging_dir.mkdir(parents=True, exist_ok=True)
        update_import_request(request_id, status="downloading")
        progress.phase = "download"
        progress.phase_index = 1
        progress.total = len(manifest["tracks"])
        emit_progress(task_id, progress, force=True)

        received = 0
        for index, track in enumerate(manifest["tracks"], start=1):
            if should_cancel():
                update_import_request(request_id, status="cancelled")
                raise RuntimeError("Federated import cancelled")
            progress.done = index - 1
            progress.item = str(track.get("title") or track["entity_uid"])
            emit_progress(task_id, progress)
            suffix = Path(str(track.get("title") or track["entity_uid"])).name
            extension = str(track.get("format") or "mp3").lower().lstrip(".")
            filename = f"{index:03d}-{suffix}.{extension}"
            target = staging_dir / filename
            file_assertion = _build_import_user_assertion(
                local,
                peer,
                user,
                purpose="import.file",
            )
            received += _download_verified_import_track(
                client=client,
                path=str(track["url"]),
                target=target,
                expected_size=int(track["size_bytes"]),
                expected_sha256=str(track["sha256"]),
                user_assertion=file_assertion,
                should_cancel=should_cancel,
            )
            update_import_request(
                request_id,
                received_bytes=received,
            )

        if received != int(manifest["total_bytes"]):
            raise ValueError("Downloaded bytes do not match import manifest")
        progress.done = progress.total
        emit_progress(task_id, progress, force=True)
        update_import_request(request_id, status="verifying")
        update_import_request(request_id, status="importing")
        progress.phase = "import"
        progress.phase_index = 2
        progress.item = str(manifest.get("title") or req["title"])
        emit_progress(task_id, progress, force=True)
        result = ImportQueue(config).import_item(
            str(staging_dir),
            str(manifest.get("artist") or "Unknown Artist"),
            str(manifest.get("title") or req["title"]),
        )
        if result.get("error"):
            raise RuntimeError(str(result["error"]))
        from crate.db.repositories.library import get_library_album
        from crate.library_sync import LibrarySync

        imported_path = Path(str(result["dest"])).resolve()
        relative_import = imported_path.relative_to(library_path)
        artist_root = library_path / relative_import.parts[0]
        LibrarySync(config).sync_artist(artist_root)
        imported_album = get_library_album(
            str(manifest.get("artist") or "Unknown Artist"),
            str(manifest.get("title") or req["title"]),
        )
        album_id = int((imported_album or {}).get("id") or 0)
        record_import_provenance(
            album_id=album_id if album_id > 0 else None,
            node_uid=str(peer["node_uid"]),
            node_name=str(peer.get("display_name") or ""),
            remote_entity_uid=str(req["remote_entity_uid"]),
            imported_by_user_id=req.get("requested_by_user_id"),
            request_id=request_id,
        )
        update_import_request(request_id, status="completed")
        shutil.rmtree(staging_dir, ignore_errors=True)
        return {"status": "completed", "request_id": request_id, **result}
    except Exception as exc:
        log.warning("Federation album import failed", exc_info=True)
        failure = str(exc).lower()
        if "sha-256" in failure or "digest mismatch" in failure:
            from crate.federation.abuse import observe_risk_signal

            observe_risk_signal(
                "import_hash_failure",
                peer_node_uid=str(peer["node_uid"]),
                severity="high",
                reason_code=(
                    "track_digest_mismatch"
                    if "sha-256" in failure
                    else "manifest_digest_mismatch"
                ),
                dedupe_key=request_id,
            )
        current = get_import_request(request_id) or {}
        if current.get("status") == "cancelled" or is_cancelled(task_id):
            update_import_request(request_id, status="cancelled")
        else:
            update_import_request(
                request_id,
                status="failed",
                metadata_patch={"error": str(exc)[:1000]},
                failure_reason=str(exc),
            )
        shutil.rmtree(staging_dir, ignore_errors=True)
        return {"status": "failed", "error": str(exc)[:500], "request_id": request_id}
    finally:
        client.close()
        if reserved:
            release_import_storage(request_id)


def _download_verified_import_track(
    *,
    client,
    path: str,
    target: Path,
    expected_size: int,
    expected_sha256: str,
    user_assertion: str,
    should_cancel: Callable[[], bool] | None = None,
) -> int:
    if target.is_file() and target.stat().st_size == expected_size:
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest == expected_sha256:
            return expected_size
    partial = target.with_suffix(target.suffix + ".part")
    partial.unlink(missing_ok=True)
    digest = hashlib.sha256()
    received = 0
    try:
        with client.stream(path, user_assertion=user_assertion) as response:
            response.raise_for_status()
            with partial.open("xb") as handle:
                for chunk in response.iter_bytes(chunk_size=65536):
                    if not chunk:
                        continue
                    if should_cancel is not None and should_cancel():
                        raise RuntimeError("Federated import cancelled")
                    received += len(chunk)
                    if received > expected_size:
                        raise ValueError("Import track exceeded declared size")
                    digest.update(chunk)
                    handle.write(chunk)
        if received != expected_size:
            raise ValueError("Import track size mismatch")
        if digest.hexdigest() != expected_sha256:
            raise ValueError("Import track SHA-256 mismatch")
        os.replace(partial, target)
        return received
    finally:
        partial.unlink(missing_ok=True)


def _handle_health_poll(task_id: str, params: dict, config: dict) -> dict:
    """Poll all approved peers for health status."""
    from crate.federation.health import run_health_poll

    results = run_health_poll()
    healthy = sum(1 for r in results if r.get("healthy"))
    return {"total": len(results), "healthy": healthy, "results": results}


def _handle_directory_refresh(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.repositories import federation_directories as directory_repo
    from crate.federation.directory import refresh_directory_subscription

    subscription_uid = str(params.get("subscription_uid") or "")
    if subscription_uid:
        subscription = directory_repo.get_subscription(subscription_uid)
        if subscription is None:
            raise ValueError("Federation directory subscription not found")
        return refresh_directory_subscription(subscription)

    results = [
        refresh_directory_subscription(subscription)
        for subscription in directory_repo.list_due_subscriptions()
    ]
    return {
        "subscriptions": len(results),
        "succeeded": sum(
            result.get("status") in {"succeeded", "not_modified"} for result in results
        ),
        "results": results,
    }


FEDERATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "federation_catalog_sync": _handle_catalog_sync,
    "federation_sync_catalog": _handle_catalog_sync,
    "federation_import": _handle_federation_import,
    "federation_import_album": _handle_federation_import,
    "federation_health_poll": _handle_health_poll,
    "federation_directory_refresh": _handle_directory_refresh,
}
