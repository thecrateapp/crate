from pathlib import Path


def test_catalog_runtime_has_no_surface_policy_module():
    assert not Path("app/crate/federation/global_policy.py").exists()
