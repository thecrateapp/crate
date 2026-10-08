"""HTTP contract and authorization tests for Listen Crates."""

from uuid import uuid4

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def crate_api_client(test_app, monkeypatch):
    from crate.api.auth import AuthMiddleware

    async def resolve_test_user(self, request):
        user_id = request.headers.get("x-test-user")
        if not user_id:
            return None
        return {
            "id": int(user_id),
            "role": "user",
            "username": f"crate-user-{user_id}",
            "name": f"Crate user {user_id}",
        }

    monkeypatch.setattr(AuthMiddleware, "resolve_user", resolve_test_user)
    monkeypatch.setenv("CRATE_LISTEN_PUBLIC_BASE_URL", "https://listen.testserver")
    return test_app


def _headers(user_id: int) -> dict[str, str]:
    return {"x-test-user": str(user_id)}


def _create_user(email: str) -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO users (email, name, password_hash, created_at)
                    VALUES (:email, 'Crate API user', 'test-hash', NOW())
                    RETURNING id
                    """
                ),
                {"email": email},
            ).scalar_one()
        )


def _create_crate(*, owner_id: int = 1, is_collaborative: bool = False) -> str:
    from crate.db.repositories.crates import create_crate

    return create_crate(
        owner_id=owner_id,
        name="API crate",
        is_collaborative=is_collaborative,
    )


def _add_member(crate_id: str, user_id: int, *, invited_by: int = 1) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO crate_members (crate_id, user_id, invited_by)
                VALUES (CAST(:crate_id AS uuid), :user_id, :invited_by)
                """
            ),
            {"crate_id": crate_id, "user_id": user_id, "invited_by": invited_by},
        )


def _seed_album(title: str) -> str:
    from crate.db.tx import transaction_scope

    artist_uid = str(uuid4())
    album_uid = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists (
                    global_artist_uid, canonical_name, sort_name, normalized_name
                ) VALUES (:uid, :name, :name, :name)
                """
            ),
            {"uid": artist_uid, "name": f"Artist {artist_uid[:8]}"},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums (
                    global_album_uid, global_artist_uid, canonical_name,
                    normalized_name, artist_name
                ) VALUES (:uid, :artist_uid, :title, :title, 'API Test Artist')
                """
            ),
            {"uid": album_uid, "artist_uid": artist_uid, "title": title},
        )
    return album_uid


def _seed_playback_track(album_uid: str, title: str, *, available: bool = True) -> str:
    from crate.db.tx import transaction_scope

    track_uid = str(uuid4())
    with transaction_scope() as session:
        artist_uid = session.execute(
            text(
                """
                SELECT global_artist_uid::text
                FROM global_catalog_albums
                WHERE global_album_uid = CAST(:album_uid AS uuid)
                """
            ),
            {"album_uid": album_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks (
                    global_track_uid, global_album_uid, global_artist_uid,
                    canonical_title, normalized_title, artist_name, album_name,
                    disc_number, track_number, duration_seconds, has_local
                ) VALUES (
                    CAST(:track_uid AS uuid), CAST(:album_uid AS uuid),
                    CAST(:artist_uid AS uuid), :title, :title, 'API Test Artist',
                    'API Test Album', 1, 1, 180, :available
                )
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "artist_uid": artist_uid,
                "title": title,
                "available": available,
            },
        )
    return track_uid


def test_create_defaults_private_and_requires_authentication(pg_db, crate_api_client):
    response = crate_api_client.post(
        "/api/crates",
        json={
            "name": "Year-end records",
            "is_ordered": False,
            "sort_direction": "desc",
            "loop_enabled": True,
        },
        headers=_headers(1),
    )
    assert response.status_code == 201
    crate_id = response.json()["id"]

    detail = crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(1))
    assert detail.status_code == 200
    assert detail.json()["visibility"] == "private"
    assert detail.json()["is_ordered"] is False
    assert detail.json()["sort_direction"] == "desc"
    assert detail.json()["loop_enabled"] is True
    assert detail.json()["albums"] == []

    listing = crate_api_client.get("/api/me/crates", headers=_headers(1))
    assert listing.status_code == 200
    assert [crate["id"] for crate in listing.json()] == [crate_id]
    alias_listing = crate_api_client.get("/api/crates", headers=_headers(1))
    assert alias_listing.status_code == 200
    assert [crate["id"] for crate in alias_listing.json()] == [crate_id]
    assert crate_api_client.get(f"/api/crates/{crate_id}").status_code == 404
    assert (
        crate_api_client.post(
            "/api/crates", json={"name": "   "}, headers=_headers(1)
        ).status_code
        == 422
    )


def test_create_accepts_public_visibility_and_descending_order(pg_db, crate_api_client):
    response = crate_api_client.post(
        "/api/crates",
        json={
            "name": "Best of 2026",
            "visibility": "public",
            "is_ordered": True,
            "sort_direction": "desc",
        },
        headers=_headers(1),
    )

    assert response.status_code == 201
    detail = crate_api_client.get(f"/api/crates/{response.json()['id']}")
    assert detail.status_code == 200
    assert detail.json()["visibility"] == "public"
    assert detail.json()["is_ordered"] is True
    assert detail.json()["sort_direction"] == "desc"


def test_public_crate_detail_is_readable_without_authentication(
    pg_db, crate_api_client
):
    from crate.db.repositories.crates import create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Public records")
    assert update_crate(crate_id, visibility="public", actor_id=1)

    response = crate_api_client.get(f"/api/crates/{crate_id}")

    assert response.status_code == 200
    assert response.json()["name"] == "Public records"
    assert response.json()["access"] == "public"


def test_anonymous_detail_hides_private_crates_and_member_data(pg_db, crate_api_client):
    from crate.db.repositories.crates import create_crate, update_crate

    member_id = _create_user(f"crate-anon-member-{uuid4()}@example.test")
    public_crate_id = create_crate(
        owner_id=1, name="Public collaborative", is_collaborative=True
    )
    private_crate_id = create_crate(owner_id=1, name="Private records")
    assert update_crate(public_crate_id, visibility="public", actor_id=1)
    _add_member(public_crate_id, member_id)

    public_detail = crate_api_client.get(f"/api/crates/{public_crate_id}")
    assert public_detail.status_code == 200
    payload = public_detail.json()
    assert payload["access"] == "public"
    assert payload["is_followed"] is False
    assert "members" not in payload
    assert "invites" not in payload

    assert crate_api_client.get(f"/api/crates/{private_crate_id}").status_code == 404
    assert crate_api_client.get("/api/crates/not-a-uuid").status_code == 404


def test_public_crate_can_be_followed_and_unfollowed(pg_db, crate_api_client):
    from crate.db.repositories.crates import create_crate, update_crate

    viewer_id = _create_user(f"crate-follow-viewer-{uuid4()}@example.test")
    public_crate_id = create_crate(owner_id=1, name="Public followed records")
    private_crate_id = create_crate(owner_id=1, name="Private records")
    assert update_crate(public_crate_id, visibility="public", actor_id=1)

    initial = crate_api_client.get(
        f"/api/crates/{public_crate_id}", headers=_headers(viewer_id)
    )
    assert initial.status_code == 200
    assert initial.json()["follower_count"] == 0
    assert initial.json()["is_followed"] is False

    follow = crate_api_client.post(
        f"/api/crates/{public_crate_id}/follow", headers=_headers(viewer_id)
    )
    assert follow.status_code == 200

    followed = crate_api_client.get(
        f"/api/crates/{public_crate_id}", headers=_headers(viewer_id)
    )
    assert followed.json()["follower_count"] == 1
    assert followed.json()["is_followed"] is True
    assert (
        crate_api_client.get(
            f"/api/crates/{public_crate_id}", headers=_headers(1)
        ).json()["is_followed"]
        is False
    )

    repeated = crate_api_client.post(
        f"/api/crates/{public_crate_id}/follow", headers=_headers(viewer_id)
    )
    assert repeated.status_code == 200
    assert (
        crate_api_client.get(
            f"/api/crates/{public_crate_id}", headers=_headers(viewer_id)
        ).json()["follower_count"]
        == 1
    )

    unfollow = crate_api_client.delete(
        f"/api/crates/{public_crate_id}/follow", headers=_headers(viewer_id)
    )
    assert unfollow.status_code == 200
    assert (
        crate_api_client.get(
            f"/api/crates/{public_crate_id}", headers=_headers(viewer_id)
        ).json()["is_followed"]
        is False
    )

    private_follow = crate_api_client.post(
        f"/api/crates/{private_crate_id}/follow", headers=_headers(viewer_id)
    )
    assert private_follow.status_code == 404
    missing_follow = crate_api_client.post(
        f"/api/crates/{uuid4()}/follow", headers=_headers(viewer_id)
    )
    assert missing_follow.status_code == 404
    assert (
        crate_api_client.post(f"/api/crates/{public_crate_id}/follow").status_code
        == 401
    )


def test_owner_cannot_follow_their_own_crate(pg_db, crate_api_client):
    from crate.db.repositories.crates import create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="My public records")
    assert update_crate(crate_id, visibility="public", actor_id=1)

    response = crate_api_client.post(
        f"/api/crates/{crate_id}/follow", headers=_headers(1)
    )

    assert response.status_code == 409
    assert (
        crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(1)).json()[
            "follower_count"
        ]
        == 0
    )


def test_followed_crates_list_newest_follow_first(pg_db, crate_api_client):
    from crate.db.repositories.crates import create_crate, update_crate
    from crate.db.tx import transaction_scope

    viewer_id = _create_user(f"crate-followed-list-{uuid4()}@example.test")
    older_id = create_crate(owner_id=1, name="Older follow")
    newer_id = create_crate(owner_id=1, name="Newer follow")
    hidden_id = create_crate(owner_id=1, name="Turned private")
    for crate_id in (older_id, newer_id, hidden_id):
        assert update_crate(crate_id, visibility="public", actor_id=1)
        assert (
            crate_api_client.post(
                f"/api/crates/{crate_id}/follow", headers=_headers(viewer_id)
            ).status_code
            == 200
        )
    album_uid = _seed_album("Followed album")
    crate_api_client.post(
        f"/api/crates/{newer_id}/albums",
        json={"global_album_uid": album_uid},
        headers=_headers(1),
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE crate_followers
                SET followed_at = NOW() - INTERVAL '1 day'
                WHERE crate_id = CAST(:crate_id AS uuid)
                """
            ),
            {"crate_id": older_id},
        )
    assert update_crate(hidden_id, visibility="private", actor_id=1)

    response = crate_api_client.get(
        "/api/me/crates/followed", headers=_headers(viewer_id)
    )

    assert response.status_code == 200
    rows = response.json()
    assert [row["id"] for row in rows] == [newer_id, older_id]
    assert rows[0]["is_followed"] is True
    assert rows[0]["follower_count"] == 1
    assert rows[0]["album_count"] == 1
    assert rows[0]["first_album"]["global_album_uid"] == album_uid
    assert crate_api_client.get("/api/me/crates/followed").status_code == 401


def test_public_crate_album_cover_is_scoped_to_public_crates(
    pg_db, crate_api_client, monkeypatch
):
    from fastapi.responses import Response

    from crate.api import catalog
    from crate.db.repositories.crates import add_crate_album, create_crate, update_crate

    served: list[str] = []
    monkeypatch.setattr(
        catalog,
        "serve_global_album_cover",
        lambda _request, album_uid, **_kwargs: (
            served.append(album_uid)
            or Response(content=b"cover", media_type="image/jpeg")
        ),
    )
    album_uid = _seed_album("Public cover")
    other_album_uid = _seed_album("Not in crate")
    public_id = create_crate(owner_id=1, name="Public covers")
    private_id = create_crate(owner_id=1, name="Private covers")
    assert update_crate(public_id, visibility="public", actor_id=1)
    add_crate_album(public_id, album_uid, added_by=1)
    add_crate_album(private_id, album_uid, added_by=1)

    public = crate_api_client.get(
        f"/share/image/crate/{public_id}/album/{album_uid}?size=256"
    )
    assert public.status_code == 200
    assert public.content == b"cover"
    public_ref = crate_api_client.get(f"/api/crates/{public_id}").json()["public_ref"]
    by_ref = crate_api_client.get(
        f"/share/image/crate/{public_ref}/album/{album_uid}", follow_redirects=False
    )
    assert by_ref.status_code == 200
    assert served == [album_uid, album_uid]

    assert (
        crate_api_client.get(
            f"/share/image/crate/{private_id}/album/{album_uid}"
        ).status_code
        == 404
    )
    assert (
        crate_api_client.get(
            f"/share/image/crate/{public_id}/album/{other_album_uid}"
        ).status_code
        == 404
    )
    assert (
        crate_api_client.get(
            f"/share/image/crate/{public_id}/album/{album_uid}?size=4096"
        ).status_code
        == 422
    )
    assert served == [album_uid, album_uid]


def test_crate_open_graph_image_is_a_cached_jpeg(pg_db, crate_api_client, monkeypatch):
    from io import BytesIO

    from PIL import Image

    from crate.api import share
    from crate.db.repositories.crates import add_crate_album, create_crate, update_crate

    store: dict[str, str] = {}

    class FakeRedis:
        def get(self, key):
            return store.get(key)

        def setex(self, key, _ttl, value):
            store[key] = value

    monkeypatch.setattr(share, "get_redis", lambda: FakeRedis())
    renders: list[str] = []
    original_render = share.render_crate_og_image
    monkeypatch.setattr(
        share,
        "render_crate_og_image",
        lambda **kwargs: renders.append(kwargs["title"]) or original_render(**kwargs),
    )
    crate_id = create_crate(owner_id=1, name="Open graph records")
    private_id = create_crate(owner_id=1, name="Hidden graph")
    assert update_crate(crate_id, visibility="public", actor_id=1)
    for title in ("First", "Second", "Third"):
        add_crate_album(crate_id, _seed_album(title), added_by=1)

    response = crate_api_client.get(
        f"/share/image/crate/{crate_id}", headers={"accept-language": "es-ES,es;q=0.9"}
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert "public" in response.headers["cache-control"]
    assert len(response.content) < 300_000
    with Image.open(BytesIO(response.content)) as image:
        assert image.format == "JPEG"
        assert image.size == (1200, 630)

    cached = crate_api_client.get(
        f"/share/image/crate/{crate_id}", headers={"accept-language": "es-ES"}
    )
    assert cached.content == response.content
    public_ref = crate_api_client.get(f"/api/crates/{crate_id}").json()["public_ref"]
    by_ref = crate_api_client.get(
        f"/share/image/crate/{public_ref}",
        headers={"accept-language": "es"},
        follow_redirects=False,
    )
    assert by_ref.status_code == 200
    assert by_ref.content == response.content
    assert renders == ["Open graph records"]
    assert len(store) == 1

    assert crate_api_client.get(f"/share/image/crate/{private_id}").status_code == 404
    assert crate_api_client.get(f"/share/image/crate/{uuid4()}").status_code == 404


def test_crate_share_landing_renders_localized_page_and_html_404(
    pg_db, crate_api_client
):
    from crate.db.repositories.crates import add_crate_album, create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Landing records", sort_direction="desc")
    private_id = create_crate(owner_id=1, name="Secret landing")
    assert update_crate(crate_id, visibility="public", actor_id=1)
    first_uid = _seed_album("Landing first")
    second_uid = _seed_album("Landing second")
    add_crate_album(crate_id, first_uid, added_by=1)
    add_crate_album(crate_id, second_uid, added_by=1)

    public_ref = crate_api_client.get(f"/api/crates/{crate_id}").json()["public_ref"]
    response = crate_api_client.get(
        f"/share/crate/{public_ref}",
        headers={
            "host": "listen.example.test",
            "x-forwarded-proto": "https",
            "accept-language": "ca-ES,ca;q=0.9,en;q=0.5",
        },
    )

    assert response.status_code == 200
    body = response.text
    assert '<html lang="ca">' in body
    assert 'property="og:locale" content="ca_ES"' in body
    assert (
        f'property="og:image" content="https://listen.example.test/share/image/crate/{public_ref}?lang=ca"'
        in body
    )
    assert 'property="og:image:width" content="1200"' in body
    assert 'property="og:image:height" content="630"' in body
    assert 'property="og:image:type" content="image/jpeg"' in body
    assert 'rel="icon"' in body
    assert "Obre a Crate" in body
    assert f'href="https://listen.example.test/crate/{public_ref}"' in body
    assert f"/album/{first_uid}" not in body
    assert body.index("Landing second") < body.index("Landing first")
    assert "2 àlbums" in body

    for missing in (
        f"/share/crate/{private_id}",
        "/share/crate/not-a-uuid",
        "/share/crate/landing-records-ZZZZZZZZ",
    ):
        not_found = crate_api_client.get(missing, headers={"accept-language": "es"})
        assert not_found.status_code == 404
        assert not_found.headers["content-type"].startswith("text/html")
        assert '<html lang="es">' in not_found.text
        assert "Crate no encontrado" in not_found.text
        assert "Secret landing" not in not_found.text


def test_crates_get_short_codes_and_resolve_by_uuid_or_public_ref(
    pg_db, crate_api_client
):
    from crate.db.repositories.crates import create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Año Nuevo: Mix!")
    assert update_crate(crate_id, visibility="public", actor_id=1)

    detail = crate_api_client.get(f"/api/crates/{crate_id}").json()
    short_code = detail["short_code"]
    assert len(short_code) == 8 and short_code.isalnum()
    assert detail["public_ref"] == f"ano-nuevo-mix-{short_code}"

    for ref in (
        detail["public_ref"],
        f"stale-name-{short_code}",
        short_code,
        crate_id.upper(),
    ):
        response = crate_api_client.get(f"/api/crates/{ref}")
        assert response.status_code == 200, ref
        assert response.json()["id"] == crate_id

    assert crate_api_client.get("/api/crates/ano-nuevo-mix-ZZZZZZZZ").status_code == 404
    assert crate_api_client.get("/api/crates/ano-nuevo-mix-abc").status_code == 404

    listing = crate_api_client.get("/api/me/crates", headers=_headers(1)).json()
    assert {row["public_ref"] for row in listing} >= {detail["public_ref"]}


def test_crate_short_code_generation_retries_collisions(pg_db, monkeypatch):
    from crate.db.queries.crates import get_crate
    from crate.db.repositories import crates as crate_repo

    first_id = crate_repo.create_crate(owner_id=1, name="First code")
    taken = get_crate(first_id)["short_code"]
    codes = iter([taken, "Fresh123"])
    monkeypatch.setattr(crate_repo, "generate_crate_short_code", lambda: next(codes))

    second_id = crate_repo.create_crate(owner_id=1, name="Second code")

    assert get_crate(second_id)["short_code"] == "Fresh123"
    assert get_crate(first_id)["short_code"] == taken


def test_generated_crate_short_codes_are_base62():
    from crate.db.repositories.crates import (
        SHORT_CODE_ALPHABET,
        generate_crate_short_code,
    )

    codes = {generate_crate_short_code() for _ in range(200)}
    assert len(codes) == 200
    assert all(len(code) == 8 for code in codes)
    assert all(set(code) <= set(SHORT_CODE_ALPHABET) for code in codes)


def test_share_landing_redirects_to_canonical_public_ref(pg_db, crate_api_client):
    from crate.db.repositories.crates import create_crate, update_crate

    crate_id = create_crate(owner_id=1, name="Canonical records")
    assert update_crate(crate_id, visibility="public", actor_id=1)
    public_ref = crate_api_client.get(f"/api/crates/{crate_id}").json()["public_ref"]
    short_code = public_ref.rsplit("-", 1)[-1]
    headers = {"host": "listen.example.test", "x-forwarded-proto": "https"}

    for legacy in (crate_id, f"old-name-{short_code}"):
        response = crate_api_client.get(
            f"/share/crate/{legacy}", headers=headers, follow_redirects=False
        )
        assert response.status_code == 301
        assert (
            response.headers["location"]
            == f"https://listen.example.test/share/crate/{public_ref}"
        )

    canonical = crate_api_client.get(f"/share/crate/{public_ref}", headers=headers)
    assert canonical.status_code == 200
    assert (
        f'property="og:url" content="https://listen.example.test/share/crate/{public_ref}"'
        in canonical.text
    )


def test_crate_presentation_settings_can_be_updated(pg_db, crate_api_client):
    crate_id = _create_crate()

    response = crate_api_client.put(
        f"/api/crates/{crate_id}",
        json={"is_ordered": False, "sort_direction": "desc", "loop_enabled": True},
        headers=_headers(1),
    )

    assert response.status_code == 200
    detail = crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(1))
    assert detail.json()["is_ordered"] is False
    assert detail.json()["sort_direction"] == "desc"
    assert detail.json()["loop_enabled"] is True


def test_editor_payload_persists_ordering_for_detail_and_list(pg_db, crate_api_client):
    crate_id = _create_crate()
    crate_api_client.put(
        f"/api/crates/{crate_id}",
        json={"is_ordered": False},
        headers=_headers(1),
    )

    response = crate_api_client.put(
        f"/api/crates/{crate_id}",
        json={
            "name": "API crate",
            "description": "",
            "visibility": "public",
            "is_collaborative": False,
            "is_ordered": True,
            "sort_direction": "asc",
            "loop_enabled": False,
        },
        headers=_headers(1),
    )

    assert response.status_code == 200
    detail = crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(1))
    assert detail.json()["is_ordered"] is True
    assert detail.json()["sort_direction"] == "asc"
    assert detail.json()["visibility"] == "public"
    listed = crate_api_client.get("/api/me/crates", headers=_headers(1)).json()
    saved = next(crate for crate in listed if crate["id"] == crate_id)
    assert saved["is_ordered"] is True
    assert saved["sort_direction"] == "asc"


def test_crate_detail_uses_accessible_crate_query(monkeypatch):
    from types import SimpleNamespace

    from crate.api import crates as crate_routes

    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(
        crate_routes,
        "get_crate_detail_for_user",
        lambda crate_id, user_id: (
            calls.append((crate_id, user_id))
            or (
                {"id": "crate-id", "albums": []},
                "owner",
                [
                    {"name": "post-punk", "slug": "post-punk", "weight": 1.5},
                    {"name": "noise rock", "slug": "noise-rock", "weight": 0.5},
                ],
            )
        ),
    )

    crate_id = uuid4()
    request = SimpleNamespace(state=SimpleNamespace(user={"id": 1}))
    result = crate_routes.get_one(request, crate_id)

    assert result["access"] == "owner"
    assert calls == [(str(crate_id), 1)]
    assert [(genre["name"], genre["percent"]) for genre in result["genre_profile"]] == [
        ("post-punk", 100),
        ("noise rock", 33),
    ]


def test_crate_playback_uses_accessible_tracks_query(monkeypatch):
    from crate.api import crates as crate_routes

    monkeypatch.setattr(crate_routes, "_require_auth", lambda _request: {"id": 1})
    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(
        crate_routes,
        "get_crate_playback_tracks_for_user",
        lambda crate_id, user_id: calls.append((crate_id, user_id)) or [],
    )

    crate_id = uuid4()
    assert crate_routes.playback(None, crate_id) == []
    assert calls == [(str(crate_id), 1)]


def test_crate_offline_manifest_rejects_invalid_crate_ids(pg_db, crate_api_client):
    response = crate_api_client.get(
        "/api/offline/crates/not-a-uuid/manifest", headers=_headers(1)
    )
    assert response.status_code == 422

    missing = crate_api_client.get(
        f"/api/offline/crates/{uuid4()}/manifest", headers=_headers(1)
    )
    assert missing.status_code == 404


def test_crate_offline_manifest_uses_crate_identity(monkeypatch):
    from crate.api import offline as offline_routes

    crate_id = str(uuid4())
    monkeypatch.setattr(offline_routes, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(
        offline_routes,
        "get_crate_offline_tracks_for_user",
        lambda *_args: (
            {
                "id": crate_id,
                "name": "Year-end records",
                "album_count": 1,
                "updated_at": None,
            },
            [
                {
                    "id": 10,
                    "entity_uid": "track-uid",
                    "artist": "Artist",
                    "album": "Album",
                    "title": "Track",
                    "format": "flac",
                    "size": 5,
                    "updated_at": None,
                    "album_id": None,
                }
            ],
        ),
    )
    monkeypatch.setattr(offline_routes, "get_library_artist", lambda _name: None)

    manifest = offline_routes.get_crate_manifest(None, crate_id)

    assert manifest["kind"] == "crate"
    assert manifest["id"] == crate_id
    assert manifest["title"] == "Year-end records"
    assert manifest["track_count"] == 1


def test_private_crates_are_hidden_and_collaborators_cannot_manage_owner_settings(
    pg_db,
    crate_api_client,
):
    collaborator_id = _create_user(f"crate-collaborator-{uuid4()}@example.test")
    stranger_id = _create_user(f"crate-stranger-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    _add_member(crate_id, collaborator_id)
    url = f"/api/crates/{crate_id}"

    assert crate_api_client.get(url, headers=_headers(stranger_id)).status_code == 404
    assert (
        crate_api_client.get(url, headers=_headers(collaborator_id)).status_code == 200
    )

    edited = crate_api_client.put(
        url,
        json={"name": "Collaborator edit"},
        headers=_headers(collaborator_id),
    )
    assert edited.status_code == 200
    assert crate_api_client.get(url, headers=_headers(1)).json()["name"] == (
        "Collaborator edit"
    )

    assert (
        crate_api_client.put(
            url,
            json={"visibility": "public"},
            headers=_headers(collaborator_id),
        ).status_code
        == 403
    )
    members_response = crate_api_client.get(
        f"{url}/members", headers=_headers(collaborator_id)
    )
    assert members_response.status_code == 200
    assert [member["role"] for member in members_response.json()] == [
        "owner",
        "collaborator",
    ]
    removal_response = crate_api_client.delete(
        f"{url}/members/1", headers=_headers(collaborator_id)
    )
    assert removal_response.status_code == 403
    assert removal_response.json()["detail"] == (
        "Only the owner can manage Crate members"
    )
    invite_response = crate_api_client.post(
        f"{url}/invites",
        json={},
        headers=_headers(collaborator_id),
    )
    assert invite_response.status_code == 403
    assert invite_response.json()["detail"] == "Only the owner can manage Crate invites"
    delete_response = crate_api_client.delete(url, headers=_headers(collaborator_id))
    assert delete_response.status_code == 403
    assert delete_response.json()["detail"] == "Only the owner can delete this Crate"

    assert (
        crate_api_client.put(
            url,
            json={"visibility": "public"},
            headers=_headers(1),
        ).status_code
        == 200
    )
    public_detail = crate_api_client.get(url, headers=_headers(stranger_id))
    assert public_detail.status_code == 200
    assert public_detail.json()["access"] == "public"


def test_album_endpoints_validate_uniqueness_and_preserve_manual_order(
    pg_db,
    crate_api_client,
):
    from crate.db.repositories.crates import create_crate

    crate_id = create_crate(owner_id=1, name="Album API")
    album_ids = [_seed_album(f"API Album {index}") for index in range(3)]
    url = f"/api/crates/{crate_id}/albums"

    first = crate_api_client.post(
        url,
        json={"global_album_uid": album_ids[0]},
        headers=_headers(1),
    )
    assert first.status_code == 201
    assert (
        crate_api_client.post(
            url,
            json={"global_album_uid": album_ids[0]},
            headers=_headers(1),
        ).status_code
        == 409
    )
    assert (
        crate_api_client.post(
            url,
            json={"global_album_uid": str(uuid4())},
            headers=_headers(1),
        ).status_code
        == 404
    )
    for album_id in album_ids[1:]:
        assert (
            crate_api_client.post(
                url,
                json={"global_album_uid": album_id},
                headers=_headers(1),
            ).status_code
            == 201
        )

    detail_url = f"/api/crates/{crate_id}"
    assert [
        album["global_album_uid"]
        for album in crate_api_client.get(detail_url, headers=_headers(1)).json()[
            "albums"
        ]
    ] == album_ids

    reordered = list(reversed(album_ids))
    assert (
        crate_api_client.put(
            f"{url}/order",
            json={"global_album_uids": reordered},
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert (
        crate_api_client.put(
            f"{url}/order",
            json={"global_album_uids": reordered[:1]},
            headers=_headers(1),
        ).status_code
        == 422
    )
    assert (
        crate_api_client.delete(
            f"{url}/{reordered[0]}",
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert [
        album["global_album_uid"]
        for album in crate_api_client.get(detail_url, headers=_headers(1)).json()[
            "albums"
        ]
    ] == reordered[1:]


def test_add_album_returns_inserted_snapshot_if_album_is_removed_afterward(
    pg_db, crate_api_client, monkeypatch
):
    from crate.api import crates as crate_routes
    from crate.db.repositories.crates import (
        add_crate_album as add_album_to_repository,
        create_crate,
        remove_crate_album,
    )

    crate_id = create_crate(owner_id=1, name="Concurrent edit")
    album_uid = _seed_album("Removed immediately")

    def add_then_remove(crate_id_arg, album_uid_arg, *, added_by: int):
        inserted = add_album_to_repository(
            crate_id_arg, album_uid_arg, added_by=added_by
        )
        assert remove_crate_album(crate_id_arg, album_uid_arg, actor_id=added_by)
        return inserted

    monkeypatch.setattr(crate_routes, "add_crate_album", add_then_remove)

    response = crate_api_client.post(
        f"/api/crates/{crate_id}/albums",
        json={"global_album_uid": album_uid},
        headers=_headers(1),
    )

    assert response.status_code == 201
    assert response.json() == {
        "global_album_uid": album_uid,
        "position": 0,
        "name": "Removed immediately",
        "artist_name": "API Test Artist",
        "year": None,
        "has_cover": False,
        "artwork_source_json": {},
    }


def test_invites_are_owner_managed_and_acceptance_does_not_publish_crate(
    pg_db,
    crate_api_client,
    monkeypatch,
):
    monkeypatch.setenv("CRATE_LISTEN_PUBLIC_BASE_URL", "https://listen.example.test/")
    invitee_id = _create_user(f"crate-invitee-{uuid4()}@example.test")
    second_invitee_id = _create_user(f"crate-second-invitee-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    crate_url = f"/api/crates/{crate_id}"

    response = crate_api_client.post(
        f"{crate_url}/invites",
        json={"expires_in_hours": 168, "max_uses": 1},
        headers=_headers(1),
    )
    assert response.status_code == 201
    invite = response.json()
    token = invite["token"]
    assert invite["join_url"] == f"https://listen.example.test/crate/invite/{token}"
    assert invite["qr_value"] == invite["join_url"]
    assert (
        crate_api_client.get(
            f"/api/crates/invites/{token}", headers=_headers(invitee_id)
        ).status_code
        == 200
    )

    accepted = crate_api_client.post(
        f"/api/crates/invites/{token}/accept",
        headers=_headers(invitee_id),
    )
    assert accepted.status_code == 200
    assert accepted.json()["crate_id"] == crate_id
    assert (
        crate_api_client.get(
            f"/api/crates/invites/{token}", headers=_headers(invitee_id)
        ).status_code
        == 200
    )
    assert (
        crate_api_client.get(
            f"/api/crates/invites/{token}", headers=_headers(second_invitee_id)
        ).status_code
        == 404
    )
    detail = crate_api_client.get(crate_url, headers=_headers(invitee_id)).json()
    assert detail["visibility"] == "private"
    assert crate_id in {
        crate["id"]
        for crate in crate_api_client.get(
            "/api/me/crates", headers=_headers(invitee_id)
        ).json()
    }
    assert (
        crate_api_client.post(
            f"/api/crates/invites/{token}/accept",
            headers=_headers(second_invitee_id),
        ).status_code
        == 410
    )

    members = crate_api_client.get(f"{crate_url}/members", headers=_headers(1))
    assert members.status_code == 200
    assert [(member["user_id"], member["role"]) for member in members.json()] == [
        (1, "owner"),
        (invitee_id, "collaborator"),
    ]
    assert (
        crate_api_client.delete(
            f"{crate_url}/members/{invitee_id}",
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert [
        member["user_id"]
        for member in crate_api_client.get(
            f"{crate_url}/members", headers=_headers(1)
        ).json()
    ] == [1]


def test_active_invites_are_listed_for_the_owner_only(pg_db, crate_api_client):
    from crate.db.tx import transaction_scope

    collaborator_id = _create_user(f"crate-invite-list-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    _add_member(crate_id, collaborator_id)
    crate_url = f"/api/crates/{crate_id}"
    tokens = [
        crate_api_client.post(
            f"{crate_url}/invites", json=body, headers=_headers(1)
        ).json()["token"]
        for body in (
            {"expires_in_hours": 24, "max_uses": 3},
            {"expires_in_hours": 0, "max_uses": None},
            {"expires_in_hours": 24, "max_uses": 1},
            {"expires_in_hours": 24, "max_uses": 2},
            {"expires_in_hours": 24, "max_uses": 2},
        )
    ]
    active_token, unlimited_token, exhausted_token, expired_token, revoked_token = (
        tokens
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE crate_invites SET use_count = 1 WHERE token = :token"),
            {"token": exhausted_token},
        )
        session.execute(
            text(
                """
                UPDATE crate_invites
                SET expires_at = NOW() - INTERVAL '1 minute'
                WHERE token = :token
                """
            ),
            {"token": expired_token},
        )
    assert (
        crate_api_client.delete(
            f"{crate_url}/invites/{revoked_token}", headers=_headers(1)
        ).status_code
        == 200
    )

    response = crate_api_client.get(f"{crate_url}/invites", headers=_headers(1))

    assert response.status_code == 200
    invites = response.json()
    assert {invite["token"] for invite in invites} == {active_token, unlimited_token}
    active = next(invite for invite in invites if invite["token"] == active_token)
    assert active["join_url"] == (
        f"https://listen.testserver/crate/invite/{active_token}"
    )
    assert active["max_uses"] == 3
    assert active["use_count"] == 0
    assert active["expires_at"] is not None
    assert active["created_at"] is not None
    unlimited = next(invite for invite in invites if invite["token"] == unlimited_token)
    assert unlimited["expires_at"] is None
    assert unlimited["max_uses"] is None

    collaborator_response = crate_api_client.get(
        f"{crate_url}/invites", headers=_headers(collaborator_id)
    )
    assert collaborator_response.status_code == 403
    stranger_id = _create_user(f"crate-invite-stranger-{uuid4()}@example.test")
    assert (
        crate_api_client.get(
            f"{crate_url}/invites", headers=_headers(stranger_id)
        ).status_code
        == 404
    )


def test_collaborator_can_leave_but_owner_cannot(pg_db, crate_api_client):
    collaborator_id = _create_user(f"crate-leaver-{uuid4()}@example.test")
    other_id = _create_user(f"crate-other-member-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    _add_member(crate_id, collaborator_id)
    _add_member(crate_id, other_id)
    crate_url = f"/api/crates/{crate_id}"

    members = crate_api_client.get(
        f"{crate_url}/members", headers=_headers(collaborator_id)
    ).json()
    owner = members[0]
    assert owner["role"] == "owner"
    assert owner["user_id"] == 1
    assert {"username", "name", "display_name", "avatar"} <= owner.keys()

    assert (
        crate_api_client.delete(
            f"{crate_url}/members/{other_id}", headers=_headers(collaborator_id)
        ).status_code
        == 403
    )
    owner_leave = crate_api_client.delete(f"{crate_url}/members/1", headers=_headers(1))
    assert owner_leave.status_code == 409

    left = crate_api_client.delete(
        f"{crate_url}/members/{collaborator_id}", headers=_headers(collaborator_id)
    )
    assert left.status_code == 200
    assert left.json() == {"ok": True, "members": []}
    assert (
        crate_api_client.get(crate_url, headers=_headers(collaborator_id)).status_code
        == 404
    )
    assert [
        member["user_id"]
        for member in crate_api_client.get(
            f"{crate_url}/members", headers=_headers(1)
        ).json()
    ] == [1, other_id]


def test_cannot_create_invite_when_crate_collaboration_is_disabled(
    pg_db,
    crate_api_client,
):
    crate_id = _create_crate()

    response = crate_api_client.post(
        f"/api/crates/{crate_id}/invites",
        json={},
        headers=_headers(1),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Enable collaboration before creating an invite"
    )


def test_invite_value_error_is_mapped_to_unprocessable_entity(monkeypatch):
    from fastapi import HTTPException

    from crate.api import crates as crate_routes
    from crate.api.schemas.crates import CreateCrateInviteRequest

    monkeypatch.setattr(crate_routes, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(crate_routes, "_require_owner", lambda *args, **kwargs: None)
    monkeypatch.setenv("CRATE_LISTEN_PUBLIC_BASE_URL", "https://listen.testserver")

    def raise_value_error(*args, **kwargs):
        raise ValueError("expires_in_hours must be non-negative")

    monkeypatch.setattr(crate_routes, "create_crate_invite", raise_value_error)

    with pytest.raises(HTTPException) as error:
        crate_routes.invite(None, uuid4(), CreateCrateInviteRequest())

    assert error.value.status_code == 422


def test_update_maps_crate_not_found_to_not_found(monkeypatch):
    from fastapi import HTTPException

    from crate.api import crates as crate_routes
    from crate.api.schemas.crates import UpdateCrateRequest
    from crate.db.repositories.crates import CrateNotFoundError

    monkeypatch.setattr(crate_routes, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(
        crate_routes, "_require_editor", lambda *args, **kwargs: "owner"
    )
    monkeypatch.setattr(
        crate_routes,
        "update_crate",
        lambda *args, **kwargs: (_ for _ in ()).throw(CrateNotFoundError("missing")),
    )

    with pytest.raises(HTTPException) as error:
        crate_routes.update(None, uuid4(), UpdateCrateRequest(name="Renamed"))

    assert error.value.status_code == 404


def test_accepting_crate_invite_does_not_return_member_directory(
    pg_db,
    crate_api_client,
):
    existing_member_id = _create_user(f"crate-existing-member-{uuid4()}@example.test")
    invitee_id = _create_user(f"crate-new-member-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)

    invite = crate_api_client.post(
        f"/api/crates/{crate_id}/invites",
        json={"expires_in_hours": 168, "max_uses": 2},
        headers=_headers(1),
    )
    assert invite.status_code == 201
    token = invite.json()["token"]

    existing_member_acceptance = crate_api_client.post(
        f"/api/crates/invites/{token}/accept",
        headers=_headers(existing_member_id),
    )
    assert existing_member_acceptance.status_code == 200

    accepted = crate_api_client.post(
        f"/api/crates/invites/{token}/accept",
        headers=_headers(invitee_id),
    )

    assert accepted.status_code == 200
    assert accepted.json()["crate_id"] == crate_id
    assert "members" not in accepted.json()


def test_invite_join_url_uses_configured_listen_origin(monkeypatch):
    from crate.api import crates as crate_routes

    monkeypatch.setenv("CRATE_LISTEN_PUBLIC_BASE_URL", "https://listen.example.test/")

    assert (
        crate_routes._invite_join_url("invite-token")
        == "https://listen.example.test/crate/invite/invite-token"
    )


def test_invite_requires_public_listen_url_before_persisting(monkeypatch):
    from fastapi import HTTPException

    from crate.api import crates as crate_routes
    from crate.api.schemas.crates import CreateCrateInviteRequest

    monkeypatch.delenv("CRATE_LISTEN_PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("DOMAIN", raising=False)
    monkeypatch.setattr(crate_routes, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(crate_routes, "_require_owner", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        crate_routes,
        "create_crate_invite",
        lambda *args, **kwargs: pytest.fail("invite must not be persisted"),
    )

    with pytest.raises(HTTPException) as error:
        crate_routes.invite(None, uuid4(), CreateCrateInviteRequest())

    assert error.value.status_code == 503


def test_zero_hour_crate_invite_is_explicitly_non_expiring(
    pg_db,
    crate_api_client,
):
    crate_id = _create_crate(is_collaborative=True)

    response = crate_api_client.post(
        f"/api/crates/{crate_id}/invites",
        json={"expires_in_hours": 0},
        headers=_headers(1),
    )

    assert response.status_code == 201
    assert response.json()["expires_at"] is None


def test_expired_and_revoked_invites_cannot_be_accepted(pg_db, crate_api_client):
    from crate.db.tx import transaction_scope

    invitee_id = _create_user(f"crate-expired-invitee-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    crate_url = f"/api/crates/{crate_id}"

    expired = crate_api_client.post(
        f"{crate_url}/invites",
        json={"expires_in_hours": 12, "max_uses": 2},
        headers=_headers(1),
    ).json()["token"]
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE crate_invites
                SET expires_at = NOW() - INTERVAL '1 hour'
                WHERE token = :token
                """
            ),
            {"token": expired},
        )
    assert (
        crate_api_client.post(
            f"/api/crates/invites/{expired}/accept",
            headers=_headers(invitee_id),
        ).status_code
        == 404
    )

    revoked = crate_api_client.post(
        f"{crate_url}/invites",
        json={"max_uses": 2},
        headers=_headers(1),
    ).json()["token"]
    assert (
        crate_api_client.delete(
            f"{crate_url}/invites/{revoked}",
            headers=_headers(1),
        ).status_code
        == 200
    )
    assert (
        crate_api_client.post(
            f"/api/crates/invites/{revoked}/accept",
            headers=_headers(invitee_id),
        ).status_code
        == 404
    )


def test_only_owner_can_delete_crate_and_delete_cascades_contents(
    pg_db,
    crate_api_client,
):
    from crate.db.repositories.crates import add_crate_album
    from crate.db.tx import transaction_scope

    collaborator_id = _create_user(f"crate-delete-collab-{uuid4()}@example.test")
    crate_id = _create_crate(is_collaborative=True)
    _add_member(crate_id, collaborator_id)
    add_crate_album(crate_id, _seed_album("Cascade album"), added_by=1)
    url = f"/api/crates/{crate_id}"

    invite = crate_api_client.post(
        f"{url}/invites",
        json={},
        headers=_headers(1),
    )
    assert invite.status_code == 201

    assert (
        crate_api_client.delete(url, headers=_headers(collaborator_id)).status_code
        == 403
    )
    deleted = crate_api_client.delete(url, headers=_headers(1))
    assert deleted.status_code == 200
    assert crate_api_client.get(url, headers=_headers(1)).status_code == 404

    with transaction_scope() as session:
        assert (
            session.execute(
                text("SELECT count(*) FROM crate_albums WHERE crate_id = :crate_id"),
                {"crate_id": crate_id},
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM crate_members WHERE crate_id = :crate_id"),
                {"crate_id": crate_id},
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT count(*) FROM crate_invites WHERE crate_id = :crate_id"),
                {"crate_id": crate_id},
            ).scalar_one()
            == 0
        )


def test_crate_playback_endpoint_returns_available_catalog_tracks_for_owner(
    pg_db,
    crate_api_client,
):
    from crate.db.repositories.crates import add_crate_album, create_crate

    crate_id = create_crate(owner_id=1, name="API playback")
    album_uid = _seed_album("Playable album")
    track_uid = _seed_playback_track(album_uid, "Playable track")
    _seed_playback_track(album_uid, "Unavailable track", available=False)
    add_crate_album(crate_id, album_uid, added_by=1)

    response = crate_api_client.get(
        f"/api/crates/{crate_id}/playback", headers=_headers(1)
    )

    assert response.status_code == 200
    assert [track["global_track_uid"] for track in response.json()] == [track_uid]
    stranger_id = _create_user(f"crate-playback-stranger-{uuid4()}@example.test")
    assert (
        crate_api_client.get(
            f"/api/crates/{crate_id}/playback",
            headers=_headers(stranger_id),
        ).status_code
        == 404
    )
    assert crate_api_client.get(f"/api/crates/{crate_id}/playback").status_code == 401


def test_crate_playback_endpoint_allows_authenticated_users_to_play_public_crates(
    pg_db,
    crate_api_client,
):
    from crate.db.repositories.crates import add_crate_album, create_crate, update_crate

    stranger_id = _create_user(f"crate-public-playback-{uuid4()}@example.test")
    crate_id = create_crate(owner_id=1, name="Public API playback")
    assert update_crate(crate_id, visibility="public", actor_id=1)
    album_uid = _seed_album("Public playable album")
    track_uid = _seed_playback_track(album_uid, "Public playable track")
    add_crate_album(crate_id, album_uid, added_by=1)

    response = crate_api_client.get(
        f"/api/crates/{crate_id}/playback", headers=_headers(stranger_id)
    )

    assert response.status_code == 200
    assert [track["global_track_uid"] for track in response.json()] == [track_uid]


def _link_local_album_genres(album_uid: str, genres: dict[str, float]) -> None:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, slug)
                VALUES ('API Test Artist', 'api-test-artist')
                ON CONFLICT DO NOTHING
                """
            )
        )
        local_album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, slug)
                VALUES ('API Test Artist', :uid, :path, :uid)
                RETURNING id
                """
            ),
            {"uid": album_uid, "path": f"/music/api/{album_uid}"},
        ).scalar_one()
        session.execute(
            text(
                """
                UPDATE global_catalog_albums
                SET local_album_id = :local_album_id
                WHERE global_album_uid = CAST(:uid AS uuid)
                """
            ),
            {"local_album_id": local_album_id, "uid": album_uid},
        )
        for name, weight in genres.items():
            genre_id = session.execute(
                text(
                    """
                    INSERT INTO genres (name, slug)
                    VALUES (:name, :slug)
                    ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug
                    RETURNING id
                    """
                ),
                {"name": name, "slug": name.replace(" ", "-")},
            ).scalar_one()
            session.execute(
                text(
                    """
                    INSERT INTO album_genres (album_id, genre_id, weight, source)
                    VALUES (:album_id, :genre_id, :weight, 'tags')
                    """
                ),
                {"album_id": local_album_id, "genre_id": genre_id, "weight": weight},
            )


def test_crate_detail_weights_every_local_album_equally_in_genre_profile(
    pg_db, crate_api_client
):
    crate_id = _create_crate()
    mixed_album = _seed_album("Mixed album")
    focused_album = _seed_album("Focused album")
    remote_album = _seed_album("Remote album")
    _link_local_album_genres(mixed_album, {"post-punk": 1.0, "noise rock": 1.0})
    _link_local_album_genres(focused_album, {"post-punk": 4.0})
    for album_uid in (mixed_album, focused_album, remote_album):
        crate_api_client.post(
            f"/api/crates/{crate_id}/albums",
            json={"global_album_uid": album_uid},
            headers=_headers(1),
        )

    detail = crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(1))

    assert detail.status_code == 200
    assert [
        (genre["name"], genre["share"], genre["percent"])
        for genre in detail.json()["genre_profile"]
    ] == [("post-punk", 0.75, 100), ("noise rock", 0.25, 33)]


def test_crate_detail_exposes_the_owner_instagram_handle(pg_db, crate_api_client):
    from crate.db.tx import transaction_scope

    owner_id = _create_user("instagram-owner@example.com")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE users SET instagram_handle = :handle WHERE id = :id"),
            {"handle": "diego.trecedoce", "id": owner_id},
        )
    crate_id = _create_crate(owner_id=owner_id)

    detail = crate_api_client.get(f"/api/crates/{crate_id}", headers=_headers(owner_id))

    assert detail.status_code == 200
    assert detail.json()["owner_instagram_handle"] == "diego.trecedoce"
