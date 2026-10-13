from tiddl.core.api.api import DO_NOT_CACHE, TidalAPI
from tiddl.core.api.models.base import TrackStream


def stereo_track_stream(self: TidalAPI, track_id, quality):
    return self.client.fetch(
        TrackStream,
        f"tracks/{track_id}/playbackinfopostpaywall",
        {
            "audioquality": quality,
            "playbackmode": "STREAM",
            "assetpresentation": "FULL",
            "immersiveaudio": "false",
        },
        expire_after=DO_NOT_CACHE,
    )


def main() -> None:
    setattr(TidalAPI, "get_track_stream", stereo_track_stream)
    from tiddl.cli.app import app

    app(prog_name="tiddl")


if __name__ == "__main__":
    main()
