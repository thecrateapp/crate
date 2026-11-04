"""Static map of the code that can reach an AI provider (SMQ, SM3-D8).

The map parses ``app/crate`` without importing it. A function *calls a model*
when its body references a transmission primitive, or a function that calls a
model (fixed point over the whole package). Imports are resolved per scope,
including function-local imports and package re-exports.

It is deliberately conservative: dynamic dispatch through ``self`` or through
data structures is not followed, so the guard catches the direct and imported
call chains Crate uses today. Module-level references (handler registries,
route decorators) are not edges, which makes task handlers and HTTP routes the
roots of every model-calling chain.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from functools import cache
from pathlib import Path

CRATE_ROOT = Path(__file__).resolve().parents[1] / "crate"

# Functions that transmit a request to an AI provider.
PRIMITIVES = frozenset(
    {
        ("crate.ai.transport", "generate"),
        ("crate.ai.transport", "generate_legacy"),
        ("crate.ai.discovery", "discover_models"),
        ("crate.llm.provider", "_chat"),
    }
)

# Library packages that implement the AI layer itself; their unused helpers
# are not entry points.
AI_LIBRARY_PREFIXES = ("crate.ai.", "crate.llm.")

Node = tuple[str, str]  # (module, qualified function name)


def _module_name(path: Path) -> str:
    relative = path.relative_to(CRATE_ROOT.parent).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


@cache
def _module_paths() -> dict[str, Path]:
    return {
        _module_name(path): path
        for path in CRATE_ROOT.rglob("*.py")
        if "__pycache__" not in path.parts
    }


def _is_module(name: str) -> bool:
    return name in _module_paths()


def _absolute(module: str, level: int, target: str | None, is_package: bool) -> str:
    if level == 0:
        return target or ""
    base = module.split(".")
    if not is_package:
        base = base[:-1]
    if level > 1:
        base = base[: -(level - 1)]
    return ".".join([*base, target] if target else base)


def _import_bindings(module: str, nodes, is_package: bool) -> dict[str, tuple]:
    """Local name -> ("module", dotted) or ("symbol", module, name)."""
    bindings: dict[str, tuple] = {}
    for node in nodes:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    bindings[alias.asname] = ("module", alias.name)
                else:
                    head = alias.name.split(".")[0]
                    bindings[head] = ("module", head)
        elif isinstance(node, ast.ImportFrom):
            source = _absolute(module, node.level, node.module, is_package)
            for alias in node.names:
                local = alias.asname or alias.name
                dotted = f"{source}.{alias.name}"
                if _is_module(dotted):
                    bindings[local] = ("module", dotted)
                else:
                    bindings[local] = ("symbol", source, alias.name)
    return bindings


@dataclass
class _Module:
    name: str
    tree: ast.Module
    is_package: bool
    bindings: dict[str, tuple]
    definitions: set[str]


@cache
def _parsed(module: str) -> _Module | None:
    path = _module_paths().get(module)
    if path is None:
        return None
    tree = ast.parse(path.read_text(), filename=str(path))
    is_package = path.name == "__init__.py"
    top_imports = [
        node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))
    ]
    # try/except and if-guarded imports at module level still bind names.
    for node in tree.body:
        if isinstance(node, (ast.Try, ast.If)):
            top_imports.extend(
                child
                for child in ast.walk(node)
                if isinstance(child, (ast.Import, ast.ImportFrom))
            )
    definitions = {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }
    return _Module(
        module,
        tree,
        is_package,
        _import_bindings(module, top_imports, is_package),
        definitions,
    )


@cache
def canonical(module: str, name: str, _depth: int = 0) -> Node:
    """Follow package re-exports to the module that defines ``name``."""
    parsed = _parsed(module)
    if parsed is None or _depth > 10 or name in parsed.definitions:
        return (module, name)
    binding = parsed.bindings.get(name)
    if binding and binding[0] == "symbol":
        return canonical(binding[1], binding[2], _depth + 1)
    return (module, name)


def _dotted(node: ast.AST) -> list[str] | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return parts[::-1]
    # importlib.import_module("crate.x").name
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, (ast.Name, ast.Attribute))
        and (getattr(node.func, "id", None) or getattr(node.func, "attr", None))
        == "import_module"
        and node.args
        and isinstance(node.args[0], ast.Constant)
        and isinstance(node.args[0].value, str)
    ):
        parts.append("\0" + node.args[0].value)
        return parts[::-1]
    return None


def _resolve(parts: list[str], scope: dict[str, tuple], parsed: _Module) -> Node | None:
    head, rest = parts[0], parts[1:]
    if head.startswith("\0"):
        module = head[1:]
    else:
        binding = scope.get(head)
        if binding is None:
            if head in parsed.definitions and not rest:
                return (parsed.name, head)
            return None
        if binding[0] == "symbol":
            if rest:
                return None
            return canonical(binding[1], binding[2])
        module = binding[1]
    while rest and _is_module(f"{module}.{rest[0]}"):
        module = f"{module}.{rest.pop(0)}"
    if not rest:
        return None
    return canonical(module, rest[0])


def _functions(tree: ast.Module):
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node.name, node
        elif isinstance(node, ast.ClassDef):
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    yield f"{node.name}.{child.name}", child


@cache
def call_graph() -> dict[Node, frozenset[Node]]:
    """Every top-level function and method with the nodes it references."""
    graph: dict[Node, frozenset[Node]] = {}
    for module in _module_paths():
        parsed = _parsed(module)
        assert parsed is not None
        for qualname, function in _functions(parsed.tree):
            local = _import_bindings(
                module,
                [
                    node
                    for node in ast.walk(function)
                    if isinstance(node, (ast.Import, ast.ImportFrom))
                ],
                parsed.is_package,
            )
            scope = {**parsed.bindings, **local}
            targets: set[Node] = set()
            for node in ast.walk(function):
                if isinstance(node, ast.Attribute) and isinstance(
                    getattr(node, "ctx", None), ast.Load
                ):
                    parts = _dotted(node)
                elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                    parts = [node.id]
                else:
                    continue
                if parts:
                    target = _resolve(parts, scope, parsed)
                    if target is not None:
                        targets.add(target)
            graph[(module, qualname)] = frozenset(targets)
    return graph


@cache
def model_calling() -> frozenset[Node]:
    """Nodes that transmit, directly or through any chain of calls."""
    graph = call_graph()
    reached = set(PRIMITIVES)
    changed = True
    while changed:
        changed = False
        for node, targets in graph.items():
            if node not in reached and targets & reached:
                reached.add(node)
                changed = True
    return frozenset(reached)


@cache
def model_call_roots() -> frozenset[Node]:
    """Model-calling functions outside the AI library that nothing calls."""
    graph = call_graph()
    calling = model_calling()
    referenced = {target for targets in graph.values() for target in targets}
    return frozenset(
        node
        for node in calling
        if node in graph
        and node not in referenced
        and not node[0].startswith(AI_LIBRARY_PREFIXES)
    )


def task_handler_nodes() -> dict[str, Node]:
    """Task type -> handler node, resolved through the lazy handler registry."""
    import functools
    import inspect

    from crate.worker import TASK_HANDLERS

    nodes: dict[str, Node] = {}
    for task_type in TASK_HANDLERS:
        handler = inspect.unwrap(TASK_HANDLERS[task_type])
        while isinstance(handler, functools.partial):
            handler = handler.func
        nodes[task_type] = canonical(handler.__module__, handler.__qualname__)
    return nodes


def model_calling_task_types() -> frozenset[str]:
    calling = model_calling()
    return frozenset(
        task_type for task_type, node in task_handler_nodes().items() if node in calling
    )


def _from_imports(module: str, nodes, is_package: bool) -> set[Node]:
    names: set[Node] = set()
    for node in nodes:
        if isinstance(node, ast.ImportFrom):
            source = _absolute(module, node.level, node.module, is_package)
            for alias in node.names:
                names.add((source, alias.name))
                names.add(canonical(source, alias.name))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                parent, _, name = alias.name.rpartition(".")
                if parent:
                    names.add((parent, name))
    return names


def imports_by_function(module: str) -> dict[str, set[Node]]:
    """(source, name) pairs imported by each function, plus "<module>" scope."""
    parsed = _parsed(module)
    assert parsed is not None
    scopes: dict[str, set[Node]] = {}
    inside: set[int] = set()
    for qualname, function in _functions(parsed.tree):
        nodes = list(ast.walk(function))
        inside.update(id(node) for node in nodes)
        scopes[qualname] = _from_imports(module, nodes, parsed.is_package)
    scopes["<module>"] = _from_imports(
        module,
        [node for node in ast.walk(parsed.tree) if id(node) not in inside],
        parsed.is_package,
    )
    return scopes


def api_modules() -> list[str]:
    return sorted(
        module
        for module in _module_paths()
        if module == "crate.api" or module.startswith("crate.api.")
    )
