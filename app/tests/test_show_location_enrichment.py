from unittest.mock import patch

import pytest

from crate.show_location_enrichment import enrich_show_draft_locations


def test_resolves_each_city_once_and_preserves_exact_coordinates():
    draft = {
        "candidates": [
            {"item_id": "one", "city": "Madrid", "country_code": "ES"},
            {"item_id": "two", "city": "Madrid", "country_code": "ES"},
            {
                "item_id": "exact",
                "city": "Madrid",
                "country_code": "ES",
                "latitude": 0,
                "longitude": 0,
            },
            {"item_id": "ambiguous", "city": "Cambridge"},
        ]
    }
    with patch(
        "crate.show_location_enrichment.geocode_city",
        return_value={"latitude": 40.4, "longitude": -3.7, "country_code": "ES"},
    ) as lookup:
        result = enrich_show_draft_locations(draft, cancelled=lambda: False)
    lookup.assert_called_once_with("Madrid, ES")
    assert (
        result["candidates"][0]["latitude"]
        == result["candidates"][1]["latitude"]
        == 40.4
    )
    assert result["candidates"][2]["latitude"] == 0
    assert "latitude" not in result["candidates"][3]
    assert "latitude" not in draft["candidates"][0]
    assert result["location_enrichment"][0]["precision"] == "city"
    assert result["warnings"]


@pytest.mark.parametrize(
    "response",
    [
        None,
        {"country_code": "US", "latitude": 40, "longitude": -3},
        {"country_code": "ES", "latitude": float("nan"), "longitude": 0},
    ],
)
def test_unknown_or_wrong_country_remains_unknown(response):
    draft = {"candidates": [{"city": "Madrid", "country_code": "ES"}]}
    with patch("crate.show_location_enrichment.geocode_city", return_value=response):
        assert (
            "latitude"
            not in enrich_show_draft_locations(draft, cancelled=lambda: False)[
                "candidates"
            ][0]
        )


def test_cancelled_and_exhausted_jobs_do_not_lookup():
    draft = {"candidates": [{"city": "Madrid", "country_code": "ES"}]}
    with patch("crate.show_location_enrichment.geocode_city") as lookup:
        with pytest.raises(ValueError, match="CANCELLED"):
            enrich_show_draft_locations(draft, cancelled=lambda: True)
        assert (
            enrich_show_draft_locations(
                draft, cancelled=lambda: False, budget_seconds=0
            )
            == draft
        )
    lookup.assert_not_called()
