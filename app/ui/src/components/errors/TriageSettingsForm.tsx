import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FormField } from "@crate/ui/primitives/FormField";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import type { StatusTone } from "@/components/admin/StatusBadge";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import {
  ERRORS_API,
  MAX_DAILY_TRIAGE,
  apiErrorCode,
  triagePassText,
  type ConnectionUpdate,
  type ErrorTrackingConnection,
} from "@/lib/error-inbox";

const CONNECTION_URL = `${ERRORS_API}/connection`;

export function triageState(connection: ErrorTrackingConnection): {
  label: string;
  tone: StatusTone;
} {
  if (!connection.triage.automatic) return { label: "Manual", tone: "neutral" };
  if (connection.triage.daily_max === 0)
    return { label: "Paused", tone: "warning" };
  return { label: "Automatic", tone: "success" };
}

/**
 * Automatic AI triage after each sync: on or off, and the most issues it may
 * triage in 24 hours. It starts off; Investigate and Triage backlog work
 * either way. The model is chosen in AI models, not here.
 */
export function TriageSettingsForm({
  connection,
  onSaved,
}: {
  connection: ErrorTrackingConnection;
  onSaved: () => void;
}) {
  const [automatic, setAutomatic] = useState(connection.triage.automatic);
  const [dailyMax, setDailyMax] = useState(String(connection.triage.daily_max));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pass = connection.sync?.triage;
  const lastPass = connection.triage.automatic ? triagePassText(pass) : null;
  const needsAttention =
    pass?.status === "unavailable" || pass?.status === "failed";

  if (!connection.organization)
    return (
      <p className="text-sm text-text-muted">
        Save the Sentry settings first: triage reads the issues the inbox has
        synced.
      </p>
    );

  async function save(event: FormEvent) {
    event.preventDefault();
    const limit = Number(dailyMax);
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_DAILY_TRIAGE) {
      setError(
        `The daily limit must be a whole number from 0 to ${MAX_DAILY_TRIAGE}.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api<ErrorTrackingConnection>(CONNECTION_URL, "PUT", {
        // The stored Sentry settings go back unchanged.
        base_url: connection.base_url,
        organization: connection.organization ?? "",
        projects: connection.projects,
        environments: connection.environments,
        triage: { automatic, daily_max: limit },
      } satisfies ConnectionUpdate);
      toast.success(
        automatic ? "Automatic triage is on" : "Automatic triage is off",
      );
      onSaved();
    } catch (caught) {
      setError(
        apiErrorCode(caught) === "ERROR_TRACKING_INVALID"
          ? apiErrorText(caught, "Crate could not accept these settings.")
          : "Could not save the triage settings. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="AI triage settings"
      onSubmit={(event) => void save(event)}
      className="grid min-w-0 content-start gap-4"
    >
      <p className="text-sm text-text-muted">
        After each sync, Crate can ask the model bound to Triage error issue to
        classify new, regressed and escalating issues, highest score first. Only
        the sanitized event summary leaves the server, never the title or the
        Sentry link. A failed triage is not retried automatically.
      </p>
      {lastPass ? (
        <p
          role="status"
          className={
            needsAttention
              ? "text-sm text-state-warning-text"
              : "text-sm text-text-secondary"
          }
        >
          {lastPass}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <Switch
          checked={automatic}
          disabled={saving}
          onCheckedChange={setAutomatic}
        />
        Triage new issues automatically
      </label>
      <FormField
        label="Daily limit"
        hint={`At most this many automatic triages in 24 hours, from 0 to ${MAX_DAILY_TRIAGE}. Each issue is triaged at most once a day.`}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_DAILY_TRIAGE}
          step={1}
          required
          value={dailyMax}
          onChange={(event) => setDailyMax(event.target.value)}
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-sm text-state-warning-text">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
          {saving ? "Saving…" : "Save triage"}
        </Button>
      </div>
    </form>
  );
}
