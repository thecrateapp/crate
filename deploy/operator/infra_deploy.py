"""Fixed host dependency closure and predicted immutable deployment transitions."""

import ast
import hashlib
from pathlib import Path

from scripts.release_manifest import render_release_env

from .infra_policy import trusted_file

REQUIRED = (
    "scripts/deploy-remote.sh",
    "deploy/hermes/activate_context.py",
    "docker-compose.yaml",
    "docker-compose.project.yaml",
    ".env",
)
OPTIONAL = (
    ".deploy/hermes.compose.yaml",
    ".deploy/release-manifest.json",
    ".deploy/release.env.candidate",
    ".deploy/release-manifest.json.candidate",
    "deploy/traefik/federation-readplane.yml",
)
DIRECTORIES = (".deploy", ".deploy-backups")
HELPER_IMPORTS = frozenset(
    {
        "argparse",
        "hashlib",
        "json",
        "os",
        "re",
        "tarfile",
        "tempfile",
        "pathlib",
        "uuid",
    }
)
BACKUP_FILES = (
    "docker-compose.yaml",
    "docker-compose.project.yaml",
    ".env",
    "rollback_tag",
    "changed_image_refs",
    "changed_services",
    ".deploy/release-manifest.json",
    "deploy/traefik/federation-readplane.yml",
)


def file_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _check_optional(path):
    # A dangling symlink must not be treated as an absent, safe staging path.
    while not path.exists() and not path.is_symlink():
        path = path.parent
    trusted_file(path)


def _context_root(root):
    # grep/tail/cut select LF-delimited records and preserve every other byte.
    # Reject binary/non-UTF8 input rather than emulate grep's binary-file behavior.
    raw = (root / ".env").read_bytes()
    if b"\0" in raw:
        raise ValueError("Unsupported binary host environment")
    raw = raw.decode("utf-8")
    matches = [
        line.partition("=")[2]
        for line in raw.split("\n")
        if line.startswith("DATA_DIR=")
    ]
    value = matches[-1] if matches else ""
    # Match deploy-remote.sh env_file_value: surrounding quotes, no evaluation.
    value = (
        value.removesuffix('"').removeprefix('"').removesuffix("'").removeprefix("'")
    )
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Unsupported control character in DATA_DIR")
    directory = Path(value + "/hermes-agent")
    if not directory.is_absolute():
        directory = root / directory
    return directory / "context"


def validate_host(root, *, backup_id=None):
    """Validate consumed descendants, not just their containing directories."""
    root = Path(root)
    for relative in REQUIRED:
        path = trusted_file(root / relative)
        if not path.is_file():
            raise ValueError("Host dependency must be a regular file")
    for relative in OPTIONAL:
        path = root / relative
        _check_optional(path)
        if path.exists() and not path.is_file():
            raise ValueError("Host input must be a regular file")
    for relative in DIRECTORIES:
        path = root / relative
        _check_optional(path)
        if path.exists() and not path.is_dir():
            raise ValueError("Host staging path must be a directory")
    helper = root / "deploy/hermes/activate_context.py"
    for node in ast.walk(ast.parse(helper.read_text())):
        if isinstance(node, ast.Import):
            modules = [item.name for item in node.names]
        elif isinstance(node, ast.ImportFrom):
            modules = [node.module] if not node.level else [None]
        else:
            continue
        if any(module not in HELPER_IMPORTS for module in modules):
            raise ValueError("Unreviewed host helper import dependency")
    # Isolated Python excludes the script directory, cwd, PYTHONPATH and user site.
    script = (root / "scripts/deploy-remote.sh").read_text()
    calls = [
        line.strip()
        for line in script.splitlines()
        if line.strip().startswith("python3 ")
    ]
    if not calls or any(not line.startswith("python3 -I ") for line in calls):
        raise ValueError("Host helper requires isolated Python imports")
    context = _context_root(root)
    if context.parent.exists() or context.parent.is_symlink():
        _check_optional(context)
        _check_optional(context / "deployment.json")
    if backup_id is not None:
        backup = root / ".deploy-backups" / ("infra-" + backup_id)
        _check_optional(backup)
        for relative in BACKUP_FILES:
            _check_optional(backup / relative)


def host_inputs(root, *, provisioned):
    root = Path(root)
    if provisioned:
        validate_host(root)
    result = {}
    for relative in (*REQUIRED, *OPTIONAL):
        path = root / relative
        if path.is_symlink():
            raise ValueError("Symlink host dependency forbidden")
        if path.exists():
            if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("Invalid host input")
            result[relative] = file_digest(path)
        elif relative in REQUIRED:
            raise ValueError("Required host input missing")
        else:
            result[relative] = None
    return result


def environment_versions(raw, manifest):
    """Predict every fixed set_env_value result, preserving other bytes exactly."""
    replacements = {
        "CRATE_IMAGE_TAG": manifest["release_sha"],
        "CRATE_IMAGE_OWNER": "thecrateapp",
        "CRATE_IMAGE_REGISTRY": "ghcr.io",
        **dict(
            line.split("=", 1) for line in render_release_env(manifest).splitlines()
        ),
    }
    versions = [raw]
    for key, value in replacements.items():
        prefix = key.encode() + b"="
        replacement = prefix + value.encode()
        lines = raw.splitlines(keepends=True)
        if any(line.startswith(prefix) for line in lines):
            raw = b"".join(
                replacement + (b"\n" if line.endswith(b"\n") else b"")
                if line.startswith(prefix)
                else line
                for line in lines
            )
        else:
            raw += b"\n" + replacement + b"\n"
        versions.append(raw)
    return versions


def staged_inputs(original, assets):
    expected = dict(original)
    for name in ("docker-compose.yaml", "docker-compose.project.yaml"):
        expected[name] = assets[name]
    for name in ("release.env", "release-manifest.json"):
        expected[".deploy/" + name + ".candidate"] = assets[name]
    return expected


def configured_inputs(staged, assets, environment):
    expected = dict(staged)
    expected[".env"] = hashlib.sha256(environment).hexdigest()
    expected[".deploy/release-manifest.json"] = assets["release-manifest.json"]
    return expected


def generated_backup_inputs(original, assets, environment, manifest, plan_id):
    """Expected outputs consumed later by pull/up/rollback, derived before effects."""
    initial = {
        relative: original.get(relative)
        for relative in BACKUP_FILES
        if relative not in {"rollback_tag", "changed_image_refs", "changed_services"}
    }
    initial["rollback_tag"] = hashlib.sha256(
        ("rollback-infra-" + plan_id + "\n").encode()
    ).hexdigest()
    initial.update(
        changed_image_refs=None, changed_services=None, recovery_complete=None
    )
    old = {}
    for line in environment.decode().splitlines():
        key, sep, value = line.partition("=")
        if sep:
            old[key] = (
                value.removesuffix('"')
                .removeprefix('"')
                .removesuffix("'")
                .removeprefix("'")
            )
    force = any(
        original[name] != assets[name]
        for name in ("docker-compose.yaml", "docker-compose.project.yaml")
    )
    images, services = set(), set()
    for name, entry in manifest["images"].items():
        current = old.get(entry["environment"]) or entry["repository"] + ":" + old.get(
            "CRATE_IMAGE_TAG", ""
        )
        expected = entry["repository"] + "@" + entry["digest"]
        if force or current != expected:
            images.add(expected)
            services.update(entry["services"])
            if name == "worker":
                services.add("crate-fast-worker")
    configured = dict(initial)
    for key, values in (("changed_image_refs", images), ("changed_services", services)):
        configured[key] = hashlib.sha256(
            "".join(value + "\n" for value in sorted(values)).encode()
        ).hexdigest()
    return initial, configured


def assert_backup_inputs(root, plan_id, expected):
    backup = Path(root) / ".deploy-backups" / ("infra-" + plan_id)
    for relative, expected_hash in expected.items():
        path = backup / relative
        if (
            path.is_symlink()
            or (file_digest(path) if path.exists() else None) != expected_hash
        ):
            raise ValueError("Generated deployment input changed")
