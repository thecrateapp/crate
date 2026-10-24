import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@crate/ui/shadcn/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { StructuredValue } from "@/components/admin/StructuredValue";
import type { AgentPlan } from "@/lib/agent-integrations";
import type { FieldDiffRow } from "@/lib/agent-plan-presentation";
import {
  planChangeViews,
  type ChangeBody,
  type DiffRowView,
} from "@/lib/agent-plan-technical";
import { humanizeKey } from "@/lib/humanize";

function BeforeAfter({
  current,
  proposed,
}: {
  current: ReactNode;
  proposed: ReactNode;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-md border border-border-quiet bg-canvas-surface p-3">
        <MonoLabel as="dt">Current</MonoLabel>
        <dd className="mt-1 text-sm text-text-secondary">{current}</dd>
      </div>
      <div className="min-w-0 rounded-md border border-accent-action/20 bg-accent-action/[0.06] p-3">
        <MonoLabel as="dt" tone="accent">
          Proposed
        </MonoLabel>
        <dd className="mt-1 text-sm text-text-primary">{proposed}</dd>
      </div>
    </dl>
  );
}

const rowTone: Record<FieldDiffRow["status"], string> = {
  changed: "bg-state-warning/[0.07]",
  added: "bg-accent-action/[0.06]",
  cleared: "bg-state-warning/[0.08]",
  unchanged: "",
};

const statusWord: Record<FieldDiffRow["status"], string> = {
  changed: "Changed",
  added: "Added",
  cleared: "Cleared",
  unchanged: "Unchanged",
};

const markerTone: Record<FieldDiffRow["status"], string> = {
  changed: "text-state-warning-text/80",
  added: "text-accent-action-hi/80",
  cleared: "text-state-warning-text/80",
  unchanged: "text-text-subtle",
};

/** «Changed», or «Changed · see Technical details» when ids are listed there. */
function RowMarker({ row }: { row: DiffRowView }) {
  const plain = row.status === "changed" || row.status === "added";
  if (!plain && !row.seeTechnical) return null;
  return (
    <span className={`block text-label ${markerTone[row.status]}`}>
      {statusWord[row.status]}
      {row.seeTechnical ? " · see Technical details" : null}
    </span>
  );
}

function FieldDiffTable({
  rows,
  identifiersOnly = false,
}: {
  rows: DiffRowView[];
  identifiersOnly?: boolean;
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const contentId = useId();
  const unchangedCount = rows.filter(
    (row) => row.status === "unchanged",
  ).length;
  const visible = showUnchanged
    ? rows
    : rows.filter((row) => row.status !== "unchanged");

  return (
    <div className="space-y-2">
      {identifiersOnly ? (
        <p className="text-label text-state-warning-text/80">
          Identifiers change · see Technical details
        </p>
      ) : null}
      <div id={contentId}>
        {visible.length > 0 ? (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36%]">Field</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Proposed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow
                  key={row.key}
                  data-status={row.status}
                  className={rowTone[row.status]}
                >
                  <TableCell className="align-top font-medium break-words whitespace-normal text-text-secondary">
                    {humanizeKey(row.key)}
                    <RowMarker row={row} />
                  </TableCell>
                  <TableCell className="align-top break-words whitespace-normal text-text-secondary">
                    <StructuredValue value={row.before} />
                  </TableCell>
                  <TableCell className="align-top break-words whitespace-normal text-text-primary">
                    {row.status === "cleared" ? (
                      <span className="text-state-warning-text">Cleared</span>
                    ) : (
                      <StructuredValue value={row.after} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : identifiersOnly ? null : (
          <p className="text-sm text-text-muted">No field changes.</p>
        )}
      </div>
      {unchangedCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showUnchanged}
          aria-controls={contentId}
          onClick={() => setShowUnchanged((value) => !value)}
        >
          {showUnchanged ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
          {unchangedCount} unchanged field{unchangedCount === 1 ? "" : "s"}
        </Button>
      ) : null}
    </div>
  );
}

function ChangeBodyView({ body }: { body: ChangeBody }) {
  switch (body.kind) {
    case "photo":
      return <BeforeAfter current={body.current} proposed={body.proposed} />;
    case "diff":
      return (
        <FieldDiffTable
          rows={body.rows}
          identifiersOnly={body.identifiersOnly === true}
        />
      );
    case "scalar":
      return (
        <div className="space-y-2">
          {body.seeTechnical ? (
            <p className="text-label text-state-warning-text/80">
              Changed · see Technical details
            </p>
          ) : null}
          <BeforeAfter
            current={<StructuredValue value={body.current} />}
            proposed={
              body.cleared ? (
                <span className="text-state-warning-text">Cleared</span>
              ) : (
                <StructuredValue value={body.proposed} />
              )
            }
          />
        </div>
      );
    case "details":
      return body.details ? (
        <div className="text-sm text-text-secondary">
          <StructuredValue value={body.details} />
        </div>
      ) : null;
  }
}

export function ChangeList({ plan }: { plan: AgentPlan }) {
  // Preserve every proposed change, including identical entries, with keys
  // that do not depend on unrelated rows' positions.
  const occurrences = new Map<string, number>();
  const changes = planChangeViews(plan).map((view, index) => {
    const content = JSON.stringify(plan.changes[index] ?? null);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { view, key: `${content}/${occurrence}` };
  });

  return (
    <div className="space-y-2">
      <ul role="list" aria-label="Proposed changes" className="space-y-3">
        {changes.map(({ view, key }) => (
          <li
            key={key}
            className="min-w-0 space-y-3 rounded-md border border-border-quiet bg-canvas-surface p-4"
          >
            <div className="space-y-1">
              {view.numbered ? (
                <MonoLabel>Change {view.number}</MonoLabel>
              ) : null}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="font-medium break-words text-text-primary">
                  {view.targets.map((label, index) => (
                    <span key={`${index}:${label}`}>
                      {index > 0 ? ", " : null}
                      <span>{label}</span>
                    </span>
                  ))}
                </p>
                <p className="text-sm text-text-muted">{view.subject}</p>
              </div>
              {view.discriminator ? (
                <p className="text-xs break-words text-text-subtle">
                  {view.discriminator}
                </p>
              ) : null}
            </div>
            <ChangeBodyView body={view.body} />
            {view.details ? (
              <div className="border-t border-border-quiet pt-3 text-sm text-text-secondary">
                <StructuredValue value={view.details} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {changes.length === 0 ? (
        <p className="text-sm text-text-muted">No changes listed.</p>
      ) : null}
    </div>
  );
}
