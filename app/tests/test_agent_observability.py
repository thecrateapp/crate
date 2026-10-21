"""Persisted observations stay bounded, explicit about gaps, and free of domain effects."""

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from crate import agent_observability as observations
from crate.agent_diagnostics import DiagnosticError
from crate.db.queries.agent_observability import PIPELINES, read_observation_evidence
from crate.mcp.schemas import PipelineInput, SmartMixStatusInput
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION
from pydantic import ValidationError

NOW = datetime.now(UTC)
UIDS = [str(UUID(int=i)) for i in range(1, 52)]


def record(source, payload, age=0, **kwargs):
    return {
        "source": source,
        "payload": payload,
        "observed_at": (NOW - timedelta(seconds=age)).isoformat(),
        **kwargs,
    }


def fixture_evidence():
    return {
        "runtime": [
            record("worker_live", {"engine": "dramatiq", "pending_count": 0}),
            record("analysis_status", {"analysis_done": 17, "bliss_done": 8}, age=400),
            record("imports_pending", {"count": 2}),
            record(
                "smart_mix:coverage",
                {
                    "analyzer_version": ANALYZER_VERSION,
                    "profile_version": PROFILE_SCHEMA_VERSION,
                    "current_profiles": 1,
                },
            ),
            record(
                "smart_mix:backfill_campaign",
                {"target": ANALYZER_VERSION, "status": "paused"},
            ),
        ],
        "snapshots": [],
        "profiles": [],
        "jobs": [],
        "queried_at": NOW,
        "database_schema_version": "131",
    }


@pytest.fixture
def stored(monkeypatch):
    evidence = fixture_evidence()
    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", lambda **kw: evidence
    )
    return evidence


def test_inventory_separates_stored_image_reference_from_unknown_provenance(stored):
    stored["snapshots"] = [
        record(
            "ops:stack",
            {
                "available": True,
                "containers": [
                    {
                        "name": "crate-api",
                        "image": "ghcr.io/team/crate-api:old-commit",
                        "state": "running",
                        "password": "never-return",
                    }
                ],
            },
        )
    ]
    data = observations.get_instance_inventory()["data"]
    assert data["mcp_contract_version"] == "1.2.0"
    assert data["sources"]["database_schema"]["data"]["version"] == "131"
    assert data["sources"]["release_manifest"]["availability"] == "unavailable"
    assert data["release_sha"] is data["context_version"] is None
    api = data["services"]["crate-api"]
    assert api["data"]["image_reference"] == "ghcr.io/team/crate-api:old-commit"
    assert api["image_id"] is api["image_source_sha"] is None
    assert not api["live_image_verified"]
    assert data["services"]["crate-worker"]["availability"] == "unavailable"
    assert "never-return" not in json.dumps(data)


def test_summary_independent_timestamps_and_coverage(stored):
    data = observations.get_observability_summary()["data"]
    assert set(data["subsystems"]) == set(PIPELINES)
    analysis = data["subsystems"]["analysis"]["sources"]
    assert analysis["coverage"]["availability"] == "stale"
    assert analysis["worker"]["availability"] == "available"
    assert analysis["coverage"]["observed_at"] != analysis["worker"]["observed_at"]
    assert analysis["live_probe"]["availability"] == "unavailable"
    assert data["operational_event_cursor"] is None
    assert (
        "complete_pipeline_progress"
        in data["subsystems"]["analysis"]["unavailable_signals"]
    )


@pytest.mark.parametrize("pipeline", PIPELINES)
def test_pipeline_samples_never_claim_complete_progress(stored, pipeline):
    stored["jobs"] = [
        {"id": str(i), "type": "test", "status": "completed", "updated_at": str(NOW)}
        for i in range(21)
    ]
    result = observations.get_pipeline_status(pipeline)
    tasks = result["data"]["sources"]["tasks"]
    assert tasks["returned_count"] == 20 and tasks["truncated"]
    assert len(tasks["data"]["rows"]) == 20
    assert not result["data"]["complete"]
    assert result["data"]["lookback_hours"] == 24


def test_projector_unavailable_producer_does_not_report_healthy_zero(stored):
    stored["snapshots"] = [
        record("ops", {"eventing": {"outbox": {"pending": 0, "unavailable": True}}})
    ]
    outbox = observations.get_pipeline_status("projector")["data"]["sources"]["outbox"]
    assert outbox["availability"] == "unavailable"
    assert outbox["data"] is None


def test_smart_mix_retains_outdated_coverage_and_each_track_version(stored):
    stored["runtime"][3] = record(
        "smart_mix:coverage",
        {"analyzer_version": "old", "profile_version": 1, "current_profiles": 7},
    )
    stored["profiles"] = [
        {
            "track_uid": UIDS[0],
            "analyzer_version": "old",
            "profile_version": 1,
            "profile_revision": "r",
            "quality": "full",
            "analyzed_at": str(NOW),
            "source_stale_at": None,
        },
        {
            "track_uid": UIDS[1],
            "analyzer_version": ANALYZER_VERSION,
            "profile_version": 1,
            "profile_revision": "r2",
            "quality": "full",
            "analyzed_at": str(NOW),
            "source_stale_at": str(NOW),
        },
        {
            "track_uid": UIDS[2],
            "analyzer_version": ANALYZER_VERSION,
            "profile_version": 1,
            "profile_revision": "r3",
            "quality": "full",
            "analyzed_at": str(NOW),
            "source_stale_at": None,
        },
    ]
    data = observations.get_smart_mix_status(UIDS[:4])["data"]
    coverage = data["sources"]["coverage"]
    assert coverage["availability"] == "stale"
    assert coverage["data"]["current_profiles"] == 7
    assert [item["profile_status"] for item in data["tracks"]] == [
        "outdated",
        "source_changed",
        "current",
        "missing_track",
    ]
    assert data["tracks"][0]["observed_at"] == str(NOW)
    assert data["implementation_versions"]["analyzer_version"] == ANALYZER_VERSION


@pytest.mark.parametrize(
    "call",
    [
        observations.get_instance_inventory,
        observations.get_observability_summary,
        lambda: observations.get_pipeline_status("analysis"),
        lambda: observations.get_smart_mix_status(UIDS[:1]),
    ],
)
def test_source_failure_is_explicit_and_sanitized(monkeypatch, call):
    def broken(**kwargs):
        raise RuntimeError("postgresql://user:private-secret@host/db")

    monkeypatch.setattr(
        observations.evidence_store, "read_observation_evidence", broken
    )
    result = call()
    assert result["availability"] == "unavailable"
    assert "private-secret" not in json.dumps(result)
    assert "Persisted evidence source failed" in json.dumps(result)


def test_missing_and_oversized_sources_preserve_absence_not_zero(stored):
    stored["runtime"] = [record("analysis_status", None, oversized=True)]
    data = observations.get_observability_summary()["data"]
    assert data["sources"]["worker_live"]["data"] is None
    assert (
        data["sources"]["analysis_status"]["reason"]
        == "Stored evidence exceeds 32768 byte bound"
    )
    assert data["sources"]["analysis_status"]["availability"] == "unavailable"


def test_stored_text_and_nested_values_are_bounded_and_redacted(stored):
    stored["runtime"][0]["payload"].update(
        engine="Authorization: Bearer secret-value", password="not-output"
    )
    stored["runtime"][3]["payload"]["versions"] = [
        {"analyzer_version": "token=never-output", "password": "not-output"}
    ] * 100
    payload = observations.get_smart_mix_status()["data"]["sources"]["coverage"]["data"]
    assert len(payload["versions"]) == 20
    assert observations.get_smart_mix_status()["data"]["sources"]["coverage"][
        "truncated"
    ]
    result = json.dumps([payload, observations.get_observability_summary()])
    assert all(
        secret not in result
        for secret in ("secret-value", "never-output", "not-output")
    )


@pytest.mark.parametrize(
    "age,availability", [(400, "stale"), (90000, "unavailable"), (-60, "unavailable")]
)
def test_freshness_and_future_timestamps(stored, age, availability):
    stored["runtime"][0] = record("worker_live", {"pending_count": 0}, age=age)
    assert (
        observations.get_observability_summary()["data"]["sources"]["worker_live"][
            "availability"
        ]
        == availability
    )


@pytest.mark.parametrize(
    "args",
    [
        {"track_uids": UIDS},
        {"track_uids": ["not-a-uuid"]},
        {"track_uids": UIDS[:1] * 2},
        {"refresh": True},
    ],
)
def test_smart_mix_closed_schema_rejects_unbounded_or_effectful_inputs(args):
    with pytest.raises(ValidationError):
        SmartMixStatusInput(**args)


def test_schema_and_direct_calls_reject_unknown_pipeline_and_unbounded_tracks(stored):
    assert len(SmartMixStatusInput(track_uids=UIDS[:50]).track_uids) == 50
    with pytest.raises(ValidationError):
        PipelineInput(pipeline="shell")
    with pytest.raises(DiagnosticError):
        observations.get_pipeline_status("shell")
    for uids in (UIDS, ["bad"], UIDS[:1] * 2):
        with pytest.raises(DiagnosticError):
            observations.get_smart_mix_status(uids)
    with pytest.raises(ValueError):
        read_observation_evidence(track_uids=UIDS)
    with pytest.raises(ValueError):
        read_observation_evidence(pipeline="shell")


def test_version_mismatch_and_invalidation_never_rejuvenate_expired_evidence(stored):
    stored["runtime"][3] = record(
        "smart_mix:coverage",
        {"analyzer_version": "old", "profile_version": 1},
        age=90000,
    )
    stored["runtime"][4] = record(
        "smart_mix:backfill_campaign", {"target": "old", "status": "running"}, age=90000
    )
    stored["snapshots"] = [
        record(
            "ops",
            {"eventing": {"outbox": {"pending": 0}}},
            age=90000,
            invalidated_at=str(NOW),
        )
    ]
    assert all(
        source["availability"] == "unavailable"
        for source in observations.get_smart_mix_status()["data"]["sources"].values()
    )
    assert (
        observations.get_pipeline_status("projector")["data"]["sources"]["outbox"][
            "availability"
        ]
        == "unavailable"
    )


def test_malformed_stored_nested_payloads_are_explicitly_missing(stored):
    stored["snapshots"] = [
        record("ops:stack", {"containers": {}, "available": True}),
        record("ops", {"eventing": "bad"}),
    ]
    assert (
        observations.get_instance_inventory()["data"]["services"]["crate-api"][
            "availability"
        ]
        == "unavailable"
    )
    assert (
        observations.get_pipeline_status("projector")["data"]["sources"]["outbox"][
            "availability"
        ]
        == "unavailable"
    )


def test_fifty_exact_profiles_respect_transport_byte_budget_and_report_omissions(
    stored,
):
    stored["profiles"] = [
        {
            "track_uid": uid,
            "profile_version": 1,
            "analyzer_version": "v" * 128,
            "profile_revision": "r" * 128,
            "source_revision": "s" * 128,
            "quality": "full",
            "analyzed_at": str(NOW),
            "source_stale_at": None,
            "processing_state": "pending",
            "attempts": 3,
            "target_generation": "t" * 128,
            "completed_at": str(NOW),
            "processing_updated_at": str(NOW),
        }
        for uid in UIDS[:50]
    ]
    result = observations.get_smart_mix_status(UIDS[:50])
    returned = [item["track_uid"] for item in result["data"]["tracks"]]
    omitted = result["data"]["omitted_track_uids"]
    assert result["truncated"] and omitted
    assert returned + omitted == UIDS[:50]
    assert result["returned_count"] == len(returned)
    assert len(json.dumps(result, ensure_ascii=False).encode()) < 60000


def test_sanitized_display_budget_reports_source_unavailable(stored):
    stored["runtime"][3]["payload"]["versions"] = [
        {"version": "x" * 512, "count": "y" * 512}
    ] * 20
    source = observations.get_smart_mix_status()["data"]["sources"]["coverage"]
    assert source["availability"] == "unavailable" and source["data"] is None
    assert source["truncated"] and "12000 byte" in source["reason"]


@pytest.mark.parametrize(
    "image",
    [
        "https://user:private-password@registry/repo",
        "user:private-password@registry/repo",
        "crate_mcp_private-password",
    ],
)
def test_inventory_rejects_credential_like_image_references(stored, image):
    stored["snapshots"] = [
        record(
            "ops:stack",
            {
                "available": True,
                "containers": [
                    {"name": "crate-api", "image": image, "state": "running"}
                ],
            },
        )
    ]
    source = observations.get_instance_inventory()["data"]["services"]["crate-api"]
    assert source["availability"] == "unavailable"
    assert "private-password" not in json.dumps(source)
