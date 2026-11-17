import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import type { StatusTone } from "@/components/admin/StatusBadge";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import {
  ERRORS_API,
  apiErrorCode,
  type ConnectionUpdate,
  type ErrorTrackingConnection,
  type FixExecutor,
  type FixSettingsUpdate,
} from "@/lib/error-inbox";

const CONNECTION_URL = `${ERRORS_API}/connection`;
const DEFAULT_REPOSITORY = "thecrateapp/crate";
const DEFAULT_WORKFLOW = "error-autofix.yml";
const DEFAULT_REF = "main";
const EXECUTOR_OPTIONS: { value: FixExecutor; label: string }[] = [
  { value: "github_actions", label: "GitHub Actions workflow" },
  { value: "factory", label: "Crate Software Factory" },
];

export function fixState(connection: ErrorTrackingConnection): {
  label: string;
  tone: StatusTone;
} {
  const fix = connection.fix;
  if (!fix) return { label: "Off", tone: "neutral" };
  if (!fix.has_token) return { label: "Token missing", tone: "warning" };
  if (fix.executor === "factory" && !fix.factory?.has_token)
    return { label: "Factory token missing", tone: "warning" };
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
 * Launch fix settings: who works on the fixes (the autofix workflow or the
 * Crate Software Factory), the GitHub repository, workflow and branch, and a
 * fine-grained token; for the factory, its tailnet URL, its GitHub App login
 * and its token. Tokens are write-only, like the Sentry one. Turning Launch
 * fix off deletes the stored tokens.
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
  const [executor, setExecutor] = useState<FixExecutor>(
    fix?.executor ?? "github_actions",
  );
  const [factoryUrl, setFactoryUrl] = useState(fix?.factory?.base_url ?? "");
  const [factoryAuthor, setFactoryAuthor] = useState(
    fix?.factory?.pr_author ?? "",
  );
  // Write-only: never prefilled, sent only when someone types a new one.
  const [token, setToken] = useState("");
  const [factoryToken, setFactoryToken] = useState("");
  const usesFactory = executor === "factory";
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
    if (usesFactory) next.executor = "factory";
    const typed = token.trim();
    if (typed) next.token = typed;
    // Stored factory settings stay while the workflow works on new fixes, so
    // the factory's open runs can still be followed.
    if (usesFactory || fix?.factory) {
      next.factory = {
        base_url: factoryUrl.trim(),
        pr_author: factoryAuthor.trim(),
      };
      const typedFactory = factoryToken.trim();
      if (typedFactory) next.factory.token = typedFactory;
    }
    if (await put(next, "save")) {
      setToken("");
      setFactoryToken("");
      toast.success("Launch fix saved");
      onSaved();
    }
  }

  async function turnOff() {
    if (await put(null, "off")) {
      toast.success("Launch fix is off and its tokens were deleted");
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
      <FormField label="Fixer">
        {(control) => (
          <AdminSelect
            id={control.id}
            aria-labelledby={control["aria-labelledby"]}
            aria-describedby={control["aria-describedby"]}
            triggerClassName="w-full max-w-none"
            value={executor}
            onChange={(value) => setExecutor(value as FixExecutor)}
            placeholder="Fixer"
            allowClear={false}
            options={EXECUTOR_OPTIONS}
          />
        )}
      </FormField>
      {usesFactory ? (
        <p className="text-sm text-text-muted">
          Launch fix hands one issue to the Crate Software Factory over the
          tailnet: its short id, an optional note and the sanitized bug report.
          The factory opens a draft pull request only after a person accepts its
          spec and grants its publication, so a fix may take up to 48 hours.
        </p>
      ) : (
        <p className="text-sm text-text-muted">
          Launch fix asks GitHub Actions to run the autofix workflow for one
          issue. Crate sends only the issue&apos;s short id and an optional
          note, which are public in the workflow run.
        </p>
      )}
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
      {usesFactory ? null : (
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
      )}
      <FormField
        label="Branch"
        hint={
          usesFactory
            ? "The base branch of the fixes."
            : "The ref the workflow runs on."
        }
      >
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
            : usesFactory
              ? "A fine-grained personal access token for this repository only. With the factory Crate only follows, merges and cleans up its pull requests: Pull requests and Contents read and write, Checks and Commit statuses read."
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
      {usesFactory ? (
        <>
          <FormField
            label="Factory URL"
            hint="The factory's bugs listener, such as http://100.101.102.103:8788. Plain HTTP only on the tailnet."
          >
            <Input
              required
              type="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={2048}
              value={factoryUrl}
              onChange={(event) => setFactoryUrl(event.target.value)}
            />
          </FormField>
          <FormField
            label="Factory GitHub App"
            hint="The login of the factory's GitHub App, such as name[bot]. Approve & merge only accepts its pull requests."
          >
            <Input
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={39}
              value={factoryAuthor}
              onChange={(event) => setFactoryAuthor(event.target.value)}
            />
          </FormField>
          <FormField
            label="Factory token"
            hint={
              fix?.factory?.has_token
                ? "A token is stored and never shown. Leave this empty to keep it, or type a new one to replace it."
                : "The factory's bugs token: it can only submit, read and cancel bugs."
            }
          >
            <Input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              required={!fix?.factory?.has_token}
              maxLength={512}
              value={factoryToken}
              onChange={(event) => setFactoryToken(event.target.value)}
            />
          </FormField>
        </>
      ) : null}
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
