import { useCallback, useEffect, useState } from "react";
import { Activity as ActivityIcon } from "lucide-react";

import { Button } from "@crate/ui/shadcn/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminSelect } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import {
  dailyUsageSeries,
  formatDuration,
  formatTokens,
  invocationStatusView,
} from "@/lib/ai-models";

import { AI_ROOT } from "./api";
import { InvocationSheet, invocationFeatureLabel } from "./InvocationSheet";
import type { Activity, Invocation, Snapshot, Usage } from "./types";
import { UsageChart } from "./UsageChart";

const PAGE_SIZE = 50;
const CHART_DAYS = 30;
// useApi errors carry the raw response body; never render them.
const LOAD_ERROR = "Couldn't load activity. Reload the page to try again.";

interface LoadedPage {
  data: Activity | null;
  failed: boolean;
}

function activityUrl(actionId: string, cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  if (actionId) query.set("action_id", actionId);
  return `${AI_ROOT}/activity?${query.toString()}`;
}

/** Reads one page and hands it to the panel, which lists every page in order. */
function PageReader({
  url,
  onLoad,
}: {
  url: string;
  onLoad: (url: string, page: LoadedPage) => void;
}) {
  const { data, error } = useApi<Activity>(url);
  const failed = error !== null;
  useEffect(() => {
    if (data || failed) onLoad(url, { data, failed });
  }, [url, data, failed, onLoad]);
  return null;
}

function FeatureButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  return (
    <Button
      variant="link"
      size="xs"
      onClick={onOpen}
      className="h-auto px-0 font-medium text-white"
    >
      {label}
    </Button>
  );
}

export function ActivityPanel({
  snapshot,
  usage,
}: {
  snapshot: Snapshot;
  usage: Usage | null;
}) {
  const [actionId, setActionId] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pages, setPages] = useState<Record<string, LoadedPage>>({});
  const [sheet, setSheet] = useState<{
    invocation: Invocation;
    open: boolean;
  } | null>(null);

  const receive = useCallback((url: string, page: LoadedPage) => {
    setPages((current) => {
      const seen = current[url];
      if (seen && seen.data === page.data && seen.failed === page.failed) {
        return current;
      }
      return { ...current, [url]: page };
    });
  }, []);

  const urls = cursors.map((cursor) => activityUrl(actionId, cursor));
  const loaded = urls.map((url) => pages[url]);
  const items = loaded.flatMap((page) => page?.data?.items ?? []);
  const last = loaded[loaded.length - 1];
  const loading = last === undefined;
  const failed = loaded.some((page) => page?.failed);
  const nextCursor = last?.data?.next_cursor ?? null;

  function chooseFeature(next: string) {
    if (next === actionId) return;
    setActionId(next);
    setCursors([null]);
    setPages({});
  }

  function open(invocation: Invocation) {
    setSheet({ invocation, open: true });
  }

  const rows = items.map((invocation) => ({
    invocation,
    label: invocationFeatureLabel(invocation, snapshot),
    status: invocationStatusView(invocation.status),
  }));

  return (
    <OpsPanel
      icon={ActivityIcon}
      title="Activity"
      description="Calls Crate made to models in the last 90 days."
    >
      {urls.map((url) => (
        <PageReader key={url} url={url} onLoad={receive} />
      ))}

      <div className="space-y-5">
        {usage?.legacy_usage_unknown ? (
          <p className="text-sm text-white/60">
            Usage from before setup is not known.
          </p>
        ) : null}
        {usage?.truncated ? (
          <p className="text-sm text-white/60">
            Older daily totals are not shown.
          </p>
        ) : null}
        {usage ? (
          <UsageChart series={dailyUsageSeries(usage, CHART_DAYS)} />
        ) : null}

        <AdminSelect
          ariaLabel="Feature"
          placeholder="All features"
          value={actionId}
          options={snapshot.actions.map((action) => ({
            value: action.id,
            label: action.label,
          }))}
          menuClassName="w-[280px]"
          onChange={chooseFeature}
        />

        {rows.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ invocation, label, status }) => (
                    <TableRow key={invocation.id}>
                      <TableCell>
                        <FeatureButton
                          label={label}
                          onOpen={() => open(invocation)}
                        />
                      </TableCell>
                      <TableCell className="text-white/70">
                        {invocation.model_id}
                      </TableCell>
                      <TableCell className="text-white/70">
                        {formatTokens(invocation)}
                      </TableCell>
                      <TableCell className="text-white/70">
                        {formatDuration(invocation.duration_ms)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={status.tone}>
                          {status.label}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-white/50">
                        <RelativeTime value={invocation.created_at} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul
              role="list"
              aria-label="Recent calls"
              className="divide-y divide-white/8 md:hidden"
            >
              {rows.map(({ invocation, label, status }) => (
                <li key={invocation.id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <FeatureButton
                      label={label}
                      onOpen={() => open(invocation)}
                    />
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                  <p className="text-xs text-white/50">
                    {invocation.model_id} · {formatTokens(invocation)} ·{" "}
                    {formatDuration(invocation.duration_ms)} ·{" "}
                    <RelativeTime value={invocation.created_at} />
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : !loading && !failed ? (
          <p className="text-sm text-white/60">
            {actionId ? "No calls for this feature yet." : "No calls yet."}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-white/50">Loading activity…</p>
        ) : null}
        {failed ? (
          <p role="alert" className="text-sm text-amber-100">
            {LOAD_ERROR}
          </p>
        ) : null}

        {nextCursor ? (
          <Button
            variant="outline"
            onClick={() =>
              setCursors((current) =>
                current.includes(nextCursor)
                  ? current
                  : [...current, nextCursor],
              )
            }
          >
            Load more
          </Button>
        ) : null}
      </div>

      {sheet ? (
        <InvocationSheet
          invocation={sheet.invocation}
          snapshot={snapshot}
          open={sheet.open}
          onOpenChange={(next) =>
            setSheet((current) =>
              current ? { ...current, open: next } : current,
            )
          }
        />
      ) : null}
    </OpsPanel>
  );
}
