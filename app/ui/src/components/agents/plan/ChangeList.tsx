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
import type { FieldDiffRow } from "@/lib/agent-plan-presentation";
import { changeView, type ChangeBody } from "@/lib/agent-plan-technical";
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

function ChangeBodyView({ body }: { body: ChangeBody }) {
  switch (body.kind) {
    case "photo":
      return <BeforeAfter current={body.current} proposed={body.proposed} />;
    case "diff":
      return <FieldDiffTable rows={body.rows} />;
    case "scalar":
      return (
        <BeforeAfter
          current={<StructuredValue value={body.current} />}
          proposed={
            body.cleared ? (
              <span className="text-red-200">Cleared</span>
            ) : (
              <StructuredValue value={body.proposed} />
            )
          }
        />
      );
    case "details":
      return body.details ? (
        <div className="text-sm text-white/80">
          <StructuredValue value={body.details} />
        </div>
      ) : null;
  }
}

export function ChangeList({ plan }: { plan: AgentPlan }) {
  // Preserve every proposed change, including identical entries, with keys
  // that do not depend on unrelated rows' positions.
  const occurrences = new Map<string, number>();
  const changes = plan.changes.map((change, index) => {
    const content = JSON.stringify(change);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return {
      view: changeView(change, index, plan),
      key: `${content}/${occurrence}`,
    };
  });

  return (
    <div className="space-y-2">
      <ul role="list" aria-label="Proposed changes" className="space-y-3">
        {changes.map(({ view, key }) => (
          <li
            key={key}
            className="min-w-0 space-y-3 rounded-md border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-medium break-words text-white">
                {view.targets.map((label, index) => (
                  <span key={`${index}:${label}`}>
                    {index > 0 ? ", " : null}
                    <span>{label}</span>
                  </span>
                ))}
              </p>
              <p className="text-sm text-white/55">{view.subject}</p>
            </div>
            <ChangeBodyView body={view.body} />
          </li>
        ))}
      </ul>
      {changes.length === 0 ? (
        <p className="text-sm text-white/55">No changes listed.</p>
      ) : null}
    </div>
  );
}
