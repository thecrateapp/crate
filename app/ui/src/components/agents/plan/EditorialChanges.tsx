import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { StructuredValue } from "@/components/admin/StructuredValue";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import type { AgentPlan } from "@/lib/agent-integrations";
import { formatTrackDuration } from "@/lib/agent-plan-presentation";
import { isRecord } from "@/lib/agent-plan-review";
import {
  editorialTrackIdentities,
  editorialView,
  redactTechnical,
} from "@/lib/agent-plan-technical";

const nonemptyText = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

function lockText(locked: unknown): string {
  if (locked === true) return "Locked";
  if (locked === false) return "Unlocked";
  return "Missing lock state";
}

function TrackRow({ track }: { track: Record<string, unknown> }) {
  const credits = [nonemptyText(track.artist), nonemptyText(track.album)]
    .filter(Boolean)
    .join(" · ");
  return (
    <TableRow>
      <TableCell className="align-top">
        <StructuredValue value={track.position} />
      </TableCell>
      <TableCell className="min-w-48 align-top whitespace-normal">
        <p className="break-words text-white">
          {nonemptyText(track.title) ?? "Untitled"}
        </p>
        {credits ? (
          <p className="break-words text-xs text-white/50">{credits}</p>
        ) : null}
      </TableCell>
      <TableCell className="align-top tabular-nums">
        {formatTrackDuration(
          typeof track.duration === "number" ? track.duration : null,
        )}
      </TableCell>
      <TableCell className="align-top">
        <StructuredValue value={track.source} />
      </TableCell>
      <TableCell className="align-top">{lockText(track.locked)}</TableCell>
    </TableRow>
  );
}

export function EditorialChanges({ plan }: { plan: AgentPlan }) {
  const selection: unknown[] = Array.isArray(plan.selection)
    ? plan.selection
    : [];
  const identities = editorialTrackIdentities(plan);
  const details = editorialView(plan).visible;
  const policyOnly =
    plan.kind === "visibility" || plan.kind === "refresh_policy";

  return (
    <section aria-label="Complete editorial details" className="space-y-4">
      <h3 className="font-medium text-white font-display">Editorial playlist content</h3>
      {selection.length > 0 ? (
        <Table>
          <TableCaption className="sr-only">
            Complete editorial selection
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Position</TableHead>
              <TableHead>Track</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Lock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selection.map((track, index) =>
              isRecord(track) ? (
                <TrackRow key={index} track={track} />
              ) : (
                <TableRow key={index}>
                  <TableCell colSpan={5} className="whitespace-normal">
                    <StructuredValue value={redactTechnical(track).visible} />
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-white/55">
          {policyOnly
            ? "This policy change preserves the existing playlist selection."
            : "The proposed playlist selection is empty."}
        </p>
      )}
      <div className="text-sm text-white/80">
        <StructuredValue value={details} />
      </div>
      {identities.length > 0 ? (
        <TechnicalDetails title="Track identities" items={identities} />
      ) : null}
    </section>
  );
}
