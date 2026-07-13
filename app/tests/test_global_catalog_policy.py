import importlib
import sys


def _global_policy():
    return importlib.import_module("crate.federation.global_policy")


def test_catalog_policy_import_is_leaf_module():
    sys.modules.pop("crate.federation.global_policy", None)

    assert _global_policy() is not None


def test_global_catalog_is_required_even_when_legacy_env_disables_it(monkeypatch):
    monkeypatch.setenv("CRATE_GLOBAL_CATALOG_ENABLED", "false")

    assert _global_policy().is_global_catalog_enabled() is True


def test_every_named_catalog_surface_uses_the_canonical_read_model():
    policy = _global_policy()

    assert all(
        policy.global_catalog_surface_enabled(surface)
        for surface in ("search", "library", "home", "explore", "radio", "stats")
    )


def test_global_track_reference_is_not_gated_by_a_feature_flag(monkeypatch):
    monkeypatch.setenv("CRATE_GLOBAL_CATALOG_ALLOW_REMOTE_PLAYLIST_REFS", "false")

    assert _global_policy().global_catalog_remote_playlist_refs_allowed() is True
