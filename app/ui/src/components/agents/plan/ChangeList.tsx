import { useId, useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";

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
import { fieldDiff, type FieldDiffRow } from "@/lib/agent-plan-presentation";
import { isRecord, targetIdentity } from "@/lib/agent-plan-review";
import { humanizeKey } from "@/lib/humanize";

type Change = AgentPlan["changes"][number];
type Target = AgentPlan["targets"][number];

// Keys that only say which target a change applies to; the card header shows
// the target, so they are left out of the generic change body.
const TARGET_KEYS = new Set([
  "targets",
  "entity_uid",
  "artist_uid",
  "entity_type",
]);

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const nonemptyText = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

function nestedTarget(change: Change): Record<string, unknown> | null {
  const nested = Array.isArray(change.targets) ? change.targets[0] : null;
  return isRecord(nested) ? nested : null;
}

/** Readable name of the target a change applies to; never an identity. */
export function changeTargetLabel(change: Change, targets: Target[]): string {
  const nested = nestedTarget(change);
  const identity =
    targetIdentity(change) ?? (nested ? targetIdentity(nested) : null);
  if (identity === "library:global") return "Whole library";
  if (identity === null)
    return change.scope === "global" ? "Whole library" : "Unknown target";
  const target: Record<string, unknown> | null =
    targets.find((entry) => targetIdentity(entry) === identity) ?? nested;
  const label = nonemptyText(target?.label) ?? nonemptyText(target?.name);
  if (label) return label;
  const kind = nonemptyText(target?.entity_type);
  return kind ? humanizeKey(kind) : "Unknown target";
}

function changeSubject(change: Change): string {
  const subject = change.field ?? change.action ?? change.pipeline;
  return humanizeKey(typeof subject === "string" ? subject : "operation");
}

function photoText(value: unknown): string {
  return value ? "Photo present" : "No photo";
}

function BeforeAfter({
  current,
  proposed,
}: {
  current: ReactNode;
  proposed: ReactNode;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-md border border-white/8 bg-black/10 p-3">
        <dt className="text-[11px] uppercase tracking-[0.12em] text-white/40">
          Current
        </dt>
        <dd className="mt-1 text-sm text-white/70">{current}</dd>
      </div>
      <div className="min-w-0 rounded-md border border-cyan-400/20 bg-cyan-400/[0.06] p-3">
        <dt className="flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">
          <ArrowRight aria-hidden="true" className="size-3" />
          Proposed
        </dt>
        <dd className="mt-1 text-sm text-white">{proposed}</dd>
      </div>
    </dl>
  );
}

const rowTone: Record<FieldDiffRow["status"], string> = {
  changed: "bg-amber-400/[0.07]",
  added: "bg-emerald-400/[0.06]",
  cleared: "bg-red-500/[0.08]",
  unchanged: "",
};

const rowMarker: Partial<Record<FieldDiffRow["status"], ReactNode>> = {
  changed: <span className="block text-[11px] text-amber-200/80">Changed</span>,
  added: <span className="block text-[11px] text-emerald-200/80">Added</span>,
};

function FieldDiffTable({ rows }: { rows: FieldDiffRow[] }) {
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
      <div id={contentId}>
        {visible.length > 0 ? (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Field</TableHead>
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
                  <TableCell className="align-top font-medium break-words whitespace-normal text-white/80">
                    {humanizeKey(row.key)}
                    {rowMarker[row.status] ?? null}
                  </TableCell>
                  <TableCell className="align-top break-words whitespace-normal text-white/60">
                    <StructuredValue value={row.before} />
                  </TableCell>
                  <TableCell className="align-top break-words whitespace-normal text-white">
                    {row.status === "cleared" ? (
                      <span className="text-red-200">Cleared</span>
                    ) : (
                      <StructuredValue value={row.after} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-white/55">No field changes.</p>
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

function ChangeBody({
  change,
  operation,
}: {
  change: Change;
  operation: string;
}) {
  if (operation === "repair_photo_flag")
    return (
      <BeforeAfter
        current={photoText(change.before)}
        proposed={photoText(change.after)}
      />
    );

  if (hasOwn(change, "before") || hasOwn(change, "after")) {
    const rows = fieldDiff(change.before, change.after);
    if (rows) return <FieldDiffTable rows={rows} />;
    const cleared =
      hasOwn(change, "after") &&
      change.after === null &&
      change.before !== null &&
      change.before !== undefined;
    return (
      <BeforeAfter
        current={<StructuredValue value={change.before} />}
        proposed={
          cleared ? (
            <span className="text-red-200">Cleared</span>
          ) : (
            <StructuredValue value={change.after} />
          )
        }
      />
    );
  }

  const details = Object.fromEntries(
    Object.entries(change).filter(([key]) => !TARGET_KEYS.has(key)),
  );
  if (Object.keys(details).length === 0) return null;
  return (
    <div className="text-sm text-white/80">
      <StructuredValue value={details} />
    </div>
  );
}

export function ChangeList({ plan }: { plan: AgentPlan }) {
  // Preserve every proposed change, including identical entries, with keys
  // that do not depend on unrelated rows' positions.
  const occurrences = new Map<string, number>();
  const changes = plan.changes.map((change) => {
    const content = JSON.stringify(change);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { change, key: `${content}/${occurrence}` };
  });

  return (
    <div className="space-y-2">
      <ul role="list" aria-label="Proposed changes" className="space-y-3">
        {changes.map(({ change, key }) => (
          <li
            key={key}
            className="min-w-0 space-y-3 rounded-md border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-medium break-words text-white">
                {changeTargetLabel(change, plan.targets)}
              </p>
              <p className="text-sm text-white/55">{changeSubject(change)}</p>
            </div>
            <ChangeBody change={change} operation={plan.operation} />
          </li>
        ))}
      </ul>
      {changes.length === 0 ? (
        <p className="text-sm text-white/55">No changes listed.</p>
      ) : null}
    </div>
  );
}
