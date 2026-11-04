import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  CLASSIFICATION_LABEL,
  STATUS_LABEL,
  formatCount,
  issuePath,
  laneGroups,
  substatusLabel,
  substatusTone,
  type ErrorIssueSummary,
  type IssueGroup,
} from "@/lib/error-inbox";

const COLUMNS = [
  { label: "ID", numeric: false },
  { label: "Issue", numeric: false },
  { label: "Service", numeric: false },
  { label: "Events 24h", numeric: true },
  { label: "Users 24h", numeric: true },
  { label: "Last seen", numeric: false },
  { label: "Status", numeric: false },
  { label: "Class", numeric: false },
  { label: "Score", numeric: true },
] as const;

const LANE_LABEL = {
  critical: "Critical lane",
  other: "Everything else",
} as const;

const CELL = "px-3 py-3 align-top";
const MONO_CELL = `${CELL} font-mono text-label text-text-secondary`;
const NUMERIC_CELL = `${MONO_CELL} text-right tabular-nums`;

function IssueState({ issue }: { issue: ErrorIssueSummary }) {
  if (issue.status !== "unresolved")
    return <StatusBadge>{STATUS_LABEL[issue.status]}</StatusBadge>;
  const label = substatusLabel(issue.substatus) ?? STATUS_LABEL.unresolved;
  return (
    <StatusBadge tone={substatusTone(issue.substatus)}>{label}</StatusBadge>
  );
}

function Score({ value, critical }: { value: number; critical: boolean }) {
  return (
    <span className={critical ? "text-state-warning-text" : undefined}>
      {value}
    </span>
  );
}

function classificationText(issue: ErrorIssueSummary) {
  return issue.classification
    ? CLASSIFICATION_LABEL[issue.classification]
    : "—";
}

function IssueRow({
  issue,
  id,
  nested = false,
  hidden,
}: {
  issue: ErrorIssueSummary;
  id?: string;
  nested?: boolean;
  hidden?: boolean;
}) {
  return (
    <tr
      id={id}
      hidden={hidden}
      data-issue-row={issue.short_id}
      className="border-b border-border-quiet"
    >
      <td className={cn(MONO_CELL, "whitespace-nowrap text-text-muted")}>
        {issue.short_id}
      </td>
      <td className={cn(CELL, "min-w-[18rem]", nested && "pl-8")}>
        <Link
          to={issuePath(issue.id)}
          className="text-sm text-text-primary wrap-anywhere hover:text-accent-action-hi focus-visible:text-accent-action-hi"
        >
          {issue.title}
        </Link>
        {issue.culprit ? (
          <p className="mt-1 font-mono text-label text-text-subtle wrap-anywhere">
            {issue.culprit}
          </p>
        ) : null}
      </td>
      <td className={cn(MONO_CELL, "whitespace-nowrap")}>{issue.service}</td>
      <td className={NUMERIC_CELL}>{formatCount(issue.events_24h)}</td>
      <td className={NUMERIC_CELL}>{formatCount(issue.users_24h)}</td>
      <td className={cn(MONO_CELL, "whitespace-nowrap")}>
        <RelativeTime value={issue.last_seen} />
      </td>
      <td className={cn(CELL, "whitespace-nowrap")}>
        <IssueState issue={issue} />
      </td>
      <td className={cn(MONO_CELL, "whitespace-nowrap")}>
        {classificationText(issue)}
      </td>
      <td className={NUMERIC_CELL}>
        <Score value={issue.crate_score} critical={issue.critical} />
      </td>
    </tr>
  );
}

function GroupRows({ group }: { group: IssueGroup }) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const memberIds = group.members.map((_, index) => `${baseId}-${index}`);
  const services = new Set(group.members.map((member) => member.service));
  const { lead } = group;
  return (
    <>
      <tr
        data-issue-group={lead.group_key ?? undefined}
        className="border-b border-border-quiet"
      >
        <td className={cn(MONO_CELL, "whitespace-nowrap text-text-muted")}>
          {group.members.length} issues
        </td>
        <td className={cn(CELL, "min-w-[18rem]")}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={memberIds.join(" ")}
            onClick={() => setOpen((value) => !value)}
            className="group block text-left"
          >
            <span className="block text-sm text-text-primary wrap-anywhere group-hover:text-accent-action-hi">
              {lead.title}
            </span>
            <MonoLabel
              as="span"
              tone="accent"
              className="mt-1 inline-flex min-h-8 items-center"
            >
              {open ? "Hide" : "Show"} {group.members.length} similar issues
            </MonoLabel>
          </button>
          {lead.culprit ? (
            <p className="font-mono text-label text-text-subtle wrap-anywhere">
              {lead.culprit}
            </p>
          ) : null}
        </td>
        <td className={cn(MONO_CELL, "whitespace-nowrap")}>
          {services.size === 1 ? lead.service : `${services.size} services`}
        </td>
        <td className={NUMERIC_CELL}>{formatCount(group.events_24h)}</td>
        <td className={NUMERIC_CELL}>{formatCount(group.users_24h)}</td>
        <td className={cn(MONO_CELL, "whitespace-nowrap")}>
          <RelativeTime value={group.last_seen} />
        </td>
        <td className={cn(CELL, "whitespace-nowrap")}>
          <IssueState issue={lead} />
        </td>
        <td className={cn(MONO_CELL, "whitespace-nowrap")}>
          {classificationText(lead)}
        </td>
        <td className={NUMERIC_CELL}>
          <Score value={group.crate_score} critical={group.critical} />
        </td>
      </tr>
      {group.members.map((member, index) => (
        <IssueRow
          key={member.id}
          id={memberIds[index]}
          issue={member}
          nested
          hidden={!open}
        />
      ))}
    </>
  );
}

/**
 * The inbox table: critical lane first, then everything else, each in Crate
 * priority order. Issues sharing a group key collapse into one group row whose
 * numbers are the members' totals (score and last seen are the highest).
 */
export function IssueTable({
  issues,
  footer,
}: {
  issues: ErrorIssueSummary[];
  footer?: ReactNode;
}) {
  const lanes = laneGroups(issues);
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[62rem] border-collapse text-left">
          <caption className="sr-only">
            Error issues, critical lane first. Similar issues are grouped.
          </caption>
          <thead>
            <tr className="border-b border-border-quiet">
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 pb-2 font-normal",
                    column.numeric ? "text-right" : "text-left",
                  )}
                >
                  <MonoLabel as="span">{column.label}</MonoLabel>
                </th>
              ))}
            </tr>
          </thead>
          {lanes.map((lane) => (
            <tbody key={lane.id} data-lane={lane.id}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={COLUMNS.length}
                  className="px-3 pb-2 pt-6 text-left font-normal"
                >
                  <MonoLabel
                    as="span"
                    tone={lane.id === "critical" ? "accent" : "subtle"}
                  >
                    {LANE_LABEL[lane.id]} · {lane.issueCount}
                  </MonoLabel>
                </th>
              </tr>
              {lane.groups.map((group) =>
                group.members.length > 1 ? (
                  <GroupRows key={group.key} group={group} />
                ) : (
                  <IssueRow key={group.key} issue={group.lead} />
                ),
              )}
            </tbody>
          ))}
        </table>
      </div>
      {footer}
    </div>
  );
}
