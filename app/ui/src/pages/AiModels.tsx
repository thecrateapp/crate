import { Activity, AlertTriangle, Coins, Sparkles } from "lucide-react";

import { OpsPageHero, OpsStatTile } from "@/components/admin/ops-surfaces";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ErrorState } from "@/components/ui/error-state";
import { AI_ROOT } from "@/components/ai-models/api";
import { DefaultModelPanel } from "@/components/ai-models/DefaultModelPanel";
import { FeaturesPanel } from "@/components/ai-models/FeaturesPanel";
import type {
  Activity as ActivityLog,
  Snapshot,
  Usage,
} from "@/components/ai-models/types";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import {
  activeFeatureCount,
  dailyTokenBudget,
  formatCount,
  summaryModel,
  usageToday,
} from "@/lib/ai-models";

// useApi errors carry the raw response body, which can be JSON; never render it.
const LOAD_ERROR = "Couldn't load AI settings. Try again.";

export function AiModels() {
  const { hasCapability } = useAuth();
  const canReadConfig = hasCapability("ai.config.read");
  const canReadUsage = hasCapability("ai.usage.read");

  const {
    data: snapshot,
    loading,
    error,
    refetch,
  } = useApi<Snapshot>(canReadConfig ? `${AI_ROOT}/snapshot` : null);
  const { data: usage } = useApi<Usage>(
    canReadUsage ? `${AI_ROOT}/usage` : null,
  );
  const { data: activity } = useApi<ActivityLog>(
    canReadUsage ? `${AI_ROOT}/activity?limit=50` : null,
  );

  const today = usage ? usageToday(usage, new Date()) : null;
  const budget = snapshot ? dailyTokenBudget(snapshot) : null;

  return (
    <div className="space-y-5">
      <OpsPageHero
        icon={Sparkles}
        title="AI models"
        description="Choose the models Crate uses for its own AI features."
      >
        {snapshot ? (
          <>
            <span className="text-sm text-white/55">
              {summaryModel(snapshot)} · {activeFeatureCount(snapshot)}/
              {snapshot.actions.length} features active
            </span>
            {!snapshot.migrated ? (
              <StatusBadge tone="neutral">Using server settings</StatusBadge>
            ) : null}
            {snapshot.default_model?.available === false ? (
              <StatusBadge tone="danger">Default model unavailable</StatusBadge>
            ) : null}
          </>
        ) : null}
      </OpsPageHero>

      {snapshot?.truncated ? (
        <p role="alert" className="text-sm text-amber-200">
          Some saved profiles are not shown. Only the most recent ones can be
          used here.
        </p>
      ) : null}

      {loading ? <p>Loading AI settings…</p> : null}
      {error ? <ErrorState message={LOAD_ERROR} onRetry={refetch} /> : null}

      {usage && today ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <OpsStatTile
            icon={Activity}
            label="Calls today"
            value={formatCount(today.calls)}
            caption={`${formatCount(usage.totals.calls)} in the last 90 days`}
          />
          <OpsStatTile
            icon={Coins}
            label="Tokens today"
            value={formatCount(today.tokens)}
            caption={
              budget != null
                ? `of ${formatCount(budget)} daily budget`
                : "No daily budget yet"
            }
          />
          <OpsStatTile
            icon={AlertTriangle}
            label="Failures today"
            value={formatCount(today.failed)}
            tone={today.failed > 0 ? "danger" : "default"}
            caption={`${formatCount(usage.totals.failed)} in the last 90 days`}
          />
        </div>
      ) : null}

      {snapshot ? (
        <>
          <DefaultModelPanel snapshot={snapshot} refresh={refetch} />
          <FeaturesPanel
            snapshot={snapshot}
            activity={canReadUsage ? activity : null}
            refresh={refetch}
          />
        </>
      ) : null}

      {/* The Providers, Advanced and Activity panels are added in Tasks 6-7. */}
    </div>
  );
}
