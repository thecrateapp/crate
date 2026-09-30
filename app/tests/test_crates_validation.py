"""Request validation contracts for Listen Crates."""

from uuid import UUID

from crate.api.schemas.crates import CrateSummaryResponse, ReorderCrateAlbumsRequest


def test_reorder_request_accepts_crates_larger_than_one_thousand_albums():
    album_uids = [UUID(int=position + 1) for position in range(1_001)]

    request = ReorderCrateAlbumsRequest(global_album_uids=album_uids)

    assert request.global_album_uids == album_uids


def test_crate_summary_does_not_serialize_unmodeled_fields():
    summary = CrateSummaryResponse.model_validate(
        {
            "id": "crate-id",
            "owner_id": 1,
            "name": "Year-end records",
            "visibility": "public",
            "is_collaborative": False,
            "owner_email": "private@example.test",
        }
    )

    assert "owner_email" not in summary.model_dump()
