import pytest

from crate import geolocation


@pytest.fixture(autouse=True)
def no_existing_show_candidates(monkeypatch):
    monkeypatch.setattr(
        "crate.db.queries.shows_location_queries.get_show_venue_location_candidates",
        lambda *args, **kwargs: [],
    )


def test_geocode_venue_matches_venue_and_city_and_caches_for_a_year(monkeypatch):
    writes = []
    queries = []

    def search(params):
        queries.append(params)
        return [
            {
                "name": "Nazca",
                "lat": "40.421",
                "lon": "-3.701",
                "display_name": "Nazca, Madrid, Spain",
                "address": {
                    "city": "Madrid",
                    "road": "Calle de Orense",
                    "house_number": "24",
                    "postcode": "28020",
                    "country": "España",
                    "country_code": "es",
                },
            }
        ]

    monkeypatch.setattr(geolocation, "_nominatim_search", search)
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "crate.db.cache_store.set_cache",
        lambda key, value, ttl=None: writes.append((key, value, ttl)),
    )

    result = geolocation.geocode_venue(
        "Sala Nazca", "Madrid", country="España", country_code="ES"
    )

    assert result == {
        "address_line1": "Calle de Orense 24",
        "postal_code": "28020",
        "country": "España",
        "country_code": "ES",
        "latitude": 40.421,
        "longitude": -3.701,
        "source": "openstreetmap",
    }
    assert writes[0][2] == 365 * 86400
    assert writes[0][1]["result"] == result
    assert queries[0]["limit"] == 5
    assert queries[0]["countrycodes"] == "es"


def test_geocode_venue_rejects_venue_or_city_mismatch(monkeypatch):
    writes = []
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: [
            {
                "name": "Sala Nazca",
                "lat": "40.421",
                "lon": "-3.701",
                "display_name": "Sala Nazca, Barcelona, Spain",
                "address": {
                    "city": "Barcelona",
                    "country_code": "es",
                },
            },
            {
                "name": "Sala Norte",
                "lat": "40.421",
                "lon": "-3.701",
                "display_name": "Sala Norte, Madrid, Spain",
                "address": {"city": "Madrid", "country_code": "es"},
            },
            {
                "name": "Sala Nazca II",
                "lat": "40.421",
                "lon": "-3.701",
                "display_name": "Sala Nazca II, Madrid, Spain",
                "address": {"city": "Madrid", "country_code": "es"},
            },
        ],
    )
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "crate.db.cache_store.set_cache",
        lambda key, value, ttl=None: writes.append((key, value, ttl)),
    )

    result = geolocation.geocode_venue("Sala Nazca", "Madrid")

    assert result is None
    assert writes[0][1] == {"result": None}
    assert writes[0][2] == 7 * 86400


def test_geocode_venue_does_not_treat_venue_name_as_city_match(monkeypatch):
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: [
            {
                "name": "Sala Madrid",
                "lat": "41.4",
                "lon": "2.1",
                "display_name": "Sala Madrid, Barcelona, Spain",
                "address": {"city": "Barcelona", "country_code": "es"},
            }
        ],
    )

    assert geolocation.geocode_venue("Sala Madrid", "Madrid") is None


def test_geocode_venue_uses_cached_result_without_calling_nominatim(monkeypatch):
    cached_result = {
        "address_line1": "Calle Uno 1",
        "latitude": 40.4,
        "longitude": -3.7,
    }
    monkeypatch.setattr(
        "crate.db.cache_store.get_cache",
        lambda key, max_age_seconds=None: {"result": cached_result},
    )
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: (_ for _ in ()).throw(
            AssertionError("cache should be read first")
        ),
    )

    assert geolocation.geocode_venue("Sala Uno", "Madrid") == {
        **cached_result,
        "source": "openstreetmap",
    }


def test_geocode_venue_prefers_existing_crate_show_before_cache(monkeypatch):
    stored = {
        "venue": "Nazca",
        "city": "Madrid",
        "region": "Madrid",
        "country": "Spain",
        "country_code": "ES",
        "address_line1": "Calle de Orense 24",
        "postal_code": "28020",
        "latitude": 40.421,
        "longitude": -3.701,
    }
    monkeypatch.setattr(
        "crate.db.queries.shows_location_queries.get_show_venue_location_candidates",
        lambda venue, city, **kwargs: [stored],
    )
    monkeypatch.setattr(
        "crate.db.cache_store.get_cache",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("existing Crate show should be checked before cache")
        ),
    )
    monkeypatch.setattr(
        "crate.db.cache_store.set_cache",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Crate records should not be copied into the geo cache")
        ),
    )
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: (_ for _ in ()).throw(
            AssertionError("existing Crate show should be checked before Nominatim")
        ),
    )

    result = geolocation.geocode_venue(
        "Sala Nazca", "Madrid", country="España", country_code="ES"
    )

    assert result == {
        "address_line1": "Calle de Orense 24",
        "postal_code": "28020",
        "country": "Spain",
        "country_code": "ES",
        "latitude": 40.421,
        "longitude": -3.701,
        "source": "crate_shows",
    }


def test_geocode_venue_rejects_existing_show_from_another_country(monkeypatch):
    monkeypatch.setattr(
        "crate.db.queries.shows_location_queries.get_show_venue_location_candidates",
        lambda *args, **kwargs: [
            {
                "venue": "Sala Uno",
                "city": "Madrid",
                "country": "Spain",
                "country_code": "ES",
                "address_line1": "Calle Uno 1",
                "latitude": 40.4,
                "longitude": -3.7,
            }
        ],
    )
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(geolocation, "_nominatim_search", lambda params: [])

    assert (
        geolocation.geocode_venue(
            "Sala Uno", "Madrid", country_code="PT", country="Portugal"
        )
        is None
    )


def test_geocode_venue_requires_venue_and_city(monkeypatch):
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: (_ for _ in ()).throw(AssertionError("no query expected")),
    )

    assert geolocation.geocode_venue("Sala Uno", "") is None


def test_geocode_city_uses_serialized_nominatim_search(monkeypatch):
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: [
            {
                "lat": "40.4",
                "lon": "-3.7",
                "display_name": "Madrid, Spain",
                "address": {"city": "Madrid", "country": "Spain", "country_code": "es"},
            }
        ],
    )

    result = geolocation.geocode_city("Madrid")

    assert result["city"] == "Madrid"
    assert result["latitude"] == 40.4


def test_search_cities_uses_serialized_nominatim_search(monkeypatch):
    monkeypatch.setattr("crate.db.cache_store.get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.db.cache_store.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        geolocation,
        "_nominatim_search",
        lambda params: [
            {
                "lat": "40.4",
                "lon": "-3.7",
                "name": "Madrid",
                "address": {"city": "Madrid", "country": "Spain", "country_code": "es"},
            }
        ],
    )

    result = geolocation.search_cities("Mad")

    assert result == [
        {
            "city": "Madrid",
            "country": "Spain",
            "country_code": "ES",
            "display_name": "Madrid, Spain",
            "latitude": 40.4,
            "longitude": -3.7,
        }
    ]
