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

const nonemptyText = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

function lockText(locked: unknown): string {
  if (locked === true) return "Locked";
  if (locked === false) return "Unlocked";
  return "Missing lock state";
}

function trackIdentityItems(selection: unknown[]) {
  const items: { label: string; value: string | number }[] = [];
  selection.forEach((track, index) => {
    if (!isRecord(track)) return;
    const name = `${index + 1}. ${nonemptyText(track.title) ?? "Untitled"}`;
    const trackUid = nonemptyText(track.track_uid);
    const globalTrackUid = nonemptyText(track.global_track_uid);
    if (trackUid) items.push({ label: `${name} · Track ID`, value: trackUid });
    if (globalTrackUid)
      items.push({ label: `${name} · Global track ID`, value: globalTrackUid });
    if (typeof track.row_id === "number")
      items.push({ label: `${name} · Row ID`, value: track.row_id });
  });
  return items;
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
  const identities = trackIdentityItems(selection);
  const policyOnly =
    plan.kind === "visibility" || plan.kind === "refresh_policy";

  return (
    <section aria-label="Complete editorial details" className="space-y-4">
      <h3 className="font-medium text-white">Editorial playlist content</h3>
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
                    <StructuredValue value={track} />
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
        <StructuredValue
          value={{
            metadata: plan.metadata,
            smart_rules: plan.smart_rules,
            new_exclusions: plan.new_exclusions,
            existing_exclusions: plan.existing_exclusions,
            copied_exclusions: plan.copied_exclusions,
            source_revision: plan.source_revision,
            generation_epoch: plan.generation_epoch,
            provenance: plan.provenance,
          }}
        />
      </div>
      {identities.length > 0 ? (
        <TechnicalDetails title="Track identities" items={identities} />
      ) : null}
    </section>
  );
}
