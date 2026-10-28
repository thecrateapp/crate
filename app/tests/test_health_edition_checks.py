from unittest.mock import patch

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope
from crate.health_check import LibraryHealthCheck

ARTIST = "Type O Negative"
STANDARD = [f"Song {number}" for number in range(1, 16)]
BONUS = ["Black Sabbath", "Haunted (Per Version)", "Cinnamon Girl (Depression Mix)"]


def _album(session, name, path):
    return session.execute(
        text(
            """
            INSERT INTO library_albums (artist, name, path, track_count, updated_at)
            VALUES (:artist, :name, :path, 0, NOW()) RETURNING id
            """
        ),
        {"artist": ARTIST, "name": name, "path": path},
    ).scalar_one()


def _tracks(session, album_id, album_name, folder, titles):
    for number, title in enumerate(titles, start=1):
        session.execute(
            text(
                """
                INSERT INTO library_tracks
                    (album_id, artist, album, filename, title, track_number, path, updated_at)
                VALUES (:album_id, :artist, :album, :filename, :title, :number, :path, NOW())
                """
            ),
            {
                "album_id": album_id,
                "artist": ARTIST,
                "album": album_name,
                "filename": f"{number:02d}.flac",
                "title": title,
                "number": number,
                "path": f"{folder}/{album_id}-{number:02d}.flac",
            },
        )


def _library(tmp_path):
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name, updated_at) VALUES (:n, NOW())"),
            {"n": ARTIST},
        )
        standard = _album(session, "October Rust", "/music/tool/standard")
        special = _album(
            session, "October Rust (Special Edition)", "/music/tool/special"
        )
        multi_disc = _album(session, "World Coming Down", "/music/tool/wcd")
        _tracks(session, standard, "October Rust", "/music/tool/standard", STANDARD)
        _tracks(
            session,
            special,
            "October Rust (Special Edition)",
            "/music/tool/special",
            STANDARD,
        )
        _tracks(session, standard, "October Rust", "/music/tool/special", BONUS)
        _tracks(session, multi_disc, "World Coming Down", "/music/tool/wcd/CD1", ["A"])
        _tracks(session, multi_disc, "World Coming Down", "/music/tool/wcd/CD2", ["B"])
    return {
        "checker": LibraryHealthCheck({"library_path": str(tmp_path)}),
        "standard": standard,
        "special": special,
    }


def _open_issues(check_type):
    with read_scope() as session:
        return (
            session.execute(
                text(
                    "SELECT album_id, details_json FROM health_issues "
                    "WHERE check_type = :check AND status = 'open'"
                ),
                {"check": check_type},
            )
            .mappings()
            .all()
        )


def test_artist_diagnosis_reports_overlapping_editions(pg_db, tmp_path):
    world = _library(tmp_path)

    report = world["checker"].run_selected_for_artists(["edition_overlap"], [ARTIST])

    assert report["summary"] == {"edition_overlap": 1}
    [issue] = _open_issues("edition_overlap")
    details = issue["details_json"]
    assert issue["album_id"] == world["special"]
    assert details["edition_album_id"] == world["standard"]
    assert details["shared_tracks"] == 15
    assert details["edition_track_count"] == 18


def test_artist_diagnosis_reports_tracks_outside_their_album_folder(pg_db, tmp_path):
    world = _library(tmp_path)

    report = world["checker"].run_selected_for_artists(
        ["album_split_folders"], [ARTIST]
    )

    assert report["summary"] == {"album_split_folders": 1}
    [issue] = _open_issues("album_split_folders")
    assert issue["album_id"] == world["standard"]
    assert issue["details_json"]["foreign_track_count"] == 3
    assert issue["details_json"]["folders"] == [
        "/music/tool/special",
        "/music/tool/standard",
    ]


def test_dismissed_edition_overlap_stays_dismissed_on_the_next_diagnosis(
    pg_db, tmp_path
):
    world = _library(tmp_path)
    world["checker"].run_selected_for_artists(["edition_overlap"], [ARTIST])
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE health_issues SET status = 'dismissed' "
                "WHERE check_type = 'edition_overlap'"
            )
        )

    world["checker"].run_selected_for_artists(["edition_overlap"], [ARTIST])

    assert _open_issues("edition_overlap") == []


def test_global_health_run_includes_the_new_checks(pg_db, tmp_path):
    world = _library(tmp_path)

    report = world["checker"].run_selected(["edition_overlap", "album_split_folders"])

    assert report["summary"]["edition_overlap"] == 1
    assert report["summary"]["album_split_folders"] == 1


def test_album_diagnosis_endpoints_recheck_the_album_artist(test_app):
    with (
        patch(
            "crate.api.management.get_library_album_by_entity_uid",
            return_value={"id": 7, "artist": ARTIST},
        ),
        patch("crate.api.management.get_library_album_by_id", return_value=None),
        patch("crate.api.management.create_task_dedup", return_value="task-1") as task,
    ):
        found = test_app.post(
            "/api/manage/albums/by-entity/11111111-2222-4333-8444-555555555555/health-recheck"
        )
        missing = test_app.post("/api/manage/albums/9/health-recheck")

    assert found.status_code == 200
    assert found.json()["task_id"] == "task-1"
    task_type, params = task.call_args.args
    assert task_type == "health_check"
    assert params["artists"] == [ARTIST]
    assert {"edition_overlap", "album_split_folders"} <= set(params["check_types"])
    assert missing.status_code == 404
