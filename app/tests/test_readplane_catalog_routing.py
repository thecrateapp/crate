import fnmatch
import re
from dataclasses import dataclass
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_dev_caddy_routes_canonical_catalog_reads_through_readplane():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()
    compose = yaml.safe_load((ROOT / "docker-compose.readplane.dev.yaml").read_text())

    assert "method GET" in caddyfile
    assert "/api/catalog/*" in caddyfile
    assert "reverse_proxy readplane:8686" in caddyfile
    assert (
        compose["services"]["readplane"]["environment"]["READPLANE_ROUTE_MODE"]
        == "active"
    )


def test_dev_caddy_routes_only_smart_mix_summaries_through_readplane():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()

    assert "@smart_mix_full" in caddyfile
    assert "path /api/tracks/by-entity/*/mix-profile" in caddyfile
    assert "query detail=full" in caddyfile
    full_route = caddyfile.split("handle @smart_mix_full", maxsplit=1)[1].split(
        "}", maxsplit=1
    )[0]
    assert "reverse_proxy api:8585" in full_route
    assert "method GET" in caddyfile


def test_dev_caddy_routes_vdj_media_directly_to_fastapi():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()

    assert "path_regexp vdj_media" in caddyfile
    vdj_media = caddyfile.split("(vdj_media_api)", maxsplit=1)[1].split(
        "(api_backend)", maxsplit=1
    )[0]
    assert "/api/vdj/tracks/by-entity/[^/]+/(?:playback|stream)$" in vdj_media
    assert "reverse_proxy api:8585" in vdj_media


def test_dynamic_and_admin_smart_mix_routes_stay_on_fastapi():
    caddyfile = (ROOT / "data/caddy/Caddyfile.readplane.dev").read_text()

    assert (
        "/api/playback/transition-plans"
        not in caddyfile.split("(readplane_listen)", maxsplit=1)[1].split(
            "(auth_api)", maxsplit=1
        )[0]
    )
    assert (
        "/api/admin/smart-mix"
        not in caddyfile.split("(readplane_listen)", maxsplit=1)[1].split(
            "(auth_api)", maxsplit=1
        )[0]
    )
    assert "method GET" in caddyfile


def test_production_traefik_routes_canonical_catalog_gets_to_readplane():
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    api_labels = compose["services"]["crate-api"]["labels"]
    readplane = compose["services"]["crate-readplane"]
    labels = readplane["labels"]

    assert labels["traefik.enable"] is True
    rule = labels["traefik.http.routers.crate-readplane-interactive.rule"]
    assert "Host(`api.${DOMAIN}`)" in rule
    assert "Method(`GET`" in rule
    assert "PathPrefix(`/api/catalog/`)" in rule
    assert labels["traefik.http.routers.crate-readplane-interactive.priority"] > 0
    assert api_labels["traefik.http.routers.crate-api-vdj-media.priority"] > 110
    assert (
        labels["traefik.http.services.crate-readplane.loadbalancer.server.port"] == 8686
    )
    assert (
        "READPLANE_ROUTE_MODE=${READPLANE_ROUTE_MODE:-active}"
        in readplane["environment"]
    )


def test_readplane_media_mounts_are_read_only_and_cutover_defaults_off():
    production = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())["services"][
        "crate-readplane"
    ]
    home = yaml.safe_load((ROOT / "docker-compose.home.yaml").read_text())["services"][
        "crate-readplane"
    ]
    development = yaml.safe_load(
        (ROOT / "docker-compose.readplane.dev.yaml").read_text()
    )["services"]["readplane"]

    for service in (production, home, development):
        environment = service["environment"]
        rendered = (
            "\n".join(environment)
            if isinstance(environment, list)
            else str(environment)
        )
        assert "READPLANE_LOCAL_MEDIA_ENABLED" in rendered
        assert any(str(volume).endswith(":/music:ro") for volume in service["volumes"])
        assert any(str(volume).endswith(":/cache:ro") for volume in service["volumes"])
        assert all(":/data" not in str(volume) for volume in service["volumes"])


# ---------------------------------------------------------------------------
# Development Caddy: the readplane only ever receives read methods.
#
# The readplane answers GET/HEAD natively and must never see a mutation
# (app/readplane/AGENTS.md "Hard rules"). These guards parse the
# `(readplane_listen)` snippet of the dev Caddyfile instead of the whole file,
# so they depend on nothing but that snippet and the site blocks importing it.
# ---------------------------------------------------------------------------

_CADDYFILE = ROOT / "data/caddy/Caddyfile.readplane.dev"
_READPLANE_SNIPPET = "readplane_listen"
_READPLANE_BACKEND = "readplane:8686"
_API_BACKEND = "api:8585"
_READ_METHODS = frozenset({"GET", "HEAD"})
_MUTATION_METHODS = ("POST", "PUT", "PATCH", "DELETE")
_CATALOG_PATHS = ("/api/catalog/artists", "/api/catalog/albums/42")
_READPLANE_SITES = frozenset(
    {"https://listen.dev.lespedants.org", "https://api.dev.lespedants.org"}
)
_REVERSE_PROXY = re.compile(r"reverse_proxy\s+(\S+)")


def _block_body(text: str, opener: str, start: int = 0) -> str:
    """Body of the first brace-matched block opened by ``opener`` after ``start``."""
    begin = text.index(opener, start) + len(opener)
    depth = 1
    for position in range(begin, len(text)):
        char = text[position]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[begin:position]
    raise AssertionError(f"unterminated Caddy block {opener!r}")


def _caddy_snippet(caddy: str, name: str) -> str:
    return _block_body(caddy, f"({name}) {{")


def _caddy_named_matcher(scope: str, name: str) -> list[str]:
    """Directives of the named matcher ``@name`` defined inside ``scope``.

    Supports the block form (``@name { ... }``) and the single-line form
    (``@name directive args``).
    """
    block_opener = f"@{name} {{"
    block = re.search(rf"^\s*{re.escape(block_opener)}$", scope, re.MULTILINE)
    if block:
        body = _block_body(scope, block_opener, block.start())
        return [line.strip() for line in body.splitlines() if line.strip()]
    inline = re.search(rf"^\s*@{re.escape(name)}\s+(.+?)\s*$", scope, re.MULTILINE)
    assert inline, f"matcher @{name} is not defined"
    return [inline.group(1)]


def _caddy_matcher_methods(directives: list[str]) -> set[str]:
    """HTTP methods listed by the ``method`` directive(s) of a named matcher."""
    methods: set[str] = set()
    for directive in directives:
        tokens = directive.split()
        if tokens and tokens[0] == "method":
            methods.update(token.upper() for token in tokens[1:])
    return methods


def _assert_read_only_methods(methods: set[str], where: str) -> None:
    assert methods, f"{where}: no method matcher, every method would be routed"
    assert "GET" in methods, f"{where}: GET is not matched ({sorted(methods)})"
    forbidden = methods - _READ_METHODS
    assert not forbidden, f"{where}: non read-only methods {sorted(forbidden)}"


def _caddy_readplane_matcher(caddy: str) -> list[str]:
    """Directives of ``@readplane_listen`` inside the ``(readplane_listen)`` snippet."""
    return _caddy_named_matcher(
        _caddy_snippet(caddy, _READPLANE_SNIPPET), _READPLANE_SNIPPET
    )


def _assert_caddy_readplane_matcher_read_only(caddy: str) -> None:
    """R1: the @readplane_listen matcher lists GET and only GET/HEAD."""
    methods = _caddy_matcher_methods(_caddy_readplane_matcher(caddy))
    _assert_read_only_methods(methods, f"@{_READPLANE_SNIPPET}")


@dataclass(frozen=True)
class _CaddyHandler:
    """One ``handle`` block of a route, with the matcher that guards it."""

    source: str
    backend: str | None
    methods: frozenset[str] | None = None
    paths: tuple[str, ...] | None = None
    path_regexps: tuple[str, ...] = ()
    needs_query: bool = False
    needs_header: bool = False

    def matches(self, method: str, path: str) -> bool:
        # The simulated request carries no query string and no Authorization
        # header, so `query` and `header_regexp` matchers never match it.
        if self.methods is not None and method.upper() not in self.methods:
            return False
        if self.paths is not None and not any(
            fnmatch.fnmatchcase(path, pattern) for pattern in self.paths
        ):
            return False
        if any(re.search(pattern, path) is None for pattern in self.path_regexps):
            return False
        return not (self.needs_query or self.needs_header)


def _caddy_handler(source: str, directives: list[str], backend: str | None):
    methods = paths = None
    regexps: list[str] = []
    needs_query = needs_header = False
    for directive in directives:
        tokens = directive.split()
        kind = tokens[0]
        if kind == "method":
            methods = frozenset(token.upper() for token in tokens[1:])
        elif kind == "path":
            paths = tuple(tokens[1:])
        elif kind == "path_regexp":
            regexps.append(tokens[-1])
        elif kind == "query":
            needs_query = True
        elif kind == "header_regexp":
            needs_header = True
        else:
            raise AssertionError(
                f"({source}): unsupported matcher directive {kind!r}; extend the guard"
            )
    return _CaddyHandler(
        source=source,
        backend=backend,
        methods=methods,
        paths=paths,
        path_regexps=tuple(regexps),
        needs_query=needs_query,
        needs_header=needs_header,
    )


def _caddy_backend(handle_body: str) -> str | None:
    match = _REVERSE_PROXY.search(handle_body)
    return match.group(1) if match else None


def _caddy_snippet_handlers(caddy: str, name: str) -> list[_CaddyHandler]:
    snippet = _caddy_snippet(caddy, name)
    handlers = []
    for match in re.finditer(r"handle @(\w+) \{", snippet):
        directives = _caddy_named_matcher(snippet, match.group(1))
        backend = _caddy_backend(_block_body(snippet, match.group(0), match.start()))
        handlers.append(_caddy_handler(name, directives, backend))
    assert handlers, f"snippet ({name}) has no handle block"
    return handlers


def _caddy_sites(caddy: str) -> dict[str, str]:
    """Site address -> site block body, for every top-level site block."""
    sites = {}
    for match in re.finditer(r"^(https?://\S+) \{$", caddy, re.MULTILINE):
        sites[match.group(1)] = _block_body(caddy, match.group(0), match.start())
    return sites


def _caddy_route_handlers(caddy: str, site_body: str) -> list[_CaddyHandler]:
    """Handlers of a site's ``route`` block, in evaluation order."""
    lines = _block_body(site_body, "route {").splitlines()
    handlers: list[_CaddyHandler] = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line:
            continue
        if line.startswith("import "):
            handlers.extend(_caddy_snippet_handlers(caddy, line.split()[1]))
        elif line == "handle {":
            depth, body = 1, []
            while depth:
                current = lines[index]
                index += 1
                depth += current.count("{") - current.count("}")
                body.append(current)
            handlers.append(
                _CaddyHandler(source="handle", backend=_caddy_backend("\n".join(body)))
            )
        else:
            raise AssertionError(
                f"unsupported route directive {line!r}; extend the guard"
            )
    return handlers


def _caddy_first_handler(
    handlers: list[_CaddyHandler], method: str, path: str
) -> tuple[int, _CaddyHandler]:
    for position, handler in enumerate(handlers):
        if handler.matches(method, path):
            return position, handler
    raise AssertionError(f"no handler matches {method} {path}")


def _assert_caddy_mutations_fall_through(caddy: str) -> None:
    """R2: mutations to readplane paths pass readplane_listen and reach api:8585."""
    snippet = _caddy_snippet(caddy, _READPLANE_SNIPPET)
    readplane_handle = _block_body(snippet, f"handle @{_READPLANE_SNIPPET} {{")
    proxied = f"reverse_proxy {_READPLANE_BACKEND}"
    assert proxied in readplane_handle
    assert caddy.count(proxied) == readplane_handle.count(proxied) == 1, (
        f"{_READPLANE_BACKEND} must only be proxied from handle @{_READPLANE_SNIPPET}"
    )

    import_line = re.compile(rf"^\s*import {_READPLANE_SNIPPET}\s*$", re.MULTILINE)
    sites = {
        address: body
        for address, body in _caddy_sites(caddy).items()
        if import_line.search(body)
    }
    assert _READPLANE_SITES <= sites.keys(), sorted(sites)

    for address, body in sites.items():
        handlers = _caddy_route_handlers(caddy, body)
        positions = [
            position
            for position, handler in enumerate(handlers)
            if handler.source == _READPLANE_SNIPPET
        ]
        assert len(positions) == 1, (address, positions)
        readplane_position = positions[0]
        assert handlers[readplane_position].backend == _READPLANE_BACKEND, address

        for path in _CATALOG_PATHS:
            get_position, get_handler = _caddy_first_handler(handlers, "GET", path)
            assert get_position == readplane_position, (address, path, get_handler)
            assert get_handler.backend == _READPLANE_BACKEND, (address, path)

            for method in _MUTATION_METHODS:
                position, handler = _caddy_first_handler(handlers, method, path)
                assert handler.backend == _API_BACKEND, (address, method, path, handler)
                assert position > readplane_position, (address, method, path, handler)
                assert handler.source in ("api_backend", "handle"), (address, handler)
                if handler.source == "api_backend":
                    assert "/api/*" in handler.paths, (address, handler)


def _with_readplane_method(caddy: str, method_line: str | None) -> str:
    """Copy of the Caddyfile whose ``@readplane_listen`` matcher uses ``method_line``.

    Only the ``(readplane_listen)`` snippet is touched; ``None`` removes the
    ``method`` directive entirely.
    """
    opener = f"({_READPLANE_SNIPPET}) {{"
    body = _block_body(caddy, opener)
    begin = caddy.index(opener) + len(opener)
    original = "\t\tmethod GET\n"
    assert body.count(original) == 1, body
    replacement = "" if method_line is None else f"\t\t{method_line}\n"
    return caddy[:begin] + body.replace(original, replacement, 1) + caddy[begin + len(body) :]


def test_dev_caddy_readplane_matcher_only_matches_read_methods():
    # R1: parsed from the @readplane_listen block alone, not from the whole file.
    caddy = _CADDYFILE.read_text()
    directives = _caddy_readplane_matcher(caddy)

    assert any(d.startswith("method ") for d in directives), directives
    assert _caddy_matcher_methods(directives) == {"GET"}
    _assert_caddy_readplane_matcher_read_only(caddy)

    paths = [d for d in directives if d.startswith("path ")]
    assert len(paths) == 1, directives
    assert "/api/catalog/*" in paths[0].split()


def test_dev_caddy_sites_fall_through_mutations_to_fastapi():
    # R2: listen.dev and api.dev import readplane_listen; POST/PUT/PATCH/DELETE
    # on /api/catalog/* skip it and reach api:8585 from a later handler.
    _assert_caddy_mutations_fall_through(_CADDYFILE.read_text())


def test_dev_caddy_method_guard_accepts_head_alongside_get():
    # HEAD is a read method the readplane answers natively; the guard allows it.
    caddy = _with_readplane_method(_CADDYFILE.read_text(), "method GET HEAD")

    _assert_caddy_readplane_matcher_read_only(caddy)
    _assert_caddy_mutations_fall_through(caddy)


@pytest.mark.parametrize(
    "method_line",
    [
        "method GET POST",
        "method GET PUT",
        "method GET PATCH",
        "method GET DELETE",
        "method GET HEAD POST",
        "method POST",
        "method get post",
        "method GET  PUT",
        "method HEAD",
        "method",
        None,
    ],
)
def test_dev_caddy_method_guard_rejects_mutated_readplane_matcher(method_line):
    # R4: in-memory mutated copies of the real matcher are rejected by the R1 guard.
    caddy = _CADDYFILE.read_text()
    mutated = _with_readplane_method(caddy, method_line)
    assert mutated != caddy

    with pytest.raises(AssertionError):
        _assert_caddy_readplane_matcher_read_only(mutated)


@pytest.mark.parametrize(
    "method_line",
    [
        "method GET POST",
        "method GET PUT",
        "method GET PATCH",
        "method GET DELETE",
        "method HEAD",
        None,
    ],
)
def test_dev_caddy_fall_through_guard_rejects_mutated_readplane_matcher(method_line):
    # R4: with a mutated matcher the simulated mutation (or GET) no longer lands
    # where the fall-through guard requires, so it fails too.
    caddy = _CADDYFILE.read_text()
    mutated = _with_readplane_method(caddy, method_line)
    assert mutated != caddy

    with pytest.raises(AssertionError):
        _assert_caddy_mutations_fall_through(mutated)


def test_dev_caddy_fall_through_guard_rejects_readplane_proxy_outside_its_handle():
    # R2/R4: a second `reverse_proxy readplane:8686` outside handle @readplane_listen
    # (here: the api.dev catch-all) is rejected.
    caddy = _CADDYFILE.read_text()
    api_site = "https://api.dev.lespedants.org {"
    site_body = _block_body(caddy, api_site)
    begin = caddy.index(api_site) + len(api_site)
    catch_all = f"\t\thandle {{\n\t\t\treverse_proxy {_API_BACKEND}\n\t\t}}\n"
    assert site_body.count(catch_all) == 1, site_body
    mutated_site = site_body.replace(
        catch_all, catch_all.replace(_API_BACKEND, _READPLANE_BACKEND), 1
    )
    mutated = caddy[:begin] + mutated_site + caddy[begin + len(site_body) :]
    assert mutated != caddy

    with pytest.raises(AssertionError):
        _assert_caddy_mutations_fall_through(mutated)


def test_dev_caddy_method_guard_depends_only_on_the_readplane_snippet():
    # A mutation-matching snippet that no site imports must not trip either
    # guard: they read the (readplane_listen) snippet and the importing sites only.
    caddy = _CADDYFILE.read_text()
    unrelated = (
        "\n(unrelated_api) {\n"
        "\t@unrelated_api {\n"
        "\t\tmethod GET POST PUT PATCH DELETE\n"
        "\t\tpath /api/unrelated/*\n"
        "\t}\n"
        "\thandle @unrelated_api {\n"
        f"\t\treverse_proxy {_API_BACKEND}\n"
        "\t}\n"
        "}\n"
    )

    _assert_caddy_readplane_matcher_read_only(caddy + unrelated)
    _assert_caddy_mutations_fall_through(caddy + unrelated)
