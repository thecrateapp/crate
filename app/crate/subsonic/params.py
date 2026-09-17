"""Normalize ordered query and form parameters for OpenSubsonic routes."""

from collections import defaultdict
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from starlette.requests import Request


@dataclass(frozen=True)
class RequestParameters:
    values: Mapping[str, tuple[str, ...]]

    def contains(self, name: str) -> bool:
        return name in self.values

    def first(self, name: str, default: str | None = None) -> str | None:
        values = self.values.get(name)
        return values[0] if values else default

    def get_all(self, name: str) -> tuple[str, ...]:
        return self.values.get(name, ())


async def collect_parameters(request: Request) -> RequestParameters:
    """Collect query values followed by form values, preserving repetitions."""
    items = list(request.query_params.multi_items())
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if (
        request.method.upper() == "POST"
        and content_type == "application/x-www-form-urlencoded"
        and not getattr(request.state, "subsonic_form_params_merged", False)
    ):
        form = await request.form()
        items.extend(
            (name, value)
            for name, value in form.multi_items()
            if isinstance(value, str)
        )

    grouped: defaultdict[str, list[str]] = defaultdict(list)
    for name, value in items:
        grouped[name].append(value)

    return RequestParameters(
        MappingProxyType({name: tuple(values) for name, values in grouped.items()})
    )
