"""Pure deterministic rule evaluation and persisted incident/job-watch lifecycle."""

import hashlib
import hmac
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime

from .state import LIMITS, CapacityError, enqueue, event, prune

TOOLS = {
    "get_instance_inventory",
    "get_observability_summary",
    "get_pipeline_status",
    "get_smart_mix_status",
}
KINDS = {"availability", "high", "low", "drift", "progress", "stuck", "digest"}
DIGEST_SEEN = 200
DIGEST_GROUPS = 20
DIGEST_ROWS = 5
IDENTIFIER = re.compile(r"[a-zA-Z0-9_.-]{1,80}\Z")
JOB_FIELDS = (
    "id",
    "status",
    "updated_at",
    "result_status",
    "execution_status",
    "verification_status",
    "projection_status",
    "cancellation_requested",
    "cancellation_requested_at",
    "cancellation_acknowledged_at",
    "partial_effects",
    "error_code",
    "agent_execution",
    "children_truncated",
)


def timestamp(value):
    try:
        if not isinstance(value, str) or len(value) > 80:
            return None
        parsed = datetime.fromisoformat(value)
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def path_value(value, path):
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


@dataclass(frozen=True)
class Rule:
    id: str
    subsystem: str
    tool: str
    source_path: tuple
    kind: str = "availability"
    field: tuple = ()
    active_field: tuple = ()
    arguments: dict | None = None
    threshold: float = 1
    clear_threshold: float = 0
    critical: float | None = None
    expected: str | None = None
    fresh_seconds: int = 180
    trigger_samples: int = 2
    recovery_samples: int = 2
    cooldown_seconds: int = 0
    detail_field: tuple = ()
    group_field: tuple = ()
    row_fields: tuple = ()

    def __post_init__(self):
        if not IDENTIFIER.fullmatch(self.id) or not IDENTIFIER.fullmatch(
            self.subsystem
        ):
            raise ValueError("Invalid rule identity")
        if self.tool not in TOOLS or self.kind not in KINDS:
            raise ValueError("Unknown observation or rule kind")
        if (
            not 1 <= self.fresh_seconds <= 86400
            or not 1 <= self.trigger_samples <= 20
            or not 1 <= self.recovery_samples <= 20
        ):
            raise ValueError("Invalid freshness or hysteresis bound")
        if (
            type(self.cooldown_seconds) is not int
            or not 0 <= self.cooldown_seconds <= 86400
        ):
            raise ValueError("Invalid cooldown bound")
        for path in (
            self.source_path,
            self.field,
            self.active_field,
            self.detail_field,
            self.group_field,
        ):
            if (
                not isinstance(path, (list, tuple))
                or len(path) > 10
                or any(not isinstance(key, str) or len(key) > 80 for key in path)
            ):
                raise ValueError("Invalid bounded source/field path")
        if self.kind != "availability" and not self.field:
            raise ValueError("Metric rule requires an exact field")
        if self.kind == "progress" and not self.active_field:
            raise ValueError("Progress requires a persisted active/backlog count field")
        if self.kind == "digest":
            if (
                not isinstance(self.row_fields, (list, tuple))
                or not 1 <= len(self.row_fields) <= 12
                or "id" not in self.row_fields
                or any(
                    not isinstance(key, str) or not IDENTIFIER.fullmatch(key)
                    for key in self.row_fields
                )
                or self.detail_field
            ):
                raise ValueError("Digest requires bounded row fields including id")
        elif self.row_fields or self.group_field:
            raise ValueError("Row and group fields are only valid for digests")
        for number in (self.threshold, self.clear_threshold, self.critical):
            if number is not None and (
                type(number) not in {int, float} or not math.isfinite(number)
            ):
                raise ValueError("Invalid numeric threshold")
        if self.kind == "high" and self.clear_threshold > self.threshold:
            raise ValueError("High recovery threshold must be below trigger")
        if self.kind == "low" and self.clear_threshold < self.threshold:
            raise ValueError("Low recovery threshold must be above trigger")
        if self.kind == "drift" and (
            not isinstance(self.expected, str) or not 1 <= len(self.expected) <= 128
        ):
            raise ValueError("Drift requires an explicit expected version")
        args = self.arguments or {}
        if self.tool == "get_pipeline_status":
            if set(args) != {"pipeline"} or args["pipeline"] not in {
                "import",
                "enrichment",
                "analysis",
                "bliss",
                "playback",
                "projector",
                "federation",
                "acquisition",
            }:
                raise ValueError("Exact pipeline argument required")
        elif args:
            raise ValueError(
                "Only bounded no-argument inventory/summary/Smart Mix polling supported"
            )

    @property
    def request_key(self):
        return self.tool + ":" + json.dumps(self.arguments or {}, sort_keys=True)


def _valid(source, rule, now):
    observed = timestamp(source.get("observed_at"))
    freshness = source.get("freshness")
    fresh = (
        freshness.get("fresh_seconds", rule.fresh_seconds)
        if isinstance(freshness, dict)
        else rule.fresh_seconds
    )
    if type(fresh) not in {int, float} or not math.isfinite(fresh) or fresh <= 0:
        return False, observed
    return source.get("availability") == "available" and isinstance(
        source.get("data"), dict
    ) and bool(source["data"]) and observed is not None and 0 <= now - observed <= min(
        rule.fresh_seconds, fresh
    ), observed


def _stuck_sample(rule, rows, memory, observed):
    """A bounded task sample can prove a stuck task, never absence-based recovery."""
    if not isinstance(rows, list) or len(rows) > 20:
        return None
    indexed = {
        row.get("id"): row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("id"), str)
    }
    previous = memory.get("stuck_ids", [])
    candidates = [
        row
        for row in indexed.values()
        if row.get("status") in {"running", "delegated", "completing"}
    ]
    ages = {}
    for row in candidates:
        beat = timestamp(path_value(row, rule.field))
        if beat is None or beat > observed:
            continue
        ages[row["id"]] = observed - beat
    stuck = [key for key, age in ages.items() if age >= rule.threshold]
    if stuck:
        identities = list(dict.fromkeys(previous + stuck))
        if len(identities) > 20:
            # Keep the bounded identities and a durable conservative gap marker.
            # Later partial samples cannot prove recovery of an omitted identity.
            memory["stuck_tracking_overflow"] = True
        memory["stuck_ids"] = identities[:20]
        return max(ages.values())
    if memory.get("stuck_tracking_overflow"):
        return None
    if previous:
        for key in previous:
            row = indexed.get(key, {})
            if row.get("status") in {"completed", "failed", "cancelled"}:
                continue
            if key not in ages or ages[key] > rule.clear_threshold:
                return None
        # Retain identities through every affirmative sample in the configured
        # recovery sequence; observe() clears them in the recovery transaction.
        return 0
    # Empty/partial samples cannot establish zero backlog or general health.
    return None


def _evidence(source, valid, observed, now):
    evidence = {
        "source": str(source.get("source", "missing"))[:128],
        "observed_at": source.get("observed_at")[:80]
        if isinstance(source.get("observed_at"), str)
        else None,
        "availability": source.get("availability")
        if source.get("availability") in ("available", "stale", "unavailable")
        else "unavailable",
        "coverage": str(source.get("coverage", "unavailable"))[:128],
        "valid": valid,
    }
    version = source.get("version")
    evidence["version"] = (
        {
            str(key)[:80]: value[:128] if isinstance(value, str) else value
            for key, value in list(version.items())[:6]
            if isinstance(value, (str, int, bool)) or value is None
        }
        if isinstance(version, dict)
        else None
    )
    evidence["age_seconds"] = now - observed if observed is not None else None
    return evidence


def _detail(value):
    try:
        raw = json.dumps(value, sort_keys=True, allow_nan=False)
    except (TypeError, ValueError):
        return None
    return value if len(raw) <= 1000 else None


def _row(rule, row):
    return {
        key: row[key][:128] if isinstance(row[key], str) else row[key]
        for key in rule.row_fields
        if key in row
        and (
            isinstance(row[key], (str, bool))
            or row[key] is None
            or (type(row[key]) in {int, float} and math.isfinite(row[key]))
        )
    }


def _evaluate(rule, source, memory, now):
    valid, observed = _valid(source, rule, now)
    evidence = _evidence(source, valid, observed, now)
    if rule.kind == "availability":
        return (
            not valid,
            "critical"
            if not valid and memory.get("bad", 0) >= rule.trigger_samples * 2
            else "warning",
            evidence,
            observed if valid else now,
        )
    if not valid:
        return None, "warning", evidence, observed
    value = path_value(source.get("data"), rule.field)
    if rule.kind == "drift":
        if not isinstance(value, str) or not value:
            evidence["valid"] = False
            return None, "warning", evidence, observed
        evidence["value"] = value[:128]
        return value != rule.expected, "warning", evidence, observed
    if rule.kind == "stuck":
        if isinstance(source.get("data"), dict) and "rows" in source["data"]:
            value = _stuck_sample(rule, source["data"]["rows"], memory, observed)
            evidence["stuck_task_ids"] = memory.get("stuck_ids", [])
            evidence["stuck_tracking_overflow"] = memory.get(
                "stuck_tracking_overflow", False
            )
        else:
            value = timestamp(value)
            value = (
                observed - value if value is not None and value <= observed else None
            )
        if value is None:
            evidence["valid"] = False
            return None, "warning", evidence, observed
    if type(value) not in {int, float} or not math.isfinite(value) or value < 0:
        evidence["valid"] = False
        return None, "warning", evidence, observed
    evidence["value"] = value
    if rule.detail_field:
        evidence["detail"] = _detail(path_value(source.get("data"), rule.detail_field))
    severity = (
        "critical"
        if rule.critical is not None
        and (value <= rule.critical if rule.kind == "low" else value >= rule.critical)
        else "warning"
    )
    if rule.kind == "progress":
        active = path_value(source.get("data"), rule.active_field)
        if type(active) not in {int, float} or not math.isfinite(active) or active < 0:
            evidence["valid"] = False
            return None, severity, evidence, observed
        evidence["active"] = active
        if active == 0:
            memory.update(value=value, progress_at=observed)
            return False, severity, evidence, observed
        previous = memory.get("value")
        if previous is None or value != previous:
            memory.update(value=value, progress_at=observed)
            return (
                (False if previous is not None and value > previous else None),
                severity,
                evidence,
                observed,
            )
        # Advance only with a new producer sample; stale polling never invents progress.
        return (
            True
            if observed - memory.get("progress_at", observed) >= rule.threshold
            else None,
            severity,
            evidence,
            observed,
        )
    if rule.kind == "low":
        result = (
            True
            if value <= rule.threshold
            else False
            if value >= rule.clear_threshold
            else None
        )
    else:
        result = (
            True
            if value >= rule.threshold
            else False
            if value <= rule.clear_threshold
            else None
        )
    return result, severity, evidence, observed


class Supervisor:
    def __init__(
        self,
        state,
        instance,
        rules,
        *,
        human_callback_secret=None,
        allowed_operators=(),
    ):
        if (
            not IDENTIFIER.fullmatch(instance)
            or not 1 <= len(rules) <= 50
            or len({(rule.subsystem, rule.id) for rule in rules}) != len(rules)
        ):
            raise ValueError("Invalid instance or rule count/identity")
        if len({rule.request_key for rule in rules}) > 8:
            raise ValueError("At most eight distinct observation requests per cycle")
        self.state, self.instance, self.rules = state, instance, rules
        self._human_callback_secret = human_callback_secret
        if human_callback_secret is not None and (
            not isinstance(human_callback_secret, bytes)
            or len(human_callback_secret) < 32
        ):
            raise ValueError(
                "Dedicated native callback secret must contain at least 32 bytes"
            )
        self._allowed_operators = frozenset(allowed_operators)
        existing = state.snapshot()["health"].get("instance")
        if existing and existing != instance:
            raise ValueError("State belongs to a different instance")

    def observe(self, responses, now):
        with self.state.transaction() as data:
            prune(data, now)
            self._expire(data, now)
            coverage = {}
            for rule in self.rules:
                key = f"{self.instance}/{rule.subsystem}/{rule.id}"
                source = path_value(
                    responses.get(rule.request_key, {}), rule.source_path
                )
                source = source if isinstance(source, dict) else {}
                memory = data["rules"].setdefault(key, {"bad": 0, "good": 0})
                if rule.kind == "digest":
                    coverage[key] = self._digest(data, rule, key, source, memory, now)
                    continue
                # Never process regressing source time (including progress baseline).
                observed = timestamp(source.get("observed_at"))
                if observed is not None and observed < memory.get(
                    "last_source", float("-inf")
                ):
                    source = {**source, "availability": "stale"}
                duplicate = _valid(source, rule, now)[0] and observed == memory.get(
                    "last_source"
                )
                result, severity, evidence, sample = _evaluate(
                    rule, source, dict(memory) if duplicate else memory, now
                )
                coverage[key] = evidence
                incident = data["incidents"].get(key)
                if incident and incident["state"] != "resolved":
                    incident["evidence"] = (
                        incident["evidence"] + [{"polled_at": now, **evidence}]
                    )[-LIMITS["evidence"] :]
                    if (
                        incident.get("deferred")
                        and now - incident["notified_at"] >= rule.cooldown_seconds
                    ):
                        self._deliver(data, incident, incident.pop("deferred"), now)
                if duplicate:
                    continue
                if observed is not None and evidence["valid"]:
                    memory["last_source"] = observed
                if result is None:
                    memory.update(good=0, bad=0)
                    continue
                if sample is None or sample == memory.get("sample"):
                    continue
                memory["sample"] = sample
                memory["bad"] = memory["bad"] + 1 if result else 0
                memory["good"] = memory["good"] + 1 if not result else 0
                if result and memory["bad"] >= rule.trigger_samples:
                    if not incident or incident["state"] == "resolved":
                        if (
                            not incident
                            and len(data["incidents"]) >= LIMITS["incidents"]
                        ):
                            raise CapacityError("Incident capacity reached")
                        revision = (incident or {}).get("revision", 0) + 1
                        incident = {
                            "key": key,
                            "state": "open",
                            "severity": severity,
                            "opened_at": now,
                            "updated_at": now,
                            "revision": revision,
                            "evidence": (
                                (incident or {}).get("evidence", [])
                                + [{"polled_at": now, **evidence}]
                            )[-LIMITS["evidence"] :],
                            "silence": (incident or {}).get("silence"),
                            "ack": None,
                            "notified_at": (incident or {}).get("notified_at"),
                        }
                        data["incidents"][key] = incident
                        self._notify(
                            data, incident, "opened", now, rule.cooldown_seconds
                        )
                    elif severity == "critical" and incident["severity"] != "critical":
                        incident.update(
                            severity="critical",
                            state="open",
                            ack=None,
                            updated_at=now,
                            revision=incident["revision"] + 1,
                        )
                        self._notify(
                            data, incident, "escalated", now, rule.cooldown_seconds
                        )
                elif not result and memory["good"] >= rule.recovery_samples:
                    if incident and incident["state"] != "resolved":
                        incident.update(
                            state="resolved",
                            updated_at=now,
                            revision=incident["revision"] + 1,
                        )
                        self._notify(
                            data, incident, "resolved", now, rule.cooldown_seconds
                        )
                    if rule.kind == "stuck":
                        # A transient breach can recover before incident admission.
                        # Clear its proven identities in the same atomic transaction,
                        # whether or not an active incident needed resolution.
                        memory["stuck_ids"] = []
            active_keys = {
                f"{self.instance}/{rule.subsystem}/{rule.id}" for rule in self.rules
            }
            # Removed rules cannot silently resolve their outstanding incidents.
            for key, incident in data["incidents"].items():
                if key not in active_keys and incident["state"] != "resolved":
                    coverage[key] = {
                        "valid": False,
                        "availability": "unavailable",
                        "coverage": "rule_removed",
                    }
            data["rules"] = {
                key: value for key, value in data["rules"].items() if key in active_keys
            }
            gaps = {}
            for response in responses.values():
                missing = path_value(response, ["data", "unavailable_subsystems"])
                if isinstance(missing, list):
                    gaps["functional_subsystems"] = [
                        str(value)[:128] for value in missing[:20]
                    ]
                summary = path_value(response, ["data", "subsystems"])
                if isinstance(summary, dict):
                    for subsystem, item in list(summary.items())[:20]:
                        if isinstance(item, dict):
                            signals = item.get("unavailable_signals")
                            if isinstance(signals, list):
                                gaps[str(subsystem)[:80]] = [
                                    str(signal)[:128] for signal in signals[:20]
                                ]
            data["health"].update(
                instance=self.instance,
                heartbeat_at=now,
                coverage=coverage,
                coverage_gaps=gaps,
            )

    def _notify(self, data, incident, transition, now, cooldown=0):
        event(
            data,
            "incident_" + transition,
            {
                "key": incident["key"],
                "revision": incident["revision"],
                "severity": incident["severity"],
            },
            now,
        )
        last = incident.get("notified_at")
        if transition == "opened" and last is not None and now - last < cooldown:
            incident["deferred"] = transition
            return
        if incident.pop("deferred", None) and transition == "resolved":
            return
        self._deliver(data, incident, transition, now)

    def _deliver(self, data, incident, transition, now):
        if (incident.get("silence") or {}).get("expires_at", 0) <= now:
            enqueue(
                data,
                f"{incident['key']} {transition}; severity={incident['severity']}; evidence={json.dumps(incident['evidence'][-1], sort_keys=True)}",
                now,
                incident=incident["key"],
            )
            incident["notified_at"] = now

    def _digest(self, data, rule, key, source, memory, now):
        valid, observed = _valid(source, rule, now)
        evidence = _evidence(source, valid, observed, now)
        rows = path_value(source.get("data"), rule.field) if valid else None
        if valid and not isinstance(rows, list):
            evidence["valid"] = False
        if (
            isinstance(rows, list)
            and valid
            and observed > memory.get("last_source", float("-inf"))
        ):
            memory["last_source"] = observed
            sample = [
                _row(rule, row)
                for row in rows[:20]
                if isinstance(row, dict)
                and type(row.get("id")) in {str, int}
                and len(str(row["id"])) <= 128
            ]
            seen = memory.get("seen")
            fresh = (
                []
                if seen is None
                else [row for row in sample if str(row["id"]) not in seen]
            )
            memory["seen"] = list(
                dict.fromkeys([str(row["id"]) for row in sample] + (seen or []))
            )[:DIGEST_SEEN]
            lower_bound = bool(source.get("truncated")) and len(fresh) == len(sample)
            groups = memory.setdefault("groups", {})
            for row in reversed(fresh):
                name = path_value(row, rule.group_field) if rule.group_field else "all"
                name = "unknown" if name is None else str(name)[:80]
                if name not in groups and len(groups) >= DIGEST_GROUPS:
                    name = "other"
                group = groups.setdefault(
                    name,
                    {"count": 0, "rows": [], "notified_at": None, "lower_bound": False},
                )
                group["count"] += 1
                group["rows"] = (group["rows"] + [row])[-DIGEST_ROWS:]
                group["lower_bound"] = group["lower_bound"] or lower_bound
            evidence.update(new_rows=len(fresh), baseline=seen is None)
        groups = memory.get("groups", {})
        for name, group in sorted(groups.items()):
            last = group["notified_at"]
            if not group["count"] or (
                last is not None and now - last < rule.cooldown_seconds
            ):
                continue
            summary = {
                "group": name,
                "count": group["count"],
                "count_is_lower_bound": group["lower_bound"],
                "latest": group["rows"],
            }
            enqueue(data, f"{key} new; {json.dumps(summary, sort_keys=True)}", now)
            event(
                data,
                "digest_notified",
                {"key": key, "group": name, "count": group["count"]},
                now,
            )
            group.update(count=0, rows=[], lower_bound=False, notified_at=now)
        memory["groups"] = {
            name: group
            for name, group in groups.items()
            if group["count"]
            or (
                group["notified_at"] is not None
                and now - group["notified_at"] < rule.cooldown_seconds
            )
        }
        return evidence

    def _expire(self, data, now):
        for incident in data["incidents"].values():
            for field in ("ack", "silence"):
                decision = incident.get(field)
                if decision and decision["expires_at"] <= now:
                    incident[field] = None
                    if field == "ack" and incident["state"] == "acknowledged":
                        incident["state"] = "open"
                    incident.update(updated_at=now, revision=incident["revision"] + 1)
                    event(data, field + "_expired", {"key": incident["key"]}, now)
                    if incident["state"] != "resolved" and field == "silence":
                        self._notify(data, incident, "silence_expired", now)

    def watch_job(self, job_id, now, ttl=86400):
        if (
            not isinstance(job_id, str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", job_id)
            or type(ttl) is not int
            or not 1 <= ttl <= 72 * 3600
        ):
            raise ValueError("Invalid task ID or watch TTL")
        with self.state.transaction() as data:
            prune(data, now)
            if job_id not in data["watches"] and len(data["watches"]) >= 30:
                raise CapacityError("At most 30 active job watches")
            previous = data["watches"].get(job_id, {})
            data["watches"][job_id] = {
                **previous,
                "job_id": job_id,
                "expires_at": now + ttl,
            }
            event(
                data,
                "job_watch_registered",
                {"job_id": job_id, "expires_at": now + ttl},
                now,
            )
        return {"job_id": job_id, "expires_at": now + ttl}

    def observe_job(self, job_id, response, now):
        with self.state.transaction() as data:
            watch = data["watches"].get(job_id)
            if not watch or watch["expires_at"] <= now:
                return
            row = response.get("data")
            observed = timestamp(response.get("observed_at"))
            valid = (
                response.get("availability") == "available"
                and isinstance(row, dict)
                and row.get("id") == job_id
                and observed is not None
                and observed <= now
            )
            watch["availability"] = "available" if valid else "unavailable"
            if not valid or observed < watch.get("last_source", float("-inf")):
                watch["availability"] = "unavailable"
                return
            # Whitelist status/effect fields; never retain raw error/progress text.
            notice = {field: row[field] for field in JOB_FIELDS if field in row}
            children = row.get("children", [])
            notice["children"] = (
                [
                    {field: child[field] for field in JOB_FIELDS if field in child}
                    for child in children[:100]
                    if isinstance(child, dict)
                ]
                if isinstance(children, list)
                else []
            )
            if len(json.dumps(notice)) > 12000:
                notice["children"] = []
                notice["children_truncated"] = True
            if len(json.dumps(notice)) > 14000:
                watch["availability"] = "unavailable"
                return
            digest = hashlib.sha256(
                json.dumps(notice, sort_keys=True).encode()
            ).hexdigest()
            watch.update(last_source=observed, observed_at=response.get("observed_at"))
            if digest == watch.get("fingerprint"):
                return
            watch.update(fingerprint=digest, latest=notice)
            event(data, "job_observed", {"job_id": job_id, "evidence": notice}, now)
            # A completed task can still have uncertain execution or pending effects.
            if row.get("status") in {
                "completed",
                "failed",
                "cancelled",
                "canceled",
            } or row.get("cancellation_requested"):
                summary = {
                    key: value for key, value in notice.items() if key != "children"
                }
                summary["sampled_children"] = len(notice["children"])
                enqueue(
                    data,
                    f"Job {job_id}: {json.dumps(summary, sort_keys=True)}. Task status, execution, verification and projection are separate; omitted evidence is unknown.",
                    now,
                )

    def status(self, now):
        data = self.state.snapshot()
        health = data["health"]
        heartbeat = health.get("heartbeat_at")
        pending = [
            item for item in data["outbox"].values() if item["state"] != "delivered"
        ]
        eligible = [
            item
            for item in pending
            if (
                (data["incidents"].get(item.get("incident")) or {}).get("silence") or {}
            ).get("expires_at", 0)
            <= now
        ]
        dead = sum(item["state"] == "dead_letter" for item in eligible)
        failing = sum(bool(item["attempts"]) for item in eligible)
        oldest = max((now - item["created_at"] for item in eligible), default=0)
        coverage = health.get("coverage", {})
        monitoring_degraded = any(
            item["state"] != "resolved" for item in data["incidents"].values()
        ) or any(not item.get("valid") for item in coverage.values())
        degraded = (
            heartbeat is None
            or not 0 <= now - heartbeat <= 120
            or dead > 0
            or failing > 0
            or oldest > 120
        )
        return {
            "instance": self.instance,
            "state": "degraded" if degraded else "ok",
            "monitoring_state": "degraded" if monitoring_degraded else "ok",
            "heartbeat_at": heartbeat,
            "coverage": coverage,
            "coverage_gaps": health.get("coverage_gaps", {}),
            "delivery": {
                "pending": len(pending),
                "silenced": len(pending) - len(eligible),
                "failed_or_uncertain": failing,
                "dead_letter": dead,
                "oldest_pending_seconds": oldest,
            },
            "active_watches": sum(
                item["expires_at"] > now for item in data["watches"].values()
            ),
            "event_cursor": data["sequence"],
        }

    def incidents(self, offset=0, limit=50):
        if (
            type(offset) is not int
            or not 0 <= offset <= LIMITS["incidents"]
            or type(limit) is not int
            or not 1 <= limit <= 100
        ):
            raise ValueError("Invalid incident page")
        rows = sorted(
            self.state.snapshot()["incidents"].values(), key=lambda row: row["key"]
        )
        selected = rows[offset : offset + limit]
        while len(json.dumps(selected).encode()) > 50000 and len(selected) > 1:
            selected.pop()
        following = offset + len(selected)
        return {
            "incidents": selected,
            "next_offset": following if following < len(rows) else None,
        }

    def apply_signed_human_decision(self, receipt, signature, now):
        """INTERNAL only. Native trusted plugin signs after authenticating a human.

        Dedicated callback HMAC secret and allowlist come from trusted local config, never
        request/model arguments. Read/model/delivery credentials cannot authenticate this interface.
        Only the dedicated signed native HTTP route invokes it; read/watch bearers
        and model tools cannot authenticate a decision.
        """
        fields = {
            "audience",
            "operator",
            "incident",
            "revision",
            "action",
            "reason",
            "ttl",
            "issued_at",
            "nonce",
        }
        if not isinstance(receipt, dict) or set(receipt) != fields:
            raise ValueError("Invalid human decision fields")
        if any(
            not isinstance(receipt[field], str)
            for field in (
                "audience",
                "operator",
                "incident",
                "action",
                "reason",
                "nonce",
            )
        ):
            raise ValueError("Human decision identities must be strings")
        raw = json.dumps(
            receipt, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
        if len(raw) > 2048:
            raise ValueError("Human decision exceeds bound")
        try:
            expected = hmac.new(
                self._human_callback_secret, raw, hashlib.sha256
            ).hexdigest()
            if not isinstance(signature, str) or not hmac.compare_digest(
                expected, signature
            ):
                raise ValueError("Invalid signature")
        except Exception:  # noqa: BLE001 — isolate failures without leaking private transport details.
            raise ValueError("Human signature verification failed") from None
        if (
            receipt["audience"] != self.instance
            or receipt["operator"] not in self._allowed_operators
            or receipt["action"] not in {"ack", "silence"}
        ):
            raise ValueError("Human decision authority mismatch")
        if (
            not isinstance(receipt["reason"], str)
            or not 1 <= len(receipt["reason"].strip()) <= 500
            or type(receipt["ttl"]) is not int
            or not 1 <= receipt["ttl"] <= 86400
        ):
            raise ValueError("Reason and at most 24h TTL required")
        if (
            type(receipt["issued_at"]) not in {int, float}
            or not 0 <= now - receipt["issued_at"] <= 120
            or not isinstance(receipt["nonce"], str)
            or not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}", receipt["nonce"])
        ):
            raise ValueError("Expired or invalid human receipt")
        with self.state.transaction() as data:
            prune(data, now)
            if receipt["nonce"] in data["receipts"] or len(data["receipts"]) >= 1000:
                raise ValueError("Replayed receipt or receipt capacity reached")
            incident = data["incidents"].get(receipt["incident"])
            if (
                not incident
                or incident["state"] == "resolved"
                or type(receipt["revision"]) is not int
                or incident["revision"] != receipt["revision"]
            ):
                raise ValueError("Incident revision conflict")
            decision = {
                "operator": receipt["operator"],
                "reason": receipt["reason"].strip(),
                "expires_at": now + receipt["ttl"],
            }
            incident[receipt["action"]] = decision
            if receipt["action"] == "ack":
                incident["state"] = "acknowledged"
            incident.update(revision=incident["revision"] + 1, updated_at=now)
            data["receipts"][receipt["nonce"]] = now + 121
            event(
                data,
                "human_" + receipt["action"],
                {"key": incident["key"], **decision},
                now,
            )
