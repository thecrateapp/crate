from types import SimpleNamespace

from tiddl.core.api.api import TidalAPI

from crate import tiddl_stereo


def test_stereo_track_stream_asks_tidal_for_non_immersive_audio():
    fetched: list[tuple] = []
    api = SimpleNamespace(
        client=SimpleNamespace(
            fetch=lambda model, path, params, expire_after: (
                fetched.append((model, path, params)) or "stream"
            )
        )
    )

    stream = tiddl_stereo.stereo_track_stream(api, 535969918, "HI_RES_LOSSLESS")

    assert stream == "stream"
    _model, path, params = fetched[0]
    assert path == "tracks/535969918/playbackinfopostpaywall"
    assert params["immersiveaudio"] == "false"
    assert params["audioquality"] == "HI_RES_LOSSLESS"


def test_main_runs_tiddl_cli_with_stereo_streams(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(TidalAPI, "get_track_stream", TidalAPI.get_track_stream)
    monkeypatch.setattr("tiddl.cli.app.app", lambda prog_name: calls.append(prog_name))

    tiddl_stereo.main()

    assert calls == ["tiddl"]
    assert TidalAPI.get_track_stream is tiddl_stereo.stereo_track_stream
