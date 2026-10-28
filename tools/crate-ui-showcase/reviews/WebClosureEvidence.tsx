import { Card } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import {
  WEB_ROUTE_AUDIT,
  WEB_LIVE_CHECKS,
  WEB_CATALOGUE_REMAINDER,
} from "../fixtures/web-closure-audit";

export function WebClosureEvidence() {
  return (
    <div className="grid min-w-0 gap-8">
      <SectionHeader title="Review coverage" />
      <Card className="grid gap-4 p-4 sm:p-6">
        <MonoLabel tone="accent">
          25 review groups · 15 global catalogue exceptions
        </MonoLabel>
        <p className="text-sm text-text-secondary">
          Route/source inspection and automated fixtures complement read-only
          checks in the live app. This is a web review checkpoint; catalogue
          documentation and native certification are separate.
        </p>
        <p className="text-sm text-text-secondary">
          Native device testing remains separate
        </p>
        <p className="text-sm text-text-secondary">
          The production EQ server currently confirms the effective curve; its
          full curve inventory needs the existing endpoint to be deployed. No
          server deployment or production write is part of this review.
        </p>
      </Card>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {WEB_ROUTE_AUDIT.map(([id, title, routes, tests, detail]) => (
          <Card
            key={id}
            data-route-audit={id}
            data-route-evidence={WEB_LIVE_CHECKS[id] ? "live" : "inspected"}
            className="grid content-start gap-3 p-4"
          >
            <MonoLabel tone="accent">
              {id} · {title}
            </MonoLabel>
            <p className="text-xs text-text-secondary">
              {WEB_LIVE_CHECKS[id]
                ? `Live read-only · desktop · 2026-10-21: ${WEB_LIVE_CHECKS[id]}`
                : "Source and automated evidence inspected; this route was not exercised live in this closure."}
            </p>
            <code className="min-w-0 wrap-anywhere font-mono text-xs text-text-secondary">
              {routes}
            </code>
            <p className="text-sm text-text-primary">{detail}</p>
            <p className="min-w-0 wrap-anywhere text-xs text-text-subtle">
              Evidence: {tests}
            </p>
          </Card>
        ))}
      </div>
      <Card className="grid min-w-0 gap-4 p-4 sm:p-6">
        <MonoLabel tone="accent">
          Global catalogue remainder · owned follow-up
        </MonoLabel>
        <p className="text-sm text-text-secondary">
          These entries retain pending documentation. They do not introduce an
          undocumented active Listen component; no pending source fingerprints
          are refreshed to hide debt.
        </p>
        <dl className="grid min-w-0 gap-4">
          {WEB_CATALOGUE_REMAINDER.map(([id, consumer, milestone]) => (
            <div key={id} className="grid min-w-0 gap-1">
              <dt className="wrap-anywhere font-mono text-xs text-text-primary">
                {id}
              </dt>
              <dd className="text-sm text-text-secondary">
                {consumer}. Owner: shared UI/Admin team. Milestone: {milestone}.
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
