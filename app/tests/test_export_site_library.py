import json

import numpy as np
import pytest

from scripts import export_site_library
from scripts.export_site_library import project_to_3d, quantise


def test_project_to_3d_returns_centred_points_within_radius():
    rng = np.random.default_rng(1)
    points = project_to_3d(rng.normal(size=(200, 20)), radius=1.5)
    assert points.shape == (200, 3)
    assert np.abs(points).max() <= 1.5 + 1e-9


def test_quantise_maps_radius_to_int16_range():
    data = quantise(np.array([[1.5, -1.5, 0.0]]), radius=1.5)
    assert data.dtype == np.int16
    assert data.tolist() == [32767, -32767, 0]


def test_main_writes_cloud_and_metadata(tmp_path, monkeypatch):
    rng = np.random.default_rng(2)
    rows = [{"bliss_vector": list(vector)} for vector in rng.normal(size=(50, 20))]
    calls = []

    def fake_sample(*, limit, seed):
        calls.append((limit, seed))
        return rows

    monkeypatch.setattr(export_site_library, "get_bliss_sample", fake_sample)

    export_site_library.main(
        ["--limit", "50", "--min", "50", "--seed", "0.3", "--out", str(tmp_path)]
    )

    cloud = np.fromfile(tmp_path / "library-cloud.bin", dtype=np.int16)
    meta = json.loads((tmp_path / "library-cloud.json").read_text())
    assert calls == [(50, 0.3)]
    assert cloud.shape == (150,)
    assert meta == {"count": 50, "radius": 1.5, "seed": 0.3}


def test_main_refuses_to_write_an_empty_cloud(tmp_path, monkeypatch):
    monkeypatch.setattr(export_site_library, "get_bliss_sample", lambda **_: [])

    with pytest.raises(SystemExit):
        export_site_library.main(["--out", str(tmp_path)])

    assert not (tmp_path / "library-cloud.bin").exists()


def test_main_requests_the_desktop_hero_count_by_default(tmp_path, monkeypatch):
    rng = np.random.default_rng(3)
    rows = [{"bliss_vector": list(vector)} for vector in rng.normal(size=(30, 20))]
    calls = []

    def fake_sample(*, limit, seed):
        calls.append(limit)
        return rows

    monkeypatch.setattr(export_site_library, "get_bliss_sample", fake_sample)

    export_site_library.main(["--min", "30", "--out", str(tmp_path)])

    meta = json.loads((tmp_path / "library-cloud.json").read_text())
    assert calls == [40000]
    assert meta["count"] == 30


def test_main_refuses_a_cloud_below_the_minimum(tmp_path, monkeypatch):
    rng = np.random.default_rng(4)
    rows = [{"bliss_vector": list(vector)} for vector in rng.normal(size=(40, 20))]
    monkeypatch.setattr(export_site_library, "get_bliss_sample", lambda **_: rows)

    with pytest.raises(SystemExit, match="40 tracks.*at least 12000"):
        export_site_library.main(["--out", str(tmp_path)])

    assert not (tmp_path / "library-cloud.bin").exists()
    assert not (tmp_path / "library-cloud.json").exists()
