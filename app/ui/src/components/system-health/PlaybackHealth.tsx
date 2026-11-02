import { InfoBadge, type InfoBadgeTone } from "@crate/ui/primitives/InfoBadge";

import { OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";

export type PlaybackQoeAvailability =
  | "available"
  | "empty"
  | "insufficient_sample"
  | "stale"
  | "partial"
  | "unavailable";

export interface PlaybackQoeSummary {
  availability: PlaybackQoeAvailability;
  reason?: string | null;
  caveats?: string[];
  window_minutes?: number;
  minimum_attempts?: number;
  intents?: number | null;
  attempts?: number | null;
  started?: number | null;
  failed?: number | null;
  cancelled?: number | null;
  start_success_ratio?: number | null;
  stall_ratio?: number | null;
  startup_avg_ms?: number | null;
  stalls?: number | null;
  recoveries?: number | null;
  telemetry?: {
    accepted?: number | null;
    unverified?: number | null;
    rate_limited?: number | null;
    duplicates?: number | null;
    client_losses?: number | null;
    legacy_batches?: number | null;
    current_batches?: number | null;
  };
}

type Tone = "default" | "warning" | "danger";

const MISSING = "—";

const STATE_BADGE: Record<
  PlaybackQoeAvailability,
  { label: string; tone: InfoBadgeTone }
> = {
  available: { label: "Current", tone: "success" },
  empty: { label: "No reports", tone: "neutral" },
  insufficient_sample: { label: "Small sample", tone: "info" },
  stale: { label: "Stale", tone: "warning" },
  partial: { label: "Partial", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
};

const CAVEATS: Record<string, string> = {
  legacy_clients: "Older Listen clients report startups and stalls only.",
  client_losses: "Clients reported events they could not deliver.",
  unverified_events: "Some events could not be checked for duplicates.",
  rate_limited_events: "Some events were rejected by the rate limit.",
};

function count(value: number | null | undefined): string {
  return value == null ? MISSING : Math.round(value).toLocaleString();
}

function percent(value: number | null | undefined, digits = 1): string {
  if (value == null) return MISSING;
  const pct = value * 100;
  return `${pct >= 10 || pct === 0 ? pct.toFixed(0) : pct.toFixed(digits)}%`;
}

function milliseconds(value: number | null | undefined): string {
  if (value == null) return MISSING;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`;
}

function successTone(ratio: number | null | undefined): Tone {
  if (ratio == null) return "default";
  if (ratio < 0.8) return "danger";
  return ratio < 0.95 ? "warning" : "default";
}

function stallTone(ratio: number | null | undefined): Tone {
  if (ratio == null) return "default";
  if (ratio > 0.05) return "danger";
  return ratio > 0.01 ? "warning" : "default";
}

function statusMessage(qoe: PlaybackQoeSummary | undefined): string | null {
  if (!qoe || qoe.availability === "unavailable") {
    return "Playback quality readings are unavailable: the metric store did not answer for this window.";
  }
  if (qoe.availability === "empty") {
    return "No current Listen client reported playback in this window.";
  }
  return null;
}

export function PlaybackHealth({ qoe }: { qoe?: PlaybackQoeSummary }) {
  const windowMinutes = qoe?.window_minutes ?? 15;
  const minimum = qoe?.minimum_attempts ?? 20;
  const state = STATE_BADGE[qoe?.availability ?? "unavailable"];
  const message = statusMessage(qoe);
  const sampled = qoe != null && qoe.availability !== "insufficient_sample";
  const successRatio = sampled ? qoe?.start_success_ratio : null;
  const stallRatio = sampled ? qoe?.stall_ratio : null;
  const telemetry = qoe?.telemetry ?? {};
  const caveats = (qoe?.caveats ?? []).map(
    (caveat) => CAVEATS[caveat] ?? caveat,
  );

  return (
    <OpsPanel
      title="Playback health"
      description={`Start success, stalls and startup time reported by Listen clients over the last ${windowMinutes} minutes.`}
      action={<InfoBadge tone={state.tone}>{state.label}</InfoBadge>}
    >
      {message ? (
        <p className="m-0 text-sm text-text-muted">{message}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <OpsStatTile
              label="Start success"
              value={percent(successRatio)}
              caption={`${count(qoe?.started)} of ${count(qoe?.attempts)} attempts started`}
              tone={successTone(successRatio)}
            />
            <OpsStatTile
              label="Stall time"
              value={percent(stallRatio, 2)}
              caption={`${count(qoe?.stalls)} stalls, ${count(qoe?.recoveries)} recoveries`}
              tone={stallTone(stallRatio)}
            />
            <OpsStatTile
              label="Startup"
              value={milliseconds(qoe?.startup_avg_ms)}
              caption="Average time from request to sound"
            />
            <OpsStatTile
              label="Failed starts"
              value={count(qoe?.failed)}
              caption={`${count(qoe?.cancelled)} cancelled before playing`}
              tone={qoe?.failed ? "warning" : "default"}
            />
          </div>
          {qoe?.availability === "insufficient_sample" ? (
            <p className="m-0 text-sm text-text-muted">
              Fewer than {minimum} play attempts in this window, so ratios are
              not shown yet.
            </p>
          ) : null}
          {caveats.length > 0 ? (
            <ul className="m-0 list-none space-y-1 p-0 text-sm text-text-muted">
              {caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          ) : null}
          <div
            className="flex flex-wrap gap-2"
            aria-label="Telemetry delivery"
            role="group"
          >
            <InfoBadge>{count(telemetry.accepted)} events accepted</InfoBadge>
            <InfoBadge>{count(telemetry.duplicates)} duplicates</InfoBadge>
            <InfoBadge>{count(telemetry.rate_limited)} rate limited</InfoBadge>
            <InfoBadge>{count(telemetry.client_losses)} lost on clients</InfoBadge>
            <InfoBadge>{count(telemetry.legacy_batches)} legacy batches</InfoBadge>
          </div>
        </div>
      )}
    </OpsPanel>
  );
}
