from __future__ import annotations

import json

import pytest


def test_shipped_taxonomy_release_has_valid_signature():
    from crate.federation.global_genres import verify_shipped_taxonomy_release

    verified = verify_shipped_taxonomy_release()

    assert verified["valid"] is True
    assert verified["taxonomy_id"] == "crate-core"
    assert verified["version"] == "1.0.0"
    assert verified["key_id"] == "crate-taxonomy-root-2026-01"


def test_taxonomy_release_rejects_payload_tampering(tmp_path):
    from crate.federation.global_genres import (
        TaxonomyReleaseError,
        verify_taxonomy_release_files,
    )

    base = verify_taxonomy_release_files.default_paths()
    payload = json.loads(base.release.read_text())
    payload["version"] = "1.0.1"
    release = tmp_path / "release.json"
    release.write_text(json.dumps(payload))

    with pytest.raises(TaxonomyReleaseError, match="signature"):
        verify_taxonomy_release_files(
            release=release,
            signature=base.signature,
            trust_roots=base.trust_roots,
            expected_digest=None,
        )


def test_taxonomy_release_rejects_unknown_or_revoked_root(tmp_path):
    from crate.federation.global_genres import (
        TaxonomyReleaseError,
        verify_taxonomy_release_files,
    )

    base = verify_taxonomy_release_files.default_paths()
    roots = json.loads(base.trust_roots.read_text())
    roots["roots"][0]["status"] = "revoked"
    trust_roots = tmp_path / "roots.json"
    trust_roots.write_text(json.dumps(roots))

    with pytest.raises(TaxonomyReleaseError, match="revoked"):
        verify_taxonomy_release_files(
            release=base.release,
            signature=base.signature,
            trust_roots=trust_roots,
            expected_digest=None,
        )
