---
title: "Reading production errors in Admin without trusting what they say"
description: "Crate copies Sentry issues into PostgreSQL, has a model triage them as untrusted data and lets an agent draft a fix that a person reviews."
date: 2026-11-17
tags: [observability, Sentry, AI, GitHub Actions]
sources:
  - app/crate/error_inbox/digest.py
  - app/crate/llm/prompts/error_triage.py
  - app/crate/ai/transport.py
  - .github/workflows/error-autofix.yml
  - docs/technical/observability.md
  - docs/technical/evidence/observability/sentry-triage-2026-11.md
  - docs/technical/evidence/observability/error-triage-eval-2026-11-07.md
---

On 4 November 2026, Crate's Sentry organisation held 92 unresolved issues: 79 errors and 13 performance
issues. Reading them meant leaving Admin for another tool, and the few real bugs were buried under reports
that weren't bugs at all. The goal was to bring errors into Admin, sort them, and get the real ones fixed.

Errors make awkward input. They carry whatever text the failing code had in hand: paths from the music
library, URLs, sometimes a credential. Crate's repository is public, and so are the logs of its GitHub
Actions runs. Every part of the design starts from those two facts.

## Fixing the noise at the source

Before any inbox existed, each unresolved issue got a label: bug, infrastructure, external dependency, client
environment or noise. Most of the backlog was Crate reporting on itself. Listen's API client sent every
rejected `fetch` as an error, which alone accounted for 47 of the 79. Server errors showed up as one issue per
endpoint, and the same call split into several issues because of minified names and path prefixes. API events
even carried `service=workers`, because importing the broker initialised Sentry a second time.

Each cause was fixed in the code. Network failures became breadcrumbs, server errors collapsed into one
`api-unavailable` fingerprint per app, frame paths are normalised in the SDK and the Python SDK stopped sending
local variables. Only after that release went out were the noise groups resolved in bulk, 68 issues plus four
more; resolving them earlier would only have reopened them. The 79 labels stayed as a reference set.

## Admin reads PostgreSQL, never Sentry

![Sentry feeds a sync task every five minutes that stores issues and sanitized digests in PostgreSQL; Admin reads only PostgreSQL; triage runs on the AI lane; Launch fix dispatches a sandboxed agent in GitHub Actions whose draft pull request a person merges, which resolves the issue in Sentry.](/blog/reading-errors-without-trusting-them/inbox-flow.svg)

A worker task, `sync_error_issues`, reads Sentry every five minutes. It lists unresolved issues of the error
category, up to 100 per page and five pages per pass, and stores them in Crate's own tables. The Errors page
reads only those tables, so a slow or unreachable Sentry never slows it down. When Sentry fails, the page says
so and keeps showing the last good sync.

For up to 25 issues per pass, highest score first, the sync downloads the latest event and keeps a digest of
it instead of the event itself. The digest holds at most three chained exceptions, the last 20 application
frames with the source lines Sentry stored, ten allowlisted tags and the last ten breadcrumbs cut to 160
characters. Paths under `/music/` become `/music/<path>`, query strings are dropped, e-mail and IP addresses
are stripped, and the whole digest stays under 24 KB. The detail page and the model both work from it.

Ordering never waits for a model. Each issue gets a deterministic score from its level, its state (new,
regressed, escalating), the service, users and events in the last 24 hours, and Sentry's own priority. Issues
scoring 70 or more form a critical lane at the top. Issues with the same exception type and innermost
application frame share a group key and collapse into one row.

Sentry's regional hosts, such as `us.sentry.io`, don't serve the API root, so the token's scope check always
goes to `sentry.io`, and issues are looked up through organisation-scoped endpoints.

## A model reads the digest as data

Triage asks a model for a classification, a severity, a confidence and, when it applies, which similar issue
this one duplicates. It runs as a task on the `ai` worker lane, never inside an Admin request. It sends the
digest and up to ten duplicate candidates; the title, the culprit and the Sentry link never leave the server.

An error message is text someone else controls. A track title or a crafted URL can end up in an exception and
from there in a prompt. So the payload goes inside a fence, encoded so that nothing in it can close the fence
early:

```python source="app/crate/llm/prompts/error_triage.py#L107-L118" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "untrusted_block"
def _safe_json(value: Any) -> str:
    """Compact JSON that cannot close the untrusted fence: <, > and & are escaped."""
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, default=str
    )
    return (
        encoded.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    )


def untrusted_block(payload: Mapping[str, Any]) -> str:
    return f"{UNTRUSTED_OPEN}\n{_safe_json(payload)}\n{UNTRUSTED_CLOSE}"
```

The system prompt tells the model to treat everything inside the fence as data and to ignore any instruction
it finds there. The answer isn't trusted either. It must match a closed schema, and the server checks what a
schema can't express:

```python source="app/crate/llm/prompts/error_triage.py#L223-L232" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "not in candidates"
def check_output(
    result: ErrorAssessment, *, candidates: Sequence[str], frame_count: int
) -> None:
    """Server-side bounds, also for results that did not come through a bound model."""
    if result.duplicate_of is not None and result.duplicate_of not in candidates:
        raise ValueError("duplicate_of is not one of the candidates")
    if len(result.suspected_frames) > MAX_SUSPECTED_FRAMES or any(
        not 0 <= index < frame_count for index in result.suspected_frames
    ):
        raise ValueError("suspected_frames is out of range")
```

A duplicate the model invented, or a frame that doesn't exist, fails the call, and nothing is saved.

## Measuring it before switching it on

Automatic triage ships switched off. To decide whether to turn it on, an evaluation task sends the real triage
request for each of the 79 labelled issues and compares the answers with the labels, saving nothing.

The first run, with `gemini-3.8-flash`, could only send 16 issues, because the inbox no longer held the
resolved ones. Five of those 16 answers came back as invalid JSON. They had stopped at the action's
2,048-token output limit, and Gemini counts the model's reasoning against that limit, so the visible answer
ended halfway. The runtime now recognises that stop for each provider and reports `AI_OUTPUT_LIMIT` instead of
a generic invalid answer:

```python source="app/crate/ai/transport.py#L65-L72" commit="6b53412a6602c1d7fb34c1ef14498f8263b11243" "MAX_TOKENS"
    try:
        if provider == "gemini":
            return data["candidates"][0].get("finishReason") == "MAX_TOKENS"
        if provider in {"deepseek", "openai_compatible"}:
            return data["choices"][0].get("finish_reason") == "length"
        return data.get("done_reason") == "length"
    except (KeyError, IndexError, TypeError, AttributeError):
        return False
```

The triage limit went up to 8,192 tokens, and the evaluation now reads the issues the inbox dropped straight
from Sentry, building their digests in memory. The second run sent 78 of the 79; Sentry had no events left
for the last one. Classification matched the labels in 89.7% of the answers and severity in 83.3%, with no
invalid or cut-off answers, for $0.79.

## A fix button that runs in a public log

For a real bug, an admin can press _Launch fix_. Crate's worker dispatches a GitHub Actions workflow with two
inputs, the issue's short id and an optional note. Nothing else from Crate reaches GitHub. The workflow reads
the issue from Sentry with a read-only token and writes it to a file outside the repository, because the
run's log is public.

An agent then has 30 minutes to reproduce the bug with a failing test, fix it and commit with
`Fixes <SHORT-ID>`. If it can't reproduce the bug, it stops and leaves a report. It can't push, and every
command it runs is sandboxed with bubblewrap, out of reach of the job's credentials. The first real run tested
that part the hard way: the job had never installed `socat`, which the sandbox needs, so every command failed.
A second job opens a draft pull request through a GitHub App, so CI runs on it, and a person decides whether
to merge. Once merged, Sentry's GitHub integration resolves the issue, and each image build attaches its
commits to the Sentry release, so an error that comes back shows up as a regression.

## What is still open

Severity drifts one level low: three of the four `high` issues came back as `medium`. The reference set has no
`critical` label, so mistaking a critical bug for noise hasn't been measured. The one confident `critical`
answer was a synthetic diagnostic error, which would have landed in the critical lane, and the alert on that
lane ships disabled for now. The autofix job has no PostgreSQL either, so a bug that needs the database can't
be reproduced there yet.

## Read the code

The digest is built in `app/crate/error_inbox/digest.py`, the triage prompt and its checks are in
`app/crate/llm/prompts/error_triage.py` and the output-limit detection is in `app/crate/ai/transport.py`. The
fix workflow is `.github/workflows/error-autofix.yml`. Both evaluation reports are in
`docs/technical/evidence/observability/`.
