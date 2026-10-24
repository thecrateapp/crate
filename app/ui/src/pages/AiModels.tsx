import { OpsPageHero, OpsStatTile } from "@/components/admin/ops-surfaces";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ActivityPanel } from "@/components/ai-models/ActivityPanel";
import { AdvancedPanel } from "@/components/ai-models/AdvancedPanel";
import { AI_ROOT } from "@/components/ai-models/api";
import { DefaultModelPanel } from "@/components/ai-models/DefaultModelPanel";
import { FeaturesPanel } from "@/components/ai-models/FeaturesPanel";
import { ProvidersPanel } from "@/components/ai-models/ProvidersPanel";
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
  const {
    data: usage,
    loading: usageLoading,
    error: usageError,
    refetch: refetchUsage,
  } = useApi<Usage>(canReadUsage ? `${AI_ROOT}/usage` : null);
  const {
    data: activity,
    loading: activityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useApi<ActivityLog>(canReadUsage ? `${AI_ROOT}/activity?limit=50` : null);

  const today = usage ? usageToday(usage, new Date()) : null;
  const budget = snapshot ? dailyTokenBudget(snapshot) : null;

  return (
    <div className="space-y-5">
      <OpsPageHero
        title="AI models"
        description="Choose the models Crate uses for its own AI features."
      >
        {snapshot ? (
          <>
            <InfoBadge>
              {summaryModel(snapshot)} · {activeFeatureCount(snapshot)}/
              {snapshot.actions.length} features active
            </InfoBadge>
            {!snapshot.migrated ? (
              <InfoBadge>Using server settings</InfoBadge>
            ) : null}
            {snapshot.default_model?.available === false ? (
              <InfoBadge tone="danger">Default model unavailable</InfoBadge>
            ) : null}
          </>
        ) : null}
      </OpsPageHero>

      {snapshot?.truncated ? (
        <p role="alert" className="text-sm text-state-warning-text">
          Some saved profiles are not shown. Only the most recent ones can be
          used here.
        </p>
      ) : null}

      {loading ? <LoadingState label="Loading AI settings" /> : null}
      {error ? <ErrorState message={LOAD_ERROR} onRetry={refetch} /> : null}

      {canReadUsage && usageLoading && !usage ? (
        <LoadingState label="Loading AI usage" />
      ) : null}
      {canReadUsage && usageError ? (
        <ErrorState
          message={
            usage
              ? "AI usage could not be refreshed. Showing the last successful totals."
              : "AI usage could not be loaded."
          }
          onRetry={refetchUsage}
        />
      ) : null}
      {canReadUsage && activityLoading && !activity ? (
        <LoadingState label="Loading recent feature runs" />
      ) : null}
      {canReadUsage && activityError ? (
        <ErrorState
          message={
            activity
              ? "Recent feature runs could not be refreshed. Showing the last successful results."
              : "Recent feature runs could not be loaded."
          }
          onRetry={refetchActivity}
          retryLabel="Retry recent runs"
        />
      ) : null}

      {usage && today ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <OpsStatTile
            label="Calls today"
            value={formatCount(today.calls)}
            caption={`${formatCount(usage.totals.calls)} in the last 90 days`}
          />
          <OpsStatTile
            label="Tokens today"
            value={formatCount(today.tokens)}
            caption={
              budget != null
                ? `of ${formatCount(budget)} daily budget`
                : "No daily budget yet"
            }
          />
          <OpsStatTile
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
          <ProvidersPanel snapshot={snapshot} refresh={refetch} />
          <AdvancedPanel snapshot={snapshot} refresh={refetch} />
          {canReadUsage ? (
            <ActivityPanel snapshot={snapshot} usage={usage} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
