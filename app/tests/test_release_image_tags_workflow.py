from __future__ import annotations

import os
import subprocess
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/build-installer.yml"
API_DIGEST = "sha256:" + "a" * 64
AGENT_DIGEST = "sha256:" + "b" * 64
OTHER_DIGEST = "sha256:" + "c" * 64
API_REF = f"ghcr.io/thecrateapp/crate-api@{API_DIGEST}"
AGENT_REF = f"ghcr.io/thecrateapp/crate-agent@{AGENT_DIGEST}"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def _run_tag_step(
    tmp_path: Path, refs: list[str], existing: dict[str, str]
) -> tuple[subprocess.CompletedProcess, list[str]]:
    script = _step(
        _workflow()["jobs"]["tag-images"], "Tag every release image with the version"
    )["run"]
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "python").write_text(
        "#!/usr/bin/env bash\nprintf '%s' \"$FAKE_REFS\"\n"
    )
    (fake_bin / "docker").write_text(
        "#!/usr/bin/env bash\n"
        'if [[ "$1 $2 $3" == "buildx imagetools inspect" ]]; then\n'
        '  digest="$(grep -F "$4 " "$FAKE_TAGS" | cut -d" " -f2)"\n'
        '  [[ -n "$digest" ]] || exit 1\n'
        '  printf \'"%s"\\n\' "$digest"\n'
        "  exit 0\n"
        "fi\n"
        'if [[ "$1 $2 $3" == "buildx imagetools create" ]]; then\n'
        '  printf \'%s %s\\n\' "$5" "$6" >> "$FAKE_CREATED"\n'
        "  exit 0\n"
        "fi\n"
        "exit 2\n"
    )
    for tool in ("python", "docker"):
        (fake_bin / tool).chmod(0o755)
    tags = tmp_path / "tags"
    tags.write_text("".join(f"{tag} {digest}\n" for tag, digest in existing.items()))
    created = tmp_path / "created"
    created.touch()
    result = subprocess.run(
        ["bash", "-c", script],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            "RELEASE_TAG": "v3.0.0",
            "FAKE_REFS": "".join(f"{ref}\n" for ref in refs),
            "FAKE_TAGS": str(tags),
            "FAKE_CREATED": str(created),
        },
    )
    return result, created.read_text().splitlines()


def test_version_tags_run_on_release_tags_before_the_installer_release() -> None:
    workflow = _workflow()
    triggers = workflow[True]
    assert "v*" in triggers["push"]["tags"]
    job = workflow["jobs"]["tag-images"]
    assert job["if"] == "startsWith(github.ref, 'refs/tags/v')"
    assert job["permissions"]["packages"] == "write"
    assert job["env"]["RELEASE_TAG"] == "${{ github.ref_name }}"
    assert "tag-images" in workflow["jobs"]["release"]["needs"]


def test_version_tags_come_from_the_manifest_of_the_tagged_commit() -> None:
    job = _workflow()["jobs"]["tag-images"]
    script = _step(job, "Read the release manifest of the tagged commit")["run"]
    assert 'release_sha="$(git rev-parse HEAD)"' in script
    assert 'manifest_image="${MANIFEST_REPOSITORY}:${release_sha}"' in script
    assert "exit 1" in script
    assert "scripts/release_manifest.py validate" in script
    assert '--release-sha "$release_sha"' in script
    assert job["env"]["OWNER"] == "${{ github.repository_owner }}"

    tag = _step(job, "Tag every release image with the version")["run"]
    assert "scripts/release_manifest.py refs" in tag
    assert 'docker buildx imagetools create --tag "$target" "$reference"' in tag
    assert 'target="${repository}:${RELEASE_TAG}"' in tag


def test_tagging_creates_the_version_tag_for_every_manifest_image(
    tmp_path: Path,
) -> None:
    result, created = _run_tag_step(tmp_path, [API_REF, AGENT_REF], {})

    assert result.returncode == 0, result.stderr
    assert created == [
        f"ghcr.io/thecrateapp/crate-api:v3.0.0 {API_REF}",
        f"ghcr.io/thecrateapp/crate-agent:v3.0.0 {AGENT_REF}",
    ]
    assert "::warning::" not in result.stdout


def test_tagging_again_skips_tags_that_already_match(tmp_path: Path) -> None:
    result, created = _run_tag_step(
        tmp_path,
        [API_REF, AGENT_REF],
        {"ghcr.io/thecrateapp/crate-api:v3.0.0": API_DIGEST},
    )

    assert result.returncode == 0, result.stderr
    assert created == [f"ghcr.io/thecrateapp/crate-agent:v3.0.0 {AGENT_REF}"]


def test_tagging_never_moves_an_existing_release_tag(tmp_path: Path) -> None:
    result, created = _run_tag_step(
        tmp_path,
        [API_REF],
        {"ghcr.io/thecrateapp/crate-api:v3.0.0": OTHER_DIGEST},
    )

    assert result.returncode == 1
    assert "never moved" in result.stdout
    assert created == []


def test_tagging_warns_when_the_manifest_has_no_agent_image(tmp_path: Path) -> None:
    result, created = _run_tag_step(tmp_path, [API_REF], {})

    assert result.returncode == 0, result.stderr
    assert "crate-agent:v3.0.0 will not exist" in result.stdout
    assert created == [f"ghcr.io/thecrateapp/crate-api:v3.0.0 {API_REF}"]
