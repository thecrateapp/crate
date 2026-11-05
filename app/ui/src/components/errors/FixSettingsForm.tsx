import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import type { StatusTone } from "@/components/admin/StatusBadge";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import {
  ERRORS_API,
  apiErrorCode,
  type ConnectionUpdate,
  type ErrorTrackingConnection,
  type FixSettingsUpdate,
} from "@/lib/error-inbox";

const CONNECTION_URL = `${ERRORS_API}/connection`;
const DEFAULT_REPOSITORY = "thecrateapp/crate";
const DEFAULT_WORKFLOW = "error-autofix.yml";
const DEFAULT_REF = "main";

export function fixState(connection: ErrorTrackingConnection): {
  label: string;
  tone: StatusTone;
} {
  if (!connection.fix) return { label: "Off", tone: "neutral" };
  if (!connection.fix.has_token)
    return { label: "Token missing", tone: "warning" };
  return { label: "Ready", tone: "success" };
}

/** The stored Sentry settings, sent unchanged with the Launch fix ones. */
function sentrySettings(connection: ErrorTrackingConnection): ConnectionUpdate {
  return {
    base_url: connection.base_url,
    organization: connection.organization ?? "",
    projects: connection.projects,
    environments: connection.environments,
  };
}

/**
 * Launch fix settings: the GitHub repository, workflow and branch Crate
 * dispatches, and a fine-grained token. The token is write-only, like the
 * Sentry one. Turning Launch fix off deletes the stored GitHub token.
 */
export function FixSettingsForm({
  connection,
  onSaved,
}: {
  connection: ErrorTrackingConnection;
  onSaved: () => void;
}) {
  const fix = connection.fix;
  const [repository, setRepository] = useState(
    fix?.repository ?? DEFAULT_REPOSITORY,
  );
  const [workflow, setWorkflow] = useState(fix?.workflow ?? DEFAULT_WORKFLOW);
  const [ref, setRef] = useState(fix?.ref ?? DEFAULT_REF);
  // Write-only: never prefilled, sent only when someone types a new one.
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState<"save" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sentryReady = Boolean(connection.organization);

  async function put(
    nextFix: FixSettingsUpdate | null,
    action: "save" | "off",
  ): Promise<boolean> {
    setSaving(action);
    setError(null);
    try {
      await api<ErrorTrackingConnection>(CONNECTION_URL, "PUT", {
        ...sentrySettings(connection),
        fix: nextFix,
      } satisfies ConnectionUpdate);
      return true;
    } catch (caught) {
      setError(
        apiErrorCode(caught) === "ERROR_TRACKING_INVALID"
          ? apiErrorText(caught, "Crate could not accept these settings.")
          : "Could not save Launch fix. Try again.",
      );
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const next: FixSettingsUpdate = {
      repository: repository.trim(),
      workflow: workflow.trim(),
      ref: ref.trim() || DEFAULT_REF,
    };
    const typed = token.trim();
    if (typed) next.token = typed;
    if (await put(next, "save")) {
      setToken("");
      toast.success("Launch fix saved");
      onSaved();
    }
  }

  async function turnOff() {
    if (await put(null, "off")) {
      toast.success("Launch fix is off and its GitHub token was deleted");
      onSaved();
    }
  }

  if (!sentryReady)
    return (
      <p className="text-sm text-text-muted">
        Save the Sentry settings first: Launch fix dispatches issues the inbox
        has synced.
      </p>
    );

  return (
    <form
      aria-label="Launch fix settings"
      onSubmit={(event) => void save(event)}
      className="grid min-w-0 content-start gap-4"
    >
      <p className="text-sm text-text-muted">
        Launch fix asks GitHub Actions to run the autofix workflow for one
        issue. Crate sends only the issue&apos;s short id and an optional note,
        which are public in the workflow run.
      </p>
      <FormField label="Repository" hint="owner/name on GitHub.">
        <Input
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={201}
          value={repository}
          onChange={(event) => setRepository(event.target.value)}
        />
      </FormField>
      <FormField label="Workflow" hint="The workflow file name.">
        <Input
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={105}
          value={workflow}
          onChange={(event) => setWorkflow(event.target.value)}
        />
      </FormField>
      <FormField label="Branch" hint="The ref the workflow runs on.">
        <Input
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          value={ref}
          onChange={(event) => setRef(event.target.value)}
        />
      </FormField>
      <FormField
        label="GitHub token"
        hint={
          fix?.has_token
            ? "A token is stored and never shown. Leave this empty to keep it, or type a new one to replace it."
            : "A fine-grained personal access token for this repository only, with Actions read and write and nothing else."
        }
      >
        <Input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          required={!fix?.has_token}
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
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={saving !== null}
          aria-busy={saving === "save" || undefined}
        >
          {saving === "save" ? "Saving…" : "Save Launch fix"}
        </Button>
        {fix ? (
          <Button
            type="button"
            variant="outline"
            disabled={saving !== null}
            aria-busy={saving === "off" || undefined}
            onClick={() => void turnOff()}
          >
            {saving === "off" ? "Turning off…" : "Turn off"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
