"""Request validation contracts for Listen Crates."""

from uuid import UUID

from crate.api.schemas.crates import ReorderCrateAlbumsRequest


def test_reorder_request_accepts_crates_larger_than_one_thousand_albums():
    album_uids = [UUID(int=position + 1) for position in range(1_001)]

    request = ReorderCrateAlbumsRequest(global_album_uids=album_uids)

    assert request.global_album_uids == album_uids
