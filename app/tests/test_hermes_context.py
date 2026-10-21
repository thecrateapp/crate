"""Release provenance and filesystem boundaries of the operator's context MCP."""

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _module(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / "docs").mkdir()
    (root / "docs/manifest.json").write_text(
        json.dumps([{"sourcePath": "docs/architecture.md"}])
    )
    (root / "docs/architecture.md").write_text("# Architecture\nWorkers own writes.\n")
    (root / "AGENTS.md").write_text("Library is read-only in the API.\n")
    (root / ".env").write_text("DO_NOT_EXPORT=secret\n")
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "fixture",
        ],
        check=True,
    )
    sha = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    return root, sha


def _build(repo, destination):
    root, sha = repo
    builder = _module(ROOT / "scripts/hermes_context.py")
    return builder.build_context(
        root, sha, destination, {"release_sha": sha, "images": {}}
    )


def test_build_uses_committed_content_and_excludes_unlisted_secrets(repo, tmp_path):
    root, sha = repo
    (root / "docs/architecture.md").write_text("uncommitted replacement")
    out = tmp_path / "bundle"
    manifest = _build(repo, out)
    assert manifest["release_sha"] == sha
    assert "Workers own writes" in (out / "docs/architecture.md").read_text()
    assert not (out / ".env").exists()
    assert ".env" not in manifest["files"]


def test_build_rejects_a_deployment_from_another_release(repo, tmp_path):
    root, sha = repo
    builder = _module(ROOT / "scripts/hermes_context.py")
    with pytest.raises(ValueError, match="release"):
        builder.build_context(root, sha, tmp_path / "bundle", {"release_sha": "a" * 40})


@pytest.mark.parametrize("source", ["../.env", ".env", "/etc/passwd", "docs/link.md"])
def test_build_rejects_unsafe_document_sources(repo, tmp_path, source):
    root, _ = repo
    if source == "docs/link.md":
        (root / source).symlink_to("../.env")
    (root / "docs/manifest.json").write_text(json.dumps([{"sourcePath": source}]))
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "unsafe",
        ],
        check=True,
    )
    sha = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    with pytest.raises(ValueError):
        _build((root, sha), tmp_path / "bundle")


def test_context_reads_and_search_return_bounded_provenance(repo, tmp_path):
    out = tmp_path / "bundle"
    _build(repo, out)
    store = _module(ROOT / "deploy/hermes/context_server.py").ContextStore(out)
    assert store.summary()["release_sha"] == repo[1]
    assert store.summary()["document_count"] >= 2
    found = store.search("workers", limit=2)
    assert found["matches"][0]["path"] == "docs/architecture.md"
    page = store.read("docs/architecture.md", start_line=2, line_count=1)
    assert page["text"] == "Workers own writes."
    assert page["release_sha"] == repo[1]
    assert len(page["sha256"]) == 64
    for path in ("../.env", "/etc/passwd", ".env"):
        with pytest.raises(ValueError):
            store.read(path)
    with pytest.raises(ValueError):
        store.search("workers", limit=1000)
    with pytest.raises(ValueError):
        store.read("AGENTS.md", start_line=0)
    with pytest.raises(ValueError):
        store.read("AGENTS.md", line_count=1000)


def test_context_refuses_modified_or_symlinked_content(repo, tmp_path):
    out = tmp_path / "bundle"
    _build(repo, out)
    store = _module(ROOT / "deploy/hermes/context_server.py").ContextStore(out)
    document = out / "AGENTS.md"
    document.write_text("altered after packaging")
    with pytest.raises(ValueError, match="integrity"):
        store.read("AGENTS.md")
    document.unlink()
    document.symlink_to(tmp_path / "outside")
    (tmp_path / "outside").write_text("outside secret")
    with pytest.raises(ValueError):
        store.read("AGENTS.md")


def test_existing_context_store_observes_atomic_release_switch(repo, tmp_path):
    parent = tmp_path / "contexts"
    parent.mkdir()
    _build(repo, parent / "first")
    active = parent / "active"
    active.symlink_to("first")
    store = _module(ROOT / "deploy/hermes/context_server.py").ContextStore(active)
    assert store.summary()["release_sha"] == repo[1]
    root, _ = repo
    (root / "AGENTS.md").write_text("new release policy")
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "next",
        ],
        check=True,
    )
    sha = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    _build((root, sha), parent / "second")
    (parent / "next").symlink_to("second")
    (parent / "next").replace(active)
    assert store.summary()["release_sha"] == sha
    assert store.read("AGENTS.md")["text"] == "new release policy"


def test_context_activation_validates_archive_before_switch(repo, tmp_path):
    import tarfile

    source = tmp_path / "bundle"
    _build(repo, source)
    archive = tmp_path / "context.tar.gz"
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(source, arcname=".")
    activate = _module(ROOT / "deploy/hermes/activate_context.py")
    parent = tmp_path / "installed"
    activate.activate_context(parent, archive, repo[1])
    assert (parent / "active").resolve().name.startswith(repo[1] + "-")
    assert (
        json.loads((parent / "deployment.json").read_text())["release_sha"] == repo[1]
    )
    with pytest.raises(ValueError, match="release"):
        activate.activate_context(parent, archive, "a" * 40)
    assert (parent / "active").resolve().name.startswith(repo[1] + "-")


def test_context_is_stale_during_deploy_and_after_rollback(repo, tmp_path):
    root = tmp_path / "contexts"
    _build(repo, root / "active")
    activation = _module(ROOT / "deploy/hermes/activate_context.py")
    store = _module(ROOT / "deploy/hermes/context_server.py").ContextStore(
        root / "active"
    )
    activation.record_deployment(root, {"release_sha": repo[1]}, "deploying")
    assert store.summary()["availability"] == "stale"
    activation.record_deployment(root, {"release_sha": "b" * 40}, "verified")
    assert store.summary()["availability"] == "stale"
    activation.record_deployment(root, {"release_sha": repo[1]}, "verified")
    assert store.summary()["availability"] == "available"


def test_context_reports_deployment_drift_without_claiming_current_sources(
    repo, tmp_path
):
    parent = tmp_path / "contexts"
    _build(repo, parent / "active")
    (parent / "deployment.json").write_text(json.dumps({"release_sha": "a" * 40}))
    store = _module(ROOT / "deploy/hermes/context_server.py").ContextStore(
        parent / "active"
    )
    summary = store.summary()
    assert summary["availability"] == "stale"
    assert summary["observed_release_sha"] == "a" * 40


def test_context_sdk_stdio_transport_only_exposes_bounded_reads(tmp_path):
    import asyncio
    import hashlib
    import sys

    pytest.importorskip("mcp")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    source = b"Workers own writes.\n"
    (tmp_path / "AGENTS.md").write_bytes(source)
    (tmp_path / "context-manifest.json").write_text(
        json.dumps(
            {
                "release_sha": "a" * 40,
                "deployment": {"release_sha": "a" * 40},
                "files": {
                    "AGENTS.md": {
                        "sha256": hashlib.sha256(source).hexdigest(),
                        "bytes": len(source),
                    }
                },
            }
        )
    )

    async def run():
        parameters = StdioServerParameters(
            command=sys.executable,
            args=[str(ROOT / "deploy/hermes/context_server.py")],
            env={"CRATE_CONTEXT_ROOT": str(tmp_path)},
        )
        async with (
            stdio_client(parameters) as (read, write),
            ClientSession(read, write) as client,
        ):
            await client.initialize()
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == {
                "get_release_context",
                "search_crate_context",
                "read_crate_context",
            }
            assert all(tool.annotations.read_only_hint for tool in tools.tools)
            result = await client.call_tool("read_crate_context", {"path": "AGENTS.md"})
            assert json.loads(result.content[0].text)["text"] == "Workers own writes."
            denied = await client.call_tool(
                "read_crate_context", {"path": "/etc/passwd"}
            )
            assert denied.is_error

    asyncio.run(run())


def test_build_can_describe_a_release_before_the_canonical_docs_manifest(
    repo, tmp_path
):
    root, _ = repo
    (root / "docs/manifest.json").unlink()
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "legacy docs",
        ],
        check=True,
    )
    sha = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    result = _build((root, sha), tmp_path / "legacy")
    assert "AGENTS.md" in result["files"]
    assert "docs/architecture.md" in result["files"]


def test_build_includes_runbooks_native_clients_and_site_sources(repo, tmp_path):
    root, _ = repo
    included = (
        "scripts/deploy.sh",
        "app/site/src/App.tsx",
        "app/docs/src/App.tsx",
        "app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMix.java",
        "app/listen/ios/App/App/NativeClient.swift",
        "tools/vdj-plugin/src/client/smart_mix_client.cpp",
        "tools/vdj-plugin/include/crate_vdj/smart_mix_client.hpp",
    )
    for path in included:
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("versioned deployment or architecture source\n")
    subprocess.run(["git", "-C", str(root), "add", "."], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.test",
            "commit",
            "-qm",
            "broader context",
        ],
        check=True,
    )
    sha = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    result = _build((root, sha), tmp_path / "bundle")
    assert set(included) <= set(result["files"])
