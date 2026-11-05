import { useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { FormField } from "@crate/ui/primitives/FormField";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge, type StatusTone } from "@/components/admin/StatusBadge";
import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { FixSettingsForm, fixState } from "./FixSettingsForm";
import {
  ERRORS_API,
  accessText,
  apiErrorCode,
  formatCount,
  parseNameList,
  problemText,
  type ConnectionUpdate,
  type EnqueuedTask,
  type ErrorTrackingConnection,
  type SyncState,
} from "@/lib/error-inbox";

const CONNECTION_URL = `${ERRORS_API}/connection`;

function connectionState(connection: ErrorTrackingConnection): {
  label: string;
  tone: StatusTone;
} {
  if (!connection.configured)
    return { label: "Not configured", tone: "neutral" };
  if (connection.access?.read === false || connection.access?.error_code)
    return { label: "Needs attention", tone: "warning" };
  if (connection.sync?.status === "failed")
    return { label: "Sync failing", tone: "warning" };
  if (connection.access?.write === false)
    return { label: "Read only", tone: "warning" };
  return { label: "Connected", tone: "success" };
}

const SYNC_LABEL: Record<SyncState["status"], string> = {
  ok: "Completed",
  partial: "Partial",
  failed: "Failed",
};

/** The connection test result, from the worker's `access` or flat fields. */
export function connectionTestOutcome(result?: Record<string, unknown>): {
  read: boolean | null;
  write: boolean | null;
  errorCode: string | null;
} {
  const access =
    result && typeof result.access === "object" && result.access !== null
      ? (result.access as Record<string, unknown>)
      : (result ?? {});
  const flag = (value: unknown) => (typeof value === "boolean" ? value : null);
  return {
    read: flag(access.read),
    write: flag(access.write),
    errorCode:
      typeof result?.error_code === "string" ? result.error_code : null,
  };
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 border-b border-border-quiet py-2.5">
      <dt>
        <MonoLabel as="span">{label}</MonoLabel>
      </dt>
      <dd className="min-w-0 text-sm text-text-secondary wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel as="h3" tone="accent" id={headingId}>
          {title}
        </MonoLabel>
        {action}
      </div>
      {children}
    </section>
  );
}

function ConnectionStatus({
  connection,
  testing,
  onTest,
}: {
  connection: ErrorTrackingConnection;
  testing: boolean;
  onTest: () => void;
}) {
  const { access, sync } = connection;
  const state = connectionState(connection);
  return (
    <Section
      title="Status"
      action={<StatusBadge tone={state.tone}>{state.label}</StatusBadge>}
    >
      <dl className="border-t border-border-quiet">
        <Detail label="Token">
          {connection.has_token ? "Token stored" : "No token stored"}
        </Detail>
        <Detail label="Read access">{accessText(access?.read)}</Detail>
        <Detail label="Write access">
          {accessText(access?.write)}
          {access?.write === false ? (
            <span className="block text-text-muted">
              Without event:write the inbox is read-only.
            </span>
          ) : null}
        </Detail>
        <Detail label="Last checked">
          {access?.checked_at ? (
            <>
              <RelativeTime value={access.checked_at} />
              {access.source === "connection_test"
                ? " by a connection test"
                : access.source === "sync"
                  ? " by a sync"
                  : null}
            </>
          ) : (
            "Never"
          )}
        </Detail>
        {access?.error_code ? (
          <Detail label="Problem">{problemText(access.error_code)}</Detail>
        ) : null}
        <Detail label="Last sync">
          {sync ? (
            <>
              {SYNC_LABEL[sync.status]}
              {sync.finished_at ? (
                <>
                  {" · "}
                  <RelativeTime value={sync.finished_at} />
                </>
              ) : null}
              {sync.status !== "ok" &&
              sync.error_code &&
              sync.error_code !== access?.error_code ? (
                <span className="block text-text-muted">
                  {problemText(sync.error_code)}
                </span>
              ) : null}
              {sync.truncated.full || sync.truncated.recent ? (
                <span className="block text-text-muted">
                  Stopped at the page limit; some issues wait for the next pass.
                </span>
              ) : null}
            </>
          ) : (
            "Not run yet"
          )}
        </Detail>
        {sync?.last_success_at ? (
          <Detail label="Last success">
            <RelativeTime value={sync.last_success_at} />
          </Detail>
        ) : null}
        {sync ? (
          <Detail label="Issues listed">
            {formatCount(sync.counts.listed ?? null)}
          </Detail>
        ) : null}
      </dl>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          disabled={testing || !connection.configured}
          aria-busy={testing || undefined}
          onClick={onTest}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <p role="status" className="text-sm text-text-muted">
          {testing
            ? "Checking the stored token with Sentry…"
            : connection.configured
              ? "Checks the saved settings in a worker; nothing is sent from this page."
              : "Save the settings and a token first."}
        </p>
      </div>
    </Section>
  );
}

function ConnectionForm({
  connection,
  onSaved,
}: {
  connection: ErrorTrackingConnection;
  onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(connection.base_url);
  const [organization, setOrganization] = useState(
    connection.organization ?? "",
  );
  const [projects, setProjects] = useState(connection.projects.join(", "));
  const [environments, setEnvironments] = useState(
    connection.environments.join(", "),
  );
  // Write-only: never prefilled, sent only when someone types a new one.
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const body: ConnectionUpdate = {
      base_url: baseUrl.trim(),
      organization: organization.trim(),
      projects: parseNameList(projects),
      environments: parseNameList(environments),
    };
    const typed = token.trim();
    if (typed) body.token = typed;
    try {
      await api<ErrorTrackingConnection>(CONNECTION_URL, "PUT", body);
      setToken("");
      toast.success("Connection saved");
      onSaved();
    } catch (caught) {
      const code = apiErrorCode(caught);
      setError(
        code === "ERROR_TRACKING_INVALID"
          ? apiErrorText(caught, "Crate could not accept these settings.")
          : "Could not save the connection. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="Sentry connection settings"
      onSubmit={(event) => void save(event)}
      className="grid min-w-0 content-start gap-4"
    >
      <FormField
        label="Base URL"
        hint="sentry.io, us.sentry.io, de.sentry.io or your own HTTPS address."
      >
        <Input
          type="url"
          required
          autoComplete="off"
          spellCheck={false}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </FormField>
      <FormField
        label="Organization"
        hint="The organization slug, as it appears in Sentry addresses."
      >
        <Input
          required
          autoComplete="off"
          spellCheck={false}
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
        />
      </FormField>
      <FormField
        label="Projects"
        hint="Project slugs separated by commas. Leave empty for every project the token can see."
      >
        <Input
          autoComplete="off"
          spellCheck={false}
          placeholder="crate-api, crate-workers…"
          value={projects}
          onChange={(event) => setProjects(event.target.value)}
        />
      </FormField>
      <FormField
        label="Environments"
        hint="Separated by commas. Leave empty for every environment."
      >
        <Input
          autoComplete="off"
          spellCheck={false}
          placeholder="production"
          value={environments}
          onChange={(event) => setEnvironments(event.target.value)}
        />
      </FormField>
      <FormField
        label="Token"
        hint={
          connection.has_token
            ? "A token is stored and never shown. Leave this empty to keep it, or type a new one to replace it."
            : "An internal integration token with org:read, project:read and event:read. Add event:write to resolve and ignore issues from Crate."
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          required={!connection.has_token}
          maxLength={512}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </FormField>
      {error ? (
        <p role="alert" className="text-sm text-state-warning-text">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function savedKey(connection: ErrorTrackingConnection): string {
  return JSON.stringify([
    connection.base_url,
    connection.organization,
    connection.projects,
    connection.environments,
  ]);
}

function savedFixKey(connection: ErrorTrackingConnection): string {
  return JSON.stringify([connection.organization, connection.fix]);
}

/**
 * Sentry connection status and settings, the body of the connection drawer
 * (ops.runtime.manage only), plus the Launch fix settings. Saving stores the
 * settings (and a typed token); "Test connection" enqueues a worker task and
 * waits for it: the page itself never calls Sentry or GitHub.
 */
export function ConnectionPanel({ onChanged }: { onChanged?: () => void }) {
  const connection = useApi<ErrorTrackingConnection>(CONNECTION_URL);
  const { pollTask } = useTaskPoll();
  const [testing, setTesting] = useState(false);
  const data = connection.data;

  function refresh() {
    connection.refetch();
    onChanged?.();
  }

  async function testConnection() {
    setTesting(true);
    let taskId: string;
    try {
      ({ task_id: taskId } = await api<EnqueuedTask>(
        `${CONNECTION_URL}/test`,
        "POST",
      ));
    } catch (caught) {
      setTesting(false);
      toast.error(problemText(apiErrorCode(caught) ?? "SENTRY_UNAVAILABLE"));
      return;
    }
    pollTask(
      taskId,
      (result) => {
        setTesting(false);
        const outcome = connectionTestOutcome(result);
        if (outcome.errorCode) toast.error(problemText(outcome.errorCode));
        else
          toast.success(
            `Connection works. Read access: ${accessText(outcome.read)}. Write access: ${accessText(outcome.write)}.`,
          );
        refresh();
      },
      (error) => {
        setTesting(false);
        toast.error(error || "The connection test failed.");
        refresh();
      },
    );
  }

  if (!data)
    return connection.loading ? (
      <LoadingState label="Loading the Sentry connection" />
    ) : (
      <ErrorState
        message="Could not load the Sentry connection."
        onRetry={connection.refetch}
      />
    );
  return (
    <div className="min-w-0 space-y-8">
      <ConnectionStatus
        connection={data}
        testing={testing}
        onTest={() => void testConnection()}
      />
      <Section title="Settings">
        <ConnectionForm
          key={savedKey(data)}
          connection={data}
          onSaved={refresh}
        />
      </Section>
      <Section
        title="Launch fix"
        action={
          <StatusBadge tone={fixState(data).tone}>
            {fixState(data).label}
          </StatusBadge>
        }
      >
        <FixSettingsForm
          key={savedFixKey(data)}
          connection={data}
          onSaved={refresh}
        />
      </Section>
    </div>
  );
}
