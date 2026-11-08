"""AI refinement of evaluated edges with a real model (Smart Mix 3, SM5).

``run_eval.py --refine <provider>/<model>`` hands every v3 edge's candidate menu
to a model through the same pieces as the SM4 task
(``crate.worker_handlers.smart_mix_refinement``), unchanged:

- the numeric input, system prompt and response schema of
  ``crate.llm.prompts.smart_mix_transition``;
- the native request of ``crate.ai.transport.generate`` with the action's profile,
  derived from the connection's catalog entry the way the admin's default-model
  flow binds ``smart_mix.transition.refine`` (``crate.ai.default_model``);
- the runtime's JSON parsing and schema validation (``AI_RESPONSE_INVALID`` is a
  ``response_invalid`` rejection, as in the task) and
  ``crate.smart_mix.refinement.apply_refinement`` with its closed rejection codes.

It leaves out what only the server needs: the binding, the invocation ledger and
daily budgets in PostgreSQL, Redis and the refinement table. Nothing is written to
the database.

Spend is bounded and paid once:

- every answer (and every failure) is cached on disk by the hash of the request,
  so a rerun pays nothing; a failed call is not retried unless ``retry_failed``;
- ``Budget`` keeps a ledger of what every run spent and refuses a call whose worst
  case (the input's byte count as tokens, the runtime's admission bound, plus every
  output token) would cross the limit;
- ``RateLimiter`` spaces call starts.

The API key comes from the server's environment variable for the provider and is
only passed to the transport; it is never logged or written.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from common import APP_ROOT, ensure_app_on_path

ensure_app_on_path()

from crate.ai.actions import get_action  # noqa: E402
from crate.ai.capabilities import model_capabilities, validate_profile  # noqa: E402
from crate.ai.contracts import (  # noqa: E402
    AIConfigurationError,
    ModelCapabilities,
    ProfileConfig,
    ReasoningConfig,
)
from crate.ai.default_model import derive_action_config  # noqa: E402
from crate.ai.runtime import _parse as parse_structured_text  # noqa: E402
from crate.ai.runtime import estimated_input_tokens  # noqa: E402
from crate.ai.transport import NativeResponse  # noqa: E402
from crate.llm.prompts.smart_mix_transition import (  # noqa: E402
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    SmartMixRefinementResponse,
    build_refinement_input,
    render_refinement_prompt,
)
from crate.smart_mix.models import (  # noqa: E402
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
    TransitionPlan,
)
from crate.smart_mix.policy import PLANNER_POLICY_V3  # noqa: E402
from crate.smart_mix.refinement import apply_refinement  # noqa: E402

REFINE_ACTION = "smart_mix.transition.refine"
PROVIDERS = ("gemini", "deepseek", "ollama", "openai_compatible")
# The variables the server reads for an environment connection
# (crate.ai.configuration._KEYS).
API_KEY_VARIABLES: dict[str, tuple[str, ...]] = {
    "gemini": ("GEMINI_API_KEY", "AUDIOMUSE_GEMINI_API_KEY"),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "ollama": (),
}
# The task's mapping of runtime errors (smart_mix_refinement.FAILED_CODES): the call
# went out, or this input can never fit the profile.
FAILED_CODES = frozenset(
    {"AI_PROVIDER_FAILED", "AI_PROVIDER_TIMEOUT", "AI_INPUT_TOO_LARGE"}
)
RESPONSE_INVALID = "response_invalid"
SINGLE_CANDIDATE = "single_candidate"
CACHE_VERSION = 1


@dataclass(frozen=True, slots=True)
class Price:
    """USD per million tokens. Thinking tokens are billed as output."""

    input_per_million: float
    output_per_million: float
    cached_input_per_million: float


# Paid tier, standard, prompts up to 200K tokens.
PRICE_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing"
PRICE_DATE = "2026-11-07"
PRICES: dict[str, Price] = {
    # Launch price until 2026-12-31; 1.50 / 7.50 / 0.15 from 2027-01-01.
    "gemini/gemini-3.8-flash": Price(0.75, 3.75, 0.075),
    "gemini/gemini-3.1-pro-preview": Price(2.00, 12.00, 0.20),
    "gemini/gemini-2.5-pro": Price(1.25, 10.00, 0.125),
    "gemini/gemini-2.5-flash": Price(0.30, 2.50, 0.03),
    "gemini/gemini-2.5-flash-lite": Price(0.10, 0.40, 0.01),
}

Status = Literal["ready", "rejected", "failed", "unavailable"]


class BudgetExceeded(RuntimeError):
    """The next call could take the spend over the limit."""


def parse_target(spec: str) -> tuple[str, str]:
    """``provider/model``: the provider is the first segment."""
    provider, _, model = spec.partition("/")
    if provider not in PROVIDERS or not model:
        raise ValueError(
            f"--refine takes <provider>/<model> with a provider in {PROVIDERS}"
        )
    return provider, model


def parse_reasoning(value: str) -> ReasoningConfig:
    """``low``/``medium``/``high``/``minimal``, ``off``, ``on``, ``default``, ``budget:N``."""
    if value == "default":
        return ReasoningConfig()
    if value == "off":
        return ReasoningConfig(mode="disabled")
    if value == "on":
        return ReasoningConfig(mode="enabled")
    if value in {"minimal", "low", "medium", "high"}:
        return ReasoningConfig(mode="level", level=value)
    if value.startswith("budget:") and value[7:].isdigit():
        return ReasoningConfig(mode="budget", budget_tokens=int(value[7:]))
    raise ValueError(f"Unknown reasoning {value!r}")


def environment_api_key(provider: str) -> str:
    """The provider's key from the server's environment variables; never printed."""
    names = API_KEY_VARIABLES.get(provider)
    if names is None:
        raise ValueError(f"{provider} keys are not read from the environment")
    if not names:
        return ""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    raise ValueError(f"Set {' or '.join(names)} to refine with {provider}")


def call_cost_usd(usage: Mapping[str, Any] | None, price: Price) -> float | None:
    if not usage:
        return None
    cached = int(usage.get("cached_input_tokens") or 0)
    fresh = max(0, int(usage.get("input_tokens") or 0) - cached)
    output = int(usage.get("output_tokens") or 0) + int(
        usage.get("thought_tokens") or 0
    )
    return (
        fresh * price.input_per_million
        + cached * price.cached_input_per_million
        + output * price.output_per_million
    ) / 1_000_000


@dataclass(frozen=True, slots=True)
class RefineTarget:
    provider: str
    model_id: str
    config: ProfileConfig
    endpoint: str | None = None
    connection_id: str | None = None
    connection_label: str | None = None
    # Whether Crate's own profile validation accepts this model and profile: the
    # admin could bind it today.
    profile_validated: bool = True

    @property
    def label(self) -> str:
        return f"{self.provider}/{self.model_id}"

    @property
    def price(self) -> Price | None:
        return PRICES.get(self.label)

    def transport_context(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model_id": self.model_id,
            "config": self.config.model_dump(mode="json"),
            "endpoint": self.endpoint,
        }

    def to_meta(self) -> dict[str, Any]:
        price = self.price
        return {
            "model": self.label,
            "connectionId": self.connection_id,
            "connectionLabel": self.connection_label,
            "config": self.config.model_dump(mode="json"),
            "profileValidated": self.profile_validated,
            "promptVersion": PROMPT_VERSION,
            "price": {
                "inputPerMillion": price.input_per_million,
                "outputPerMillion": price.output_per_million,
                "cachedInputPerMillion": price.cached_input_per_million,
                "source": PRICE_SOURCE,
                "date": PRICE_DATE,
            }
            if price
            else None,
        }


def resolve_target(
    spec: str,
    *,
    connection: Mapping[str, Any] | None = None,
    reasoning: ReasoningConfig | None = None,
) -> RefineTarget:
    """The model and the action profile it would be bound with.

    With a connection (a row of ``ai_provider_connections``) the capabilities come
    from its catalog entry; without one, from Crate's manifest. A model whose
    capabilities Crate has not validated needs an explicit ``reasoning`` and is
    marked ``profile_validated=False``: the admin could not bind it as is.
    """
    provider, model_id = parse_target(spec)
    if connection is not None:
        if connection.get("provider") != provider:
            raise ValueError(
                f"The connection's provider is {connection.get('provider')!r},"
                f" not {provider!r}"
            )
        if connection.get("secret_source") not in {"environment", "none"}:
            raise ValueError(
                "Only connections whose key comes from the environment can be used"
            )
        entry = next(
            (
                item
                for item in connection.get("model_catalog") or ()
                if item.get("model_id") == model_id
            ),
            None,
        )
        if entry is None:
            raise ValueError(f"{model_id!r} is not in the connection's catalog")
        capabilities = ModelCapabilities.model_validate(entry)
    else:
        capabilities = model_capabilities(provider, model_id)

    derived = derive_action_config(capabilities, ReasoningConfig(), REFINE_ACTION)
    config = derived.config
    validated = config is not None
    if config is None:
        if reasoning is None:
            raise ValueError(
                f"{model_id!r} is not validated for {REFINE_ACTION}"
                f" ({derived.reason}); pass a reasoning to evaluate it anyway"
            )
        config = _action_profile(capabilities)
    if reasoning is not None and reasoning != config.reasoning:
        config = config.model_copy(update={"reasoning": reasoning})
        try:
            validate_profile(config, capabilities, REFINE_ACTION)
        except AIConfigurationError:
            validated = False
    return RefineTarget(
        provider=provider,
        model_id=model_id,
        config=config,
        endpoint=None if connection is None else connection.get("endpoint"),
        connection_id=None if connection is None else str(connection.get("id")),
        connection_label=None if connection is None else connection.get("label"),
        profile_validated=validated,
    )


def _action_profile(capabilities: ModelCapabilities) -> ProfileConfig:
    """The action's limits clamped to the model, as default_model derives them."""
    maxima = get_action(REFINE_ACTION).maxima
    output = maxima.max_output_tokens
    if capabilities.max_output_tokens is not None:
        output = min(output, capabilities.max_output_tokens)
    input_tokens = maxima.max_input_tokens
    if capabilities.context_window is not None:
        input_tokens = min(input_tokens, capabilities.context_window - output)
    return ProfileConfig(
        timeout_seconds=maxima.timeout_seconds,
        max_output_tokens=output,
        max_input_tokens=input_tokens,
    )


@dataclass(frozen=True, slots=True)
class EdgeJob:
    """One edge to refine: its profiles, v3 menu and context."""

    edge_id: str
    outgoing: TrackMixProfile
    incoming: TrackMixProfile
    candidates: tuple[TransitionCandidate, ...]
    context: TransitionContext
    genres: tuple[str | None, str | None] = (None, None)


@dataclass(frozen=True, slots=True)
class EdgeRefinement:
    """What the client would get for an edge: a plan when ``ready``."""

    status: Status
    code: str | None
    called: bool = False
    cached: bool = False
    candidate_index: int | None = None
    adjustments: dict[str, int | str] = field(default_factory=dict)
    plan: TransitionPlan | None = None
    reason: str | None = None
    confidence: float | None = None
    latency_ms: int | None = None
    usage: dict[str, Any] | None = None
    cost_usd: float | None = None
    cost_estimated: bool = False
    reported_model: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "code": self.code,
            "called": self.called,
            "cached": self.cached,
            "candidateIndex": self.candidate_index,
            "adjustments": dict(self.adjustments),
            "reason": self.reason,
            "confidence": self.confidence,
            "latencyMs": self.latency_ms,
            "usage": self.usage,
            "costUsd": self.cost_usd,
            "costEstimated": self.cost_estimated,
            "reportedModel": self.reported_model,
        }


class Budget:
    """Spend across runs, from an append-only ledger next to the cache.

    ``reserve`` refuses a call whose worst case would take the spend (plus calls in
    flight) over ``max_usd``; ``settle`` records what the call cost, or its worst
    case when the provider reported no usage.
    """

    def __init__(self, ledger: Path, max_usd: float) -> None:
        self.ledger = Path(ledger)
        self.max_usd = float(max_usd)
        self._lock = threading.Lock()
        self._in_flight = 0.0

    @property
    def spent_usd(self) -> float:
        if not self.ledger.is_file():
            return 0.0
        return sum(
            float(json.loads(line)["costUsd"])
            for line in self.ledger.read_text().splitlines()
            if line.strip()
        )

    def reserve(self, worst_case_usd: float) -> None:
        with self._lock:
            if self.spent_usd + self._in_flight + worst_case_usd > self.max_usd:
                raise BudgetExceeded(
                    f"spent {self.spent_usd:.4f} USD of {self.max_usd:.2f}"
                )
            self._in_flight += worst_case_usd

    def settle(self, worst_case_usd: float, entry: Mapping[str, Any]) -> None:
        with self._lock:
            self._in_flight = max(0.0, self._in_flight - worst_case_usd)
            self.ledger.parent.mkdir(parents=True, exist_ok=True)
            with self.ledger.open("a") as handle:
                handle.write(json.dumps(dict(entry), sort_keys=True) + "\n")


class RateLimiter:
    """At least ``interval`` seconds between call starts, across threads."""

    def __init__(
        self,
        interval: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.interval = max(0.0, float(interval))
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._next: float | None = None

    def wait(self) -> None:
        with self._lock:
            now = self._clock()
            if self._next is not None and now < self._next:
                self._sleep(self._next - now)
                now = self._next
            self._next = now + self.interval


Transport = Callable[..., NativeResponse]


class Refiner:
    """Refines edges with one model; see the module docstring."""

    def __init__(
        self,
        target: RefineTarget,
        *,
        api_key: str,
        cache_dir: Path,
        budget: Budget,
        transport: Transport | None = None,
        limiter: RateLimiter | None = None,
        send_genre: bool = True,
        retry_failed: bool = False,
    ) -> None:
        self.target = target
        self._api_key = api_key
        self.cache_dir = Path(cache_dir)
        self.budget = budget
        self._transport = transport or _live_transport()
        self.limiter = limiter or RateLimiter(1.0)
        self.send_genre = send_genre
        self.retry_failed = retry_failed
        self.budget_exhausted = False
        self._schema = SmartMixRefinementResponse.model_json_schema()

    def prompt(self, job: EdgeJob) -> str:
        return render_refinement_prompt(
            build_refinement_input(
                job.outgoing,
                job.incoming,
                job.candidates,
                policy=PLANNER_POLICY_V3,
                context=job.context,
                genres=job.genres,
                send_genre=self.send_genre,
            )
        )

    def worst_case_usd(self, job: EdgeJob) -> float:
        price = self.target.price
        if price is None:
            return 0.0
        tokens = estimated_input_tokens(self.prompt(job), SYSTEM_PROMPT, self._schema)
        return (
            tokens * price.input_per_million
            + self.target.config.max_output_tokens * price.output_per_million
        ) / 1_000_000

    def refine(self, job: EdgeJob) -> EdgeRefinement:
        """Refine one edge; raises ``BudgetExceeded`` before an unaffordable call."""
        if len(job.candidates) < 2:
            # The task stores this without calling the model.
            return EdgeRefinement(status="rejected", code=SINGLE_CANDIDATE)
        prompt = self.prompt(job)
        if (
            estimated_input_tokens(prompt, SYSTEM_PROMPT, self._schema)
            > self.target.config.max_input_tokens
        ):
            return EdgeRefinement(status="failed", code="AI_INPUT_TOO_LARGE")
        key = self._key(prompt)
        entry = self._read(key)
        cached = entry is not None and (
            entry["status"] == "answered" or not self.retry_failed
        )
        if not cached:
            entry = self._call(job, key, prompt)
        assert entry is not None
        return self._outcome(job, entry, cached=cached)

    def refine_many(
        self, jobs: Sequence[EdgeJob], *, concurrency: int = 1
    ) -> list[EdgeRefinement]:
        """Refine in order; once the budget refuses a call, the rest are unavailable."""

        def run(job: EdgeJob) -> EdgeRefinement:
            if (
                self.budget_exhausted
                and self._read(self._key(self.prompt(job))) is None
            ):
                return EdgeRefinement(status="unavailable", code="budget")
            try:
                return self.refine(job)
            except BudgetExceeded:
                self.budget_exhausted = True
                return EdgeRefinement(status="unavailable", code="budget")

        if concurrency <= 1:
            return [run(job) for job in jobs]
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            return list(pool.map(run, jobs))

    # --- calls and cache -------------------------------------------------------

    def _key(self, prompt: str) -> str:
        identity = {
            "v": CACHE_VERSION,
            "context": self.target.transport_context(),
            "system": SYSTEM_PROMPT,
            "prompt": prompt,
            "schema": self._schema,
        }
        canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()

    def _path(self, key: str) -> Path:
        return (
            self.cache_dir
            / self.target.provider
            / self.target.model_id.replace("/", "_")
            / key[:2]
            / f"{key}.json"
        )

    def _read(self, key: str) -> dict[str, Any] | None:
        path = self._path(key)
        if not path.is_file():
            return None
        return json.loads(path.read_text())

    def _call(self, job: EdgeJob, key: str, prompt: str) -> dict[str, Any]:
        worst = self.worst_case_usd(job)
        self.budget.reserve(worst)
        entry: dict[str, Any] = {
            "key": key,
            "model": self.target.label,
            "edgeId": job.edge_id,
            "createdAt": datetime.now(UTC).isoformat(),
        }
        try:
            self.limiter.wait()
            started = time.monotonic()
            try:
                response = self._transport(
                    self.target.transport_context(),
                    api_key=self._api_key,
                    prompt=prompt,
                    response_schema=self._schema,
                    system=SYSTEM_PROMPT,
                )
            except AIConfigurationError as error:
                entry.update(
                    status="failed",
                    errorCode=error.code,
                    latencyMs=round((time.monotonic() - started) * 1000),
                )
            except Exception:
                entry.update(
                    status="failed",
                    errorCode="AI_PROVIDER_FAILED",
                    latencyMs=round((time.monotonic() - started) * 1000),
                )
            else:
                entry.update(
                    status="answered",
                    text=response.text,
                    usage=response.usage,
                    reportedModel=response.reported_model,
                    latencyMs=response.duration_ms,
                )
        finally:
            cost = None
            price = self.target.price
            if entry.get("status") == "answered" and price is not None:
                cost = call_cost_usd(entry.get("usage"), price)
            estimated = cost is None
            entry.update(costUsd=worst if estimated else cost, costEstimated=estimated)
            self.budget.settle(
                worst,
                {
                    "at": entry["createdAt"],
                    "model": self.target.label,
                    "key": key,
                    "status": entry.get("status", "failed"),
                    "costUsd": entry["costUsd"],
                    "estimated": estimated,
                },
            )
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(entry, sort_keys=True) + "\n")
        return entry

    def _outcome(
        self, job: EdgeJob, entry: Mapping[str, Any], *, cached: bool
    ) -> EdgeRefinement:
        paid = {
            "called": True,
            "cached": cached,
            "latency_ms": entry.get("latencyMs"),
            "usage": entry.get("usage"),
            "cost_usd": entry.get("costUsd"),
            "cost_estimated": bool(entry.get("costEstimated")),
            "reported_model": entry.get("reportedModel"),
        }
        if entry["status"] != "answered":
            code = str(entry.get("errorCode") or "AI_PROVIDER_FAILED")
            if code == "AI_RESPONSE_INVALID":
                return EdgeRefinement(status="rejected", code=RESPONSE_INVALID, **paid)
            status: Status = "failed" if code in FAILED_CODES else "unavailable"
            return EdgeRefinement(status=status, code=code, **paid)
        try:
            response = SmartMixRefinementResponse.model_validate(
                parse_structured_text(str(entry["text"]))
            )
        except Exception:
            return EdgeRefinement(status="rejected", code=RESPONSE_INVALID, **paid)
        outcome = apply_refinement(
            job.candidates,
            response,
            (job.outgoing, job.incoming),
            PLANNER_POLICY_V3,
            context=job.context,
        )
        return EdgeRefinement(
            status=outcome.status,
            code=outcome.code,
            candidate_index=outcome.candidate_index,
            adjustments=dict(outcome.adjustments),
            plan=outcome.plan,
            reason=outcome.reason,
            confidence=outcome.confidence,
            **paid,
        )


def _live_transport() -> Transport:
    """``crate.ai.transport.generate``; its child process needs ``crate`` importable."""
    from crate.ai.transport import generate

    paths = [
        part for part in os.environ.get("PYTHONPATH", "").split(os.pathsep) if part
    ]
    if str(APP_ROOT) not in paths:
        os.environ["PYTHONPATH"] = os.pathsep.join([str(APP_ROOT), *paths])
    return generate


__all__ = [
    "PRICES",
    "PRICE_DATE",
    "PRICE_SOURCE",
    "Budget",
    "BudgetExceeded",
    "EdgeJob",
    "EdgeRefinement",
    "Price",
    "RateLimiter",
    "RefineTarget",
    "Refiner",
    "call_cost_usd",
    "environment_api_key",
    "parse_reasoning",
    "parse_target",
    "resolve_target",
]
