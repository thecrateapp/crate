---
title: "Reading production errors in Admin without trusting what they say"
description: "Crate copies Sentry issues into PostgreSQL, has a model triage them as untrusted data and lets an agent draft a fix that a person reviews."
date: 2026-11-17
draft: true
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

On 4 November 2026, our Sentry organisation had 92 unresolved issues: 79 errors and 13 performance
issues. We had to leave Admin to read them, and the few real bugs were buried under reports that weren't bugs
at all. We cleaned up the reporting code, brought the errors into Admin and added a path from an issue to a
reviewable fix.

Errors make awkward input. They carry whatever text the failing code had in hand: paths from the music
library, URLs, sometimes a credential. Our repository is public, and so are the logs of its GitHub Actions runs.
We need to control what reaches the model and the workflow, as well as what appears on the Errors page.

## Fixing the noise at the source

We first labelled the error issues as bug, infrastructure, external dependency, client environment or noise.
Most of the backlog came from our reporting code. The shared API client sent every rejected `fetch` as an error,
which accounted for 47 of the 79 issues: 35 from Listen and 12 from Admin. Server errors showed up as one issue per
endpoint, and the same call split into several issues because of minified names and path prefixes. API events
even carried `service=workers`, because importing the broker initialised Sentry a second time.

We changed network failures to breadcrumbs and grouped server errors under one `api-unavailable` fingerprint
per app. We also normalised frame paths in the SDK and stopped the Python SDK from sending local variables.
We deployed those changes before resolving the noise groups in bulk, 68 issues plus four more. Without the
reporting fixes, the next events would have reopened them. We kept the 79 labels as a reference set.

## Admin reads PostgreSQL, never Sentry

![Sentry feeds a sync task every five minutes that stores issues and sanitized digests in PostgreSQL; Admin reads only PostgreSQL; triage runs on the AI lane; Launch fix dispatches a sandboxed agent in GitHub Actions whose draft pull request a person merges, which resolves the issue in Sentry.](/blog/reading-errors-without-trusting-them/inbox-flow.svg)

We keep Sentry access in a worker task, `sync_error_issues`, which runs every five minutes. It lists unresolved
issues of the error category, up to 100 per page and five pages per pass, and stores them in our own tables.
The Errors page reads only those tables, so its requests never wait on Sentry. If the sync fails, the page
reports the failure and keeps showing the last good sync.

For up to 25 issues per pass, highest score first, the sync downloads the latest event and keeps a digest of
it instead of the event itself. The digest holds at most three chained exceptions, the last 20 application
frames with the source lines Sentry stored, ten allowlisted tags and the last ten breadcrumbs cut to 160
characters. Paths under `/music/` become `/music/<path>`, query strings are dropped, e-mail and IP addresses
are stripped, and the whole digest stays under 24 KB. The detail page and the model both work from it.

We order the inbox without waiting for a model. Each issue gets a deterministic score from its level, its state
(new, regressed, escalating), the service, users and events in the last 24 hours, and Sentry's own priority. Issues
scoring 70 or more enter a critical lane at the top. A saved triage assessment can also put an issue there if its
severity is `critical` and its confidence is at least 0.6. Issues with the same exception type and innermost
application frame share a group key and collapse into one row.

Sentry's regional hosts, such as `us.sentry.io`, don't serve the API root, so the token's scope check always
goes to `sentry.io`, and issues are looked up through organisation-scoped endpoints.

## A model reads the digest as data

For triage, we ask a model for a classification, a severity, a confidence and, when it applies, which similar
issue this one duplicates. We run that task on the `ai` worker lane, outside Admin requests. The task sends the
digest and up to ten duplicate candidates; the title, the culprit and the Sentry link never leave the server.

We treat error messages as untrusted input. A track title or a crafted URL can end up in an exception and from
there in a prompt. We wrap the payload in a fence and encode it so that its contents cannot close that fence
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
it finds there. We validate the answer before storing it: it must match a closed schema, and the server checks
the relationships that the schema can't express:

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

We ship automatic triage switched off. To evaluate it before enabling it, we send the real triage request for
each of the 79 labelled issues and compare the answers with the labels. The evaluation task saves no assessments.

Our first run, with `gemini-3.8-flash`, could only send 16 issues, because the inbox no longer held the
resolved ones. Five of those 16 answers came back as invalid JSON. They had stopped at the action's
2,048-token output limit, and Gemini counts the model's reasoning against that limit, so the visible answer
ended halfway. We added provider-specific detection for that stop condition, so the runtime reports
`AI_OUTPUT_LIMIT` instead of a generic invalid answer:

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

We raised the triage limit to 8,192 tokens and changed the evaluation to fetch resolved issues directly from
Sentry, building their digests in memory. The second run sent 78 of the 79 issues; Sentry had no events left
for the last one. Classification matched the reference labels in 89.7% of the answers and severity in 83.3%.
The run cost $0.79 and returned no invalid or cut-off answers.

## A fix button that runs in a public log

For a real bug, an admin can press _Launch fix_. We pass only two inputs from the worker to GitHub Actions:
the issue's short id and an optional note. Nothing else from Crate reaches GitHub. The workflow reads the
issue from Sentry with a read-only token and writes it to a file outside the repository, keeping the issue
payload out of the public run log.

An agent then has 30 minutes to reproduce the bug with a failing test, fix it and commit with
`Fixes <SHORT-ID>`. If it can't reproduce the bug, it stops and leaves a report. It can't push, and every
command it runs is sandboxed with bubblewrap, out of reach of the job's credentials. We initially left `socat`
out of the job's dependencies. The sandbox needs it, so every command failed on the first real run.
A second job opens a draft pull request through a GitHub App, so CI runs on it, and a person decides whether
to merge. Once merged, Sentry's GitHub integration resolves the issue, and each image build attaches its
commits to the Sentry release, so an error that comes back shows up as a regression.

## What is still open

In that evaluation, severity tended to come back one level low: three of the four `high` issues came back as
`medium`. Our reference set has no `critical` label, so we haven't measured how often triage would mistake a
critical bug for noise. The one confident `critical` answer was a synthetic diagnostic error. Had we saved that
assessment, it would have put the issue in the critical lane. The evaluation saved no assessments, and the alert
on that lane ships disabled for now. The autofix job has no PostgreSQL either, so a bug that needs the database can't
be reproduced there yet.

## Read the code

The digest is built in `app/crate/error_inbox/digest.py`, the triage prompt and its checks are in
`app/crate/llm/prompts/error_triage.py` and the output-limit detection is in `app/crate/ai/transport.py`. The
fix workflow is `.github/workflows/error-autofix.yml`. Both evaluation reports are in
`docs/technical/evidence/observability/`.
