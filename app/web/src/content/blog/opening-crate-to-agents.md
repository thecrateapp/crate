---
title: "Opening Crate to agents"
description: "A remote agent needed more than API access. Crate added bounded diagnostics, delegated scopes, exact change plans and authority checks at worker execution."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 27
related: [reading-errors-without-trusting-them, when-retries-repeat-a-download, teaching-crate-to-listen]
tags: [How to dismantle Spotify, MCP, agents, workers, security, history]
sources:
  - app/crate/mcp/server.py
  - app/crate/mcp/schemas.py
  - app/crate/mcp/contract.py
  - app/crate/agent_access.py
  - app/crate/agent_library_operations.py
  - app/crate/db/repositories/agent_plans.py
  - app/crate/db/repositories/agent_operation_jobs.py
  - app/crate/db/repositories/agent_task_control.py
  - app/tests/test_agent_plan_approvals.py
  - docs/technical/crate-mcp.md
  - docs/technical/crate-mcp-distribution.md
---

_Part 27. Opening a bounded remote interface in October 2026._

“Fix the missing artist photos” sounds like one request. For a remote agent it leaves several
decisions open: which artists, what evidence, which changes, and who may authorize them. Crate's own
applications could already inspect the library, queue repairs and run analysis. Opening those
operations to an agent meant settling each of those decisions first.

Even a read can mislead. An empty page of issues might mean the sample is empty. A completed job might
have skipped its work. A recent snapshot might contain an old worker heartbeat. If an agent interprets
those responses as “the library is clean” or “the worker is alive,” it can make a bad decision before
calling any write tool.

We started with a small diagnostic interface, then added directed operations backed by persisted
plans. An agent could propose a change, a person could inspect it where required, and the worker could
verify that the same change was still authorized.
[Initial diagnostics](https://github.com/thecrateapp/crate/commit/01fcd117a33e921523f635ffc44238bf0da5e270),
[scoped maintenance and OAuth](https://github.com/thecrateapp/crate/commit/08bff534ee24921f32e21b57067c248170b71e8b).

## Inspect the missing photo without starting a repair

[MCP](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) provides discovery and
invocation of named tools with input schemas. It does not prescribe a particular review interface.
The specification recommends keeping a person able to deny tool invocations, but Crate still has
to define what a tool is allowed to do and what an approval covers.

A general shell or a generic HTTP-request tool would put much of that meaning in the agent's prompt.
We exposed named operations instead. The first catalogue had six diagnostic tools: instance status,
library issues, artist inspection, job listing, job detail and diagnostics. They read persisted
evidence. None scanned the music directory, refreshed a provider or enqueued a repair as a side effect
of inspection.
[The first catalogue](https://github.com/thecrateapp/crate/blob/01fcd117a33e921523f635ffc44238bf0da5e270/app/crate/mcp/tools.py#L23-L59).

The result envelope carries availability and source timestamps, plus counts, truncation and cursors
where relevant. Missing evidence is unavailable; old evidence is stale. The timestamp of a snapshot
build remains separate from the observation it contains.

For example, the materialized issue sample is capped at 1,000 entries. Reaching its end does not prove
that every artist has been checked. A cursor is bound to the snapshot version and filters, so a
changed snapshot requires pagination to restart. Artist inspection can make a bounded query outside
that sample when the agent needs to investigate a specific artist.
[Evidence semantics](https://github.com/thecrateapp/crate/blob/0d70300b204ed7d44a577c7c99e0576e41e717aa/docs/technical/crate-mcp.md#L349-L381).

This also preserved Crate's read path. Reading a cold diagnostic surface does not rebuild it in the
request. The projector refreshes it in the background. Logs remain bounded source data, with field
allowlists and redaction; their text never becomes authorization to run an operation.
[Reading errors without trusting them](/blog/reading-errors-without-trusting-them) follows that trust
boundary through the later error inbox.

As the catalogue grew, we exported versioned schemas, fingerprints, grants and limits. The October
distribution cut called this Crate contract 1.0.0, independently of the MCP protocol version. The
operation catalogue distinguishes enabled, denied, disabled and unavailable operations. A tool's
presence in discovery does not promise that a worker, provider or particular target is ready.
[Versioned distribution](https://github.com/thecrateapp/crate/commit/0d70300b204ed7d44a577c7c99e0576e41e717aa).

### Authentication does not settle every permission

Endpoint access, action execution and OAuth each retain separate flags, all disabled by default.
Read credentials retain their original diagnostic grants; enabling writes requires an explicit
grant as well as the action flag. The acceptance record separates disposable test validation from
production rollout and real client/proxy acceptance. We cannot infer deployed access from the
number of implemented tools.
[Distribution and rollout limits](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/crate-mcp-distribution.md#L19-L49).

The remote endpoint uses Streamable HTTP at `/mcp`. Dedicated service credentials and OAuth grants
identify integrations. A human's browser session is used for consent and Admin review, rather than
being accepted as a machine credential. The request middleware also rejects mixed authentication
inputs instead of combining a cookie, query parameter and Bearer token into an ambiguous identity.
[Authentication boundary](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/mcp/auth.py#L24-L66).

The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
describes the HTTP resource-server and delegated-client roles. Crate's implementation uses registered
clients, PKCE S256, exact callback and resource checks, one-use codes and rotating refresh tokens.
Dynamic client registration is not enabled. A client that depends on it needs a separate compatibility
decision; publishing discovery metadata does not imply every OAuth flow is supported.
[OAuth connection contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/crate-mcp.md#L150-L182).

An issued scope is only one input to effective authority. Crate also checks the current authorization,
enabled client, integration grants, delegating user's capabilities and operation-specific target
restrictions. Two people connecting through the same client get separate principals. A new consent
creates a new authorization identity, so reconnecting cannot revive an old revoked job.

This matters once work is queued. Normal access-token expiry does not by itself cancel an accepted
job, but revoking its grant or removing the user's capability must prevent new effects. Workers
therefore retain the accepted authorization context and check current authority at execution.
[Delegated job semantics](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/crate-mcp.md#L176-L188).

## Prepare one flag change and approve that exact document

The first directed write repaired a mismatch between an artist's photo-presence flag and an observed
file. It did not download an image. A scoped worker checked the selected artist and produced evidence;
preview then persisted a plan for one database flag change. Applying that plan reobserved the source,
checked identity and preconditions, changed the flag and observed again.
[The photo-flag workflow](https://github.com/thecrateapp/crate/blob/0d70300b204ed7d44a577c7c99e0576e41e717aa/docs/technical/crate-mcp.md#L284-L332).

For that single flag change, the workflow was:

1. Request a selected check or preparation job.
2. Read the resulting plan, including targets, before and after values, evidence and expiry.
3. Obtain exact human approval when policy requires it.
4. Apply the plan by identity and version, using an idempotency key.
5. Inspect execution and verification separately.

As operations expanded to metadata, enrichment, analysis and sync, we kept that separation. An apply
request refers to an existing plan. It cannot quietly append new targets. Even a tool that supports
both preparation and application distinguishes their inputs:

```python source="app/crate/mcp/schemas.py#L106-L117" commit="0d70300b204ed7d44a577c7c99e0576e41e717aa" "Apply requires only the plan and version"
    @model_validator(mode="after")
    def validate_selection(self):
        if self.plan_id:
            if (
                not self.plan_version
                or self.scope
                or self.check_types
                or self.artist_uid
            ):
                raise ValueError("Apply requires only the plan and version")
        elif self.plan_version:
            raise ValueError("A plan ID is required")
```

The base input model forbids extra fields. A request cannot add an unsupported “force” switch and
hope that some adapter interprets it. Operation-specific compilers validate the targets and produce
the complete proposed effects before an application job can be accepted.
[Closed inputs](https://github.com/thecrateapp/crate/blob/0d70300b204ed7d44a577c7c99e0576e41e717aa/app/crate/mcp/schemas.py#L19-L20),
[maintenance operations](https://github.com/thecrateapp/crate/commit/7af26ed54dacaa2c994e078d7e68066d7a5ad80e).

Plans also need a size limit that preserves their meaning. The common contract caps a public plan at
40,000 serialized bytes and 500 declared targets, with smaller limits for particular operations. An
over-budget plan fails as a whole. Truncating the displayed changes while retaining a larger private
execution list would make the review misleading.
[Complete-plan limits](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/crate-mcp.md#L718-L741).

### Approve the document that will execute

A checkbox saying “allow repairs” is a policy preference. A human approval for a particular plan has
to bind more information. We store the principal, accepted authorization context, plan version,
canonical content hash and policy revision with the decision. MCP exposes no tool that lets the
agent approve its own plan.

![Preparation creates a complete plan. Human review binds its exact identity when required. Application reserves one job; the worker rechecks authority and sources before effects, and records verification separately.](/blog/opening-crate-to-agents/exact-plan-lifecycle.svg)

The authorization check compares those values again:

```python source="app/crate/db/repositories/agent_plans.py#L254-L270" commit="0d70300b204ed7d44a577c7c99e0576e41e717aa" "content_hash" "reserved_job_id"
    document = _document(plan)
    if (
        not approval
        or approval["decision"] != "approved"
        or approval["plan_version"] != plan["version"]
        or approval["content_hash"] != document["content_hash"]
        or approval["policy_revision"] != policy["policy_revision"]
        or approval["authorization_context"] != authorization_context(principal)
        or (
            approval["reserved_job_id"] is not None
            and approval["reserved_job_id"] != job_id
        )
        or (worker and approval["reserved_job_id"] != job_id)
    ):
        raise DiagnosticError(
            "APPROVAL_REQUIRED", "An exact current human approval is required"
        )
```

Changing the plan or its policy makes the old approval unusable. Approval also expires. During
acceptance, the server reserves it for the application job in the same transaction. Replaying the
accepted application returns that job; another request cannot consume the same approval to create a
second independent effect.

The tests race two applications after one human approval and check that both receive the same job.
They also change the plan version, content hash, policy revision and authorization context separately,
and verify that those stale review identities are rejected.
[Approval and concurrency tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_agent_plan_approvals.py#L55-L111).

An integration may permit bounded changes without a separate human decision. High-risk, destructive
and global plans still require independent human approval. The person reviewing must have both the
review capability and the domain capability for the operation. Approving a document does not supply
scopes that the integration lacks.
[Mandatory approval rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/crate-mcp.md#L760-L767).

## The approved plan waits while its authority can change

The HTTP endpoint is only the first place an operation can be refused. A job might wait while an
operator disables actions or a person disconnects the integration. The worker has to observe that
change before starting a new effect.

Review found a gap in the common task-control path: it retained the agent's authorization, but also
needed to enforce the MCP enable flags during worker execution. We added that gate alongside the
origin check:

```python source="app/crate/db/repositories/agent_task_control.py#L252-L262" commit="45e67b33cd77c2ea27d7c65737cf8b927490a7e1"
        if row["origin"] != "agent":
            return stopping
        if (
            not actions_enabled()
            or os.environ.get("CRATE_MCP_ENABLED", "false").lower() != "true"
        ):
            raise DiagnosticError("FORBIDDEN", "MCP task execution is disabled")
        if not row["origin_context"] or row["origin_principal_id"] is None:
            raise DiagnosticError(
                "FORBIDDEN", "Agent task has no retained authorization"
            )
```

Other review fixes had to follow the operation into existing domain code. DSP results now recheck
the captured physical source after acquiring the relevant database locks, so a task cannot publish
analysis of a replaced file merely because its earlier plan was valid. These checks protect different
things: permission to act and identity of the material being acted on.
[Execution-gate correction](https://github.com/thecrateapp/crate/commit/45e67b33cd77c2ea27d7c65737cf8b927490a7e1),
[source identity correction](https://github.com/thecrateapp/crate/commit/745f96f0229db0283c1b30957bda849d579bafa4).

The plan engine reserves overlapping targets and records when an external or filesystem effect may
have started. That marker is necessary because a database transaction cannot roll back an arbitrary
provider request or file operation. If the worker disappears after the marker but before recording a
result, redelivery cannot safely assume nothing happened.

The resulting state is partial and requires reconciliation. The agent can inspect the durable
evidence and prepare a new plan from current state. It must not turn an uncertain outcome into a
fresh retry under another idempotency key. A regression explicitly marks an effect as started, runs
redelivery, and asserts that no adapter effect runs again.
[Interrupted-effect test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_agent_library_operations.py#L577-L589).
