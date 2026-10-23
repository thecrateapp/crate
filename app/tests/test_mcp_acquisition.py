"""SDK boundary tests for acquisition discovery, closed inputs and UTF-8 budgets."""

import asyncio
import json
from dataclasses import replace
from uuid import uuid4

import pytest
from crate import agent_acquisition as acquisition
from crate.mcp.acquisition_schemas import AcquisitionPreview

from tests.test_mcp_transport import _client
from tests.test_mcp_transport import diagnostic_boundary as diagnostic_boundary  # noqa: PLC0414
from tests.test_mcp_transport import transport_app as transport_app  # noqa: PLC0414


def test_sdk_search_whole_receipts_stay_bounded_in_utf8(
    monkeypatch, transport_app, diagnostic_boundary
):
    app, tokens, principals = transport_app
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    principals[tokens["all"]] = replace(
        principals[tokens["all"]],
        grants=frozenset({"library.acquisition.search", "library.acquisition.write"}),
    )
    monkeypatch.setattr(acquisition, "_supported_provider", lambda: "0.26.1")
    monkeypatch.setattr(acquisition.store, "authorize_search", lambda _: None)
    monkeypatch.setattr(acquisition, "_provider_version", lambda: "a" * 64)
    monkeypatch.setattr("crate.soulseek._api_key", lambda: "synthetic")
    monkeypatch.setattr(acquisition.time, "sleep", lambda _: None)
    search_id = str(uuid4())
    raw = [
        {
            "username": f"peer{i}",
            "files": [
                {
                    "filename": "Artist\\Album\\" + "𐀀" * 100 + str(n) + ".flac",
                    "size": 100,
                    "bitDepth": 16,
                    "sampleRate": 44100,
                }
                for n in range(20)
            ],
        }
        for i in range(5)
    ]
    calls = []

    def transport(method, endpoint, body=None):
        calls.append(endpoint)
        return {"id": search_id} if endpoint == "searches" else raw

    monkeypatch.setattr(acquisition, "_transport", transport)
    monkeypatch.setattr(
        acquisition.store,
        "save_receipts",
        lambda principal, sources: [
            {"receipt_id": str(uuid4()), "source": source, "valid_for_seconds": 900}
            for source in sources
        ],
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            _client(app, tokens["all"]) as client,
        ):
            tools = {t.name: t for t in (await client.list_tools()).tools}
            assert (
                tools["preview_acquisition"].input_schema["additionalProperties"]
                is False
            )
            response = await client.call_tool(
                "search_acquisition", {"provider": "soulseek", "query": "Artist Album"}
            )
            assert not response.is_error
            payload = response.structured_content
            rows = payload["data"]["results"]
            assert 0 < len(rows) < 5
            assert all(len(row["source"]["files"]) == 20 for row in rows)
            assert len(json.dumps(payload, ensure_ascii=False).encode()) < 55000
            forged = await client.call_tool(
                "preview_acquisition",
                {
                    "receipt_id": str(uuid4()),
                    "artist_uid": str(uuid4()),
                    "max_items": 1,
                    "max_bytes": 1000,
                    "max_cost_minor": 0,
                    "destination_policy": "provider_staging_only",
                    "idempotency_key": "test",
                    "files": [{"url": "http://127.0.0.1/forged"}],
                },
            )
            assert forged.is_error

    asyncio.run(run())
    assert all("transfers" not in endpoint for endpoint in calls)


def test_closed_preview_rejects_urls_paid_caps_and_unbounded_counts():
    from pydantic import ValidationError

    base = {
        "receipt_id": str(uuid4()),
        "artist_uid": str(uuid4()),
        "max_items": 1,
        "max_bytes": 1000,
        "max_cost_minor": 0,
        "destination_policy": "provider_staging_only",
        "idempotency_key": "test",
    }
    for change in (
        {"url": "https://example.test"},
        {"max_cost_minor": 1},
        {"max_items": 51},
        {"max_bytes": 2147483649},
        {"provider": "custom"},
    ):
        with pytest.raises(ValidationError):
            AcquisitionPreview.model_validate({**base, **change})
