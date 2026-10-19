import { useId, useState, type ReactNode } from "react";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import {
  FEATURE_AREAS,
  featureAreaLabel,
  featureModelView,
  featureSends,
  invocationStatusView,
  reasonText,
} from "@/lib/ai-models";

import { reportFailure, writeAI } from "./api";
import { FeatureModelSheet } from "./FeatureModelSheet";
import type { Action, Activity, Binding, Invocation, Snapshot } from "./types";

const SETUP_HINT =
  "Choose a default model to turn features on or off or give them their own model.";

function groupByArea(actions: Action[]): { area: string; actions: Action[] }[] {
  const known: readonly string[] = FEATURE_AREAS;
  const order = [
    ...FEATURE_AREAS,
    ...new Set(
      actions
        .map((action) => action.group)
        .filter((group) => !known.includes(group)),
    ),
  ];
  return order
    .map((area) => ({
      area,
      actions: actions.filter((action) => action.group === area),
    }))
    .filter((group) => group.actions.length > 0);
}

function latestRuns(activity: Activity | null): Map<string, Invocation> {
  const runs = new Map<string, Invocation>();
  for (const item of activity?.items ?? []) {
    if (!item.action_id || item.invocation_kind !== "action") continue;
    const seen = runs.get(item.action_id);
    if (!seen || Date.parse(item.created_at) > Date.parse(seen.created_at)) {
      runs.set(item.action_id, item);
    }
  }
  return runs;
}

function FeatureRow({
  snapshot,
  action,
  lastRun,
  showRuns,
  canManage,
  busy,
  onToggle,
  onChooseModel,
}: {
  snapshot: Snapshot;
  action: Action;
  lastRun: Invocation | undefined;
  showRuns: boolean;
  canManage: boolean;
  busy: boolean;
  onToggle: (binding: Binding, enabled: boolean) => void;
  onChooseModel: () => void;
}) {
  const labelId = useId();
  const binding = snapshot.bindings.find(
    (candidate) => candidate.action_id === action.id,
  );
  const feature = snapshot.default_model?.features.find(
    (candidate) => candidate.action_id === action.id,
  );
  const view = featureModelView(snapshot, action.id);
  const checked = snapshot.migrated ? (binding?.enabled ?? false) : true;
  const canWrite = canManage && snapshot.migrated;

  return (
    <li
      aria-labelledby={labelId}
      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p id={labelId} className="font-medium text-white">
          {action.label}
        </p>
        <p className="text-sm text-white/50">{featureSends(action)}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
          {view.model ? (
            <span className="text-white/70">{view.model}</span>
          ) : null}
          {feature?.status === "incompatible" ? (
            <StatusBadge tone="warning">
              {reasonText(feature.reason)}
            </StatusBadge>
          ) : null}
        </div>
        {showRuns ? (
          <p className="text-xs text-white/45">
            {lastRun ? (
              <>
                Last run <RelativeTime value={lastRun.created_at} /> ·{" "}
                {invocationStatusView(lastRun.status).label}
              </>
            ) : (
              "No recent runs"
            )}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {canWrite ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Use a different model for ${action.label}`}
            onClick={onChooseModel}
          >
            Use a different model
          </Button>
        ) : null}
        <Switch
          aria-label={action.label}
          checked={checked}
          disabled={!canWrite || !binding || busy}
          onCheckedChange={(enabled) => {
            if (binding) onToggle(binding, enabled);
          }}
        />
      </div>
    </li>
  );
}

export function FeaturesPanel({
  snapshot,
  activity,
  refresh,
}: {
  snapshot: Snapshot;
  activity: Activity | null;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const canManage = hasCapability("ai.config.manage");
  const canReadUsage = hasCapability("ai.usage.read");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{
    actionId: string;
    open: boolean;
    opened: number;
  } | null>(null);

  const runs = latestRuns(canReadUsage ? activity : null);
  const showRuns = canReadUsage && activity !== null;
  const sheetAction = sheet
    ? snapshot.actions.find((action) => action.id === sheet.actionId)
    : undefined;

  async function toggle(action: Action, binding: Binding, enabled: boolean) {
    setBusy(true);
    try {
      await writeAI("/bindings", {
        changes: [
          {
            action_id: action.id,
            profile_id: binding.profile_id,
            profile_version: binding.profile_version,
            enabled,
            expected_revision: binding.revision,
          },
        ],
      });
      toast.success(`${action.label} turned ${enabled ? "on" : "off"}`);
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <OpsPanel
      icon={ListChecks}
      title="Features"
      description="What each feature sends and which model it uses."
    >
      <div className="space-y-6">
        {!snapshot.migrated ? (
          <p className="text-sm text-white/60">{SETUP_HINT}</p>
        ) : null}
        {groupByArea(snapshot.actions).map((group) => (
          <FeatureArea key={group.area} area={group.area}>
            {group.actions.map((action) => (
              <FeatureRow
                key={action.id}
                snapshot={snapshot}
                action={action}
                lastRun={runs.get(action.id)}
                showRuns={showRuns}
                canManage={canManage}
                busy={busy}
                onToggle={(binding, enabled) =>
                  void toggle(action, binding, enabled)
                }
                onChooseModel={() =>
                  setSheet((current) => ({
                    actionId: action.id,
                    open: true,
                    opened: (current?.opened ?? 0) + 1,
                  }))
                }
              />
            ))}
          </FeatureArea>
        ))}
      </div>
      {sheet && sheetAction ? (
        <FeatureModelSheet
          key={`${sheet.actionId}:${sheet.opened}`}
          snapshot={snapshot}
          action={sheetAction}
          open={sheet.open}
          onOpenChange={(open) =>
            setSheet((current) => (current ? { ...current, open } : current))
          }
          refresh={refresh}
        />
      ) : null}
    </OpsPanel>
  );
}

function FeatureArea({
  area,
  children,
}: {
  area: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="text-sm font-semibold text-white/80">
        {featureAreaLabel(area)}
      </h3>
      <ul role="list" className="divide-y divide-white/8">
        {children}
      </ul>
    </section>
  );
}
