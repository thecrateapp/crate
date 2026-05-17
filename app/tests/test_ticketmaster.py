from crate import ticketmaster


def test_ticketmaster_artist_match_rejects_tributes():
    assert ticketmaster._artist_names_match("Placebo", "Placebo")
    assert ticketmaster._artist_names_match("The Cure", "Cure")
    assert not ticketmaster._matching_attractions(
        [{"name": "Placebo Tribute Experience"}],
        "Placebo",
    )


def test_ticketmaster_search_uses_attraction_and_location(monkeypatch):
    calls = []

    monkeypatch.setattr(ticketmaster, "_api_key", lambda: "tm-key")
    monkeypatch.setattr(ticketmaster, "get_cache", lambda key: None)
    monkeypatch.setattr(ticketmaster, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        ticketmaster,
        "_search_attractions",
        lambda artist_name: [{"id": "K8vZ91713eV", "name": artist_name}],
    )

    class Response:
        status_code = 200

        def json(self):
            return {
                "_embedded": {
                    "events": [
                        {
                            "id": "event-1",
                            "name": "Placebo",
                            "url": "https://tickets.example.test/placebo",
                            "dates": {
                                "start": {
                                    "localDate": "2026-07-01",
                                    "localTime": "20:00:00",
                                },
                                "status": {"code": "onsale"},
                            },
                            "_embedded": {
                                "attractions": [
                                    {"id": "K8vZ91713eV", "name": "Placebo"}
                                ],
                                "venues": [
                                    {
                                        "name": "Movistar Arena",
                                        "city": {"name": "Madrid"},
                                        "country": {
                                            "name": "Spain",
                                            "countryCode": "ES",
                                        },
                                        "location": {
                                            "latitude": "40.4168",
                                            "longitude": "-3.7038",
                                        },
                                    }
                                ],
                            },
                        },
                    ]
                }
            }

    def fake_get(url, params, timeout):
        calls.append(params)
        return Response()

    monkeypatch.setattr(ticketmaster.requests, "get", fake_get)

    events = ticketmaster.search_events(
        "Placebo",
        country_code="ES",
        size=50,
        latitude=40.4168,
        longitude=-3.7038,
        radius_km=120,
    )

    assert len(events) == 1
    params = calls[0]
    assert params["attractionId"] == "K8vZ91713eV"
    assert "keyword" not in params
    assert params["countryCode"] == "ES"
    assert params["latlong"] == "40.416800,-3.703800"
    assert params["radius"] == "120"
    assert params["unit"] == "km"


def test_ticketmaster_search_filters_tribute_events(monkeypatch):
    monkeypatch.setattr(ticketmaster, "_api_key", lambda: "tm-key")
    monkeypatch.setattr(ticketmaster, "get_cache", lambda key: None)
    monkeypatch.setattr(ticketmaster, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(ticketmaster, "_search_attractions", lambda artist_name: [])

    class Response:
        status_code = 200

        def json(self):
            return {
                "_embedded": {
                    "events": [
                        {
                            "id": "tribute-1",
                            "name": "Placebo Tribute",
                            "dates": {"start": {"localDate": "2026-07-01"}},
                            "_embedded": {
                                "attractions": [{"name": "Placebo Tribute"}],
                                "venues": [{"name": "Venue"}],
                            },
                        }
                    ]
                }
            }

    monkeypatch.setattr(
        ticketmaster.requests, "get", lambda *args, **kwargs: Response()
    )

    assert ticketmaster.search_events("Placebo", size=20) == []
