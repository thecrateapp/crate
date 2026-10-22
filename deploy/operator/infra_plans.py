"""Independent durable exact-plan approvals, native receipts and host serialization."""

import hashlib
import hmac
import json
import re
import threading
import time
import uuid

from .infra_executor import HealthCoverageError
from .infra_policy import OPERATIONS, canonical, digest, secret
from .state import CapacityError, event

NATIVE_PATH = "/v1/native/events"
TERMINAL = {"succeeded", "indeterminate", "rejected", "expired", "invalidated"}


class Bridge:
    def __init__(self, policy, state, executor, *, clock=time.time):
        self.policy, self.state, self.executor, self.clock = (
            policy,
            state,
            executor,
            clock,
        )
        self.effect_lock = threading.Lock()
        with state.transaction() as data:
            data.setdefault("infra_plans", {})
            data.setdefault("infra_nonces", {})
            data.setdefault("infra_updates", {})
            data.setdefault("infra_last_effect", 0)
            # A lost process must never automatically replay an uncertain effect.
            for plan in data["infra_plans"].values():
                if plan["state"] == "effect_started":
                    plan["state"] = "indeterminate"
                    plan["reason"] = "process_lost_after_effect_started"
                    event(
                        data,
                        "infra.reconciliation_required",
                        {"id": plan["id"]},
                        clock(),
                    )

    @staticmethod
    def _view(plan):
        return {
            key: plan[key]
            for key in ("id", "document", "hash", "state", "result", "reason")
            if key in plan
        }

    def read(self, token, plan_id=None, service=None):
        self.policy.authorize("read", token)
        if (plan_id is None) == (service is None):
            raise ValueError("Select exact plan or service")
        if service is not None:
            return {
                "instance": self.policy.config["instance"],
                "observed_at": self.clock(),
                "source": "host_docker",
                "coverage": "exact_service",
                **self.executor.inspect(service, provenance=True),
            }
        return self._view(self.state.snapshot()["infra_plans"][plan_id])

    def prepare(self, token, *, operation, target, version=None, human_id):
        self.policy.authorize("prepare", token)
        if (
            operation not in OPERATIONS
            or not self.policy.config["enabled"]
            or not self.policy.human(human_id, operation)
        ):
            raise PermissionError("Current explicit capability required")
        preconditions = self.executor.preconditions(operation, target, version)
        now, identity = self.clock(), uuid.uuid4().hex
        document = {
            "schema": 1,
            "id": identity,
            "instance": self.policy.config["instance"],
            "operation": operation,
            "target": target,
            "version": version,
            "policy": self.policy.revision,
            "human_id": human_id,
            "preconditions": preconditions,
            "expires_at": now + self.policy.config["plan_ttl_seconds"],
            "verification": "operation-specific-host-postcondition",
            "automatic_apply_on_approval": True,
        }
        raw = canonical(document).decode()
        if len(raw) > 180000:
            raise ValueError("Plan too large for exact native review")
        plan_hash = digest(document)
        pages = [raw[i : i + 2600] for i in range(0, len(raw), 2600)]
        plan = {
            "id": identity,
            "document": document,
            "hash": plan_hash,
            "state": "review",
            "pages": [
                f"Infrastructure {identity}\nHash {plan_hash}\nPage {n + 1}/{len(pages)}\n{page}"
                for n, page in enumerate(pages)
            ],
            "page": 0,
            "delivered": {},
            "attempts": 0,
            "next_delivery": 0,
            "outcome_delivered": False,
        }
        with self.state.transaction() as data:
            if len(data["infra_plans"]) >= 500:
                raise CapacityError(
                    "Infrastructure plan retention full; operator archival required"
                )
            data["infra_plans"][identity] = plan
            event(data, "infra.prepared", {"id": identity, "hash": plan_hash}, now)
        return self._view(plan)

    def _current(self, plan):
        self.policy.load()
        doc = plan["document"]
        if (
            digest(doc) != plan["hash"]
            or doc["policy"] != self.policy.revision
            or not self.policy.config["enabled"]
            or doc["instance"] != self.policy.config["instance"]
            or not self.policy.human(doc["human_id"], doc["operation"])
        ):
            raise PermissionError("Plan authority no longer current")
        if self.clock() >= doc["expires_at"]:
            raise ValueError("Plan expired")

    def apply(self, token, *, plan_id, plan_hash):
        self.policy.authorize("apply", token)
        with self.state.transaction() as data:
            plan = data["infra_plans"][plan_id]
            if not hmac.compare_digest(plan["hash"], plan_hash):
                raise ValueError("Exact plan hash required")
            self._current(plan)
            if plan["state"] not in {"accepted", "effect_started", *TERMINAL}:
                raise PermissionError("Independent native human approval required")
            return self._view(plan)

    def native(self, body, headers):
        """Only signed native SDK events reach the state machine, never bearer/model."""
        self.policy.load()
        if len(body) > 16384 or headers.get("Authorization"):
            raise PermissionError("Native signature required")
        stamp, nonce, signature = (
            headers.get(name, "")
            for name in ("X-Crate-Timestamp", "X-Crate-Nonce", "X-Crate-Signature")
        )
        if (
            not re.fullmatch(r"[0-9]{1,12}", stamp)
            or not re.fullmatch(r"[a-f0-9]{32}", nonce)
            or abs(self.clock() - int(stamp)) > 60
        ):
            raise PermissionError("Invalid native freshness")
        expected = hmac.new(
            secret(self.policy.config["native_key_file"]),
            b"POST\n"
            + NATIVE_PATH.encode()
            + b"\n"
            + stamp.encode()
            + b"\n"
            + nonce.encode()
            + b"\n"
            + body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise PermissionError("Invalid native signature")
        payload = json.loads(body)
        kind = payload.get("kind")
        fields = {
            "pending": set(),
            "delivered": {"confirmation_id", "chat_id", "message_id", "page_index"},
            "outcome_delivered": {"confirmation_id", "chat_id", "message_id"},
            "callback": {
                "confirmation_id",
                "action",
                "user_id",
                "chat_id",
                "chat_type",
                "message_id",
                "update_id",
                "query_id",
            },
        }
        if (
            kind not in fields
            or set(payload) != fields[kind] | {"kind", "instance_id"}
            or payload["instance_id"] != self.policy.config["instance"]
        ):
            raise ValueError("Closed native schema required")
        with self.state.transaction() as data:
            now = self.clock()
            data["infra_nonces"] = {
                key: expiry
                for key, expiry in data["infra_nonces"].items()
                if expiry > now
            }
            if nonce in data["infra_nonces"]:
                raise PermissionError("Native replay")
            if (
                len(data["infra_nonces"]) >= 10000
                or len(data["infra_updates"]) >= 100000
            ):
                raise CapacityError("Native receipts full")
            data["infra_nonces"][nonce] = now + 121
            if kind == "pending":
                return self._pending(data, now)
            plan = data["infra_plans"][payload["confirmation_id"]]
            if (
                payload["chat_id"] != plan["document"]["human_id"]
                or type(payload["chat_id"]) is not int
                or type(payload["message_id"]) is not int
                or payload["message_id"] <= 0
            ):
                raise PermissionError("Exact private message required")
            if kind == "outcome_delivered":
                if plan["state"] not in TERMINAL:
                    raise ValueError("Outcome not terminal")
                plan["outcome_delivered"] = True
            elif kind == "delivered":
                self._current(plan)
                if (
                    plan["state"] != "review"
                    or type(payload["page_index"]) is not int
                    or payload["page_index"] != plan["page"]
                ):
                    raise ValueError("Unexpected page receipt")
                plan["delivered"][str(plan["page"])] = payload["message_id"]
            else:
                self._callback(data, plan, payload)
            return {"state": plan["state"], "confirmation_id": plan["id"]}

    def _pending(self, data, now):
        for plan in data["infra_plans"].values():
            if plan["state"] == "review":
                try:
                    self._current(plan)
                except (ValueError, PermissionError):
                    plan["state"] = (
                        "expired"
                        if now >= plan["document"]["expires_at"]
                        else "invalidated"
                    )
        for plan in data["infra_plans"].values():
            if (
                plan["outcome_delivered"]
                or plan["attempts"] >= 20
                or plan["next_delivery"] > now
            ):
                continue
            base = {
                "confirmation_id": plan["id"],
                "chat_id": plan["document"]["human_id"],
            }
            if plan["state"] in TERMINAL:
                plan["attempts"] += 1
                plan["next_delivery"] = now + 10
                return {
                    **base,
                    "state": "outcome",
                    "result": {
                        "state": plan["state"],
                        "job": {"job_id": plan["id"]},
                        "reason": plan.get("reason"),
                    },
                }
            if plan["state"] == "review" and str(plan["page"]) not in plan["delivered"]:
                plan["attempts"] += 1
                plan["next_delivery"] = now + 10
                return {
                    **base,
                    "state": "page",
                    "page_index": plan["page"],
                    "page_count": len(plan["pages"]),
                    "text": plan["pages"][plan["page"]],
                }
        return {"state": "idle"}

    def _callback(self, data, plan, payload):
        self._current(plan)
        if (
            plan["state"] != "review"
            or payload["chat_type"] != "private"
            or type(payload["user_id"]) is not int
            or payload["user_id"] != plan["document"]["human_id"]
            or plan["delivered"].get(str(plan["page"])) != payload["message_id"]
        ):
            raise PermissionError("Unreviewed or foreign native callback")
        if (
            type(payload["update_id"]) is not int
            or payload["update_id"] < 0
            or not isinstance(payload["query_id"], str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", payload["query_id"])
        ):
            raise ValueError("Invalid update identity")
        receipts = [
            "update:" + str(payload["update_id"]),
            "query:" + payload["query_id"],
        ]
        if any(key in data["infra_updates"] for key in receipts):
            raise PermissionError("Human update replay")
        action = payload["action"]
        if action == "next" and plan["page"] + 1 < len(plan["pages"]):
            plan["page"] += 1
        elif action == "reject":
            plan["state"] = "rejected"
        elif (
            action == "approve"
            and len(plan["delivered"]) == len(plan["pages"])
            and plan["page"] == len(plan["pages"]) - 1
        ):
            plan["state"] = "accepted"
            plan["approved_hash"] = plan["hash"]
            plan["approved_at"] = self.clock()
        else:
            raise ValueError("Full paginated review required")
        for receipt in receipts:
            data["infra_updates"][receipt] = plan["id"]
        plan["attempts"], plan["next_delivery"] = 0, 0
        event(
            data,
            "infra.native_" + action,
            {"id": plan["id"], "hash": plan["hash"], "human": payload["user_id"]},
            self.clock(),
        )

    def tick(self):
        """Single bounded worker; durable effect boundary precedes every host mutation."""
        if not self.effect_lock.acquire(blocking=False):
            return False
        try:
            snapshot = self.state.snapshot()
            if any(
                p["state"] == "indeterminate" for p in snapshot["infra_plans"].values()
            ):
                return (
                    False  # Durable quarantine until observation resolves uncertainty.
                )
            candidates = [
                p for p in snapshot["infra_plans"].values() if p["state"] == "accepted"
            ]
            if not candidates:
                return False
            selected = candidates[0]
            try:
                self._current(selected)
                if (
                    self.clock()
                    < self.state.snapshot()["infra_last_effect"]
                    + self.policy.config["cooldown_seconds"]
                ):
                    return False
                doc = selected["document"]
                if (
                    self.executor.preconditions(
                        doc["operation"], doc["target"], doc["version"]
                    )
                    != doc["preconditions"]
                ):
                    raise ValueError("Host preconditions changed")
                self._current(selected)
                with self.state.transaction() as data:
                    plan = data["infra_plans"][selected["id"]]
                    if (
                        plan["state"] != "accepted"
                        or plan.get("approved_hash") != plan["hash"]
                    ):
                        raise PermissionError("Approval no longer matches")
                    plan["state"] = "effect_started"
                    data["infra_last_effect"] = self.clock()
                    event(
                        data, "infra.effect_started", {"id": plan["id"]}, self.clock()
                    )
                result = self.executor.execute(
                    doc, checkpoint=lambda: self._current(selected)
                )
                verified = self.executor.verify(doc, result)
                status, reason = (
                    ("succeeded", None)
                    if verified
                    else ("indeterminate", "postcondition_not_verified")
                )
            except HealthCoverageError as exc:
                started = (
                    self.state.snapshot()["infra_plans"][selected["id"]]["state"]
                    == "effect_started"
                )
                status = "indeterminate" if started else "invalidated"
                reason, result = "health_coverage_missing", {"services": exc.services}
            except Exception:  # noqa: BLE001 — fail closed without exposing host or credential details.
                # No child exception/output/argv is persisted or exposed.
                started = (
                    self.state.snapshot()["infra_plans"][selected["id"]]["state"]
                    == "effect_started"
                )
                status, reason, result = (
                    ("indeterminate" if started else "invalidated"),
                    "host_operation_not_verified",
                    {},
                )
            with self.state.transaction() as data:
                plan = data["infra_plans"][selected["id"]]
                plan.update(
                    state=status,
                    reason=reason,
                    result=result,
                    attempts=0,
                    next_delivery=0,
                )
                event(
                    data,
                    "infra.outcome",
                    {"id": plan["id"], "state": status},
                    self.clock(),
                )
            return True
        finally:
            self.effect_lock.release()

    def reconcile(self, token, *, plan_id):
        """Read-only reconciliation; no effect retry, new approval needed for mutations."""
        self.policy.authorize("read", token)
        with self.effect_lock:
            plan = self.state.snapshot()["infra_plans"][plan_id]
            if plan["state"] != "indeterminate":
                return self._view(plan)
            try:
                verified = self.executor.verify(
                    plan["document"], plan.get("result", {})
                )
            except Exception:  # noqa: BLE001 — fail closed without exposing host or credential details.
                verified = False
            with self.state.transaction() as data:
                plan = data["infra_plans"][plan_id]
                if verified:
                    plan.update(
                        state="succeeded",
                        reason="reconciled_by_observation",
                        attempts=0,
                        next_delivery=0,
                    )
                event(
                    data,
                    "infra.reconciled",
                    {"id": plan_id, "verified": verified},
                    self.clock(),
                )
                return self._view(plan)
