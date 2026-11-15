import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { cn } from "@crate/ui/lib/cn";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";

import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { api } from "@/lib/api";
import {
  BACKUPS_API,
  KIND_LABEL,
  S3_PRESETS,
  TEST_TIMEOUT_MS,
  connectionFromTask,
  formatAgo,
  formatBackupBytes,
  formatDay,
  type BackupDestination,
  type BackupKind,
  type BackupProvider,
  type ConnectionResult,
  type TaskEnqueue,
} from "@/lib/backups";

import { KindMark, TestResult } from "./backup-ui";
import {
  createPayload,
  draftFrom,
  missingFields,
  newDraft,
  probePayload,
  updatePayload,
  type DestinationDraft,
} from "./destination-form";
import {
  B2Credentials,
  B2Fields,
  CloudFolderFields,
  ConnectBlock,
  FormSection,
  LocalFields,
  NameAndEnabled,
  OAuthClientFields,
  PasteToken,
  RepositoryPassword,
  S3Credentials,
  S3Fields,
  SftpFields,
  SftpKey,
  type FieldsProps,
} from "./DestinationFields";
import { SnapshotsTab } from "./SnapshotsTab";

const PROVIDER_TEXT: Record<BackupKind, string> = {
  local:
    "A folder on this server's backup volume. Fast restores, but it does not survive losing the server.",
  s3: "Any S3 API: pick a preset to fill the endpoint and region.",
  b2: "B2 native API with an application key restricted to one bucket.",
  sftp: "Hetzner Storage Box, rsync.net or a home server. Crate generates the SSH key.",
  gdrive:
    "Connect with your own OAuth client. The drive.file scope only lets Crate see files it created.",
  dropbox: "Connect with OAuth to a Dropbox app folder.",
};

const FORM_TEXT: Record<BackupKind, string> = {
  local:
    "A restic repository in a folder of the backup volume, mounted at /backups in the workers.",
  s3: "S3-compatible bucket. Secrets are write-only: Crate stores them encrypted and never shows them again.",
  b2: "A B2 bucket through restic's native B2 backend.",
  sftp: "SFTP through restic. Crate generates an SSH key for this destination; install its public key on the server.",
  gdrive:
    "Google Drive through rclone. Crate keeps the OAuth token encrypted and refreshes it on its own.",
  dropbox: "Dropbox through rclone, inside an app folder.",
};

const KIND_ORDER: BackupKind[] = [
  "local",
  "s3",
  "b2",
  "sftp",
  "gdrive",
  "dropbox",
];

export type DrawerTarget = { mode: "add" } | { mode: "edit"; id: string };

type TestState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; saved: boolean; connection: ConnectionResult; at: number }
  | { phase: "error"; message: string };

function ProviderPicker({
  kind,
  preset,
  onKind,
  onPreset,
}: {
  kind: BackupKind;
  preset: string;
  onKind: (kind: BackupKind) => void;
  onPreset: (preset: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Provider"
      className="grid gap-3 md:grid-cols-2"
    >
      {KIND_ORDER.map((value) => {
        const selected = value === kind;
        return (
          <div
            key={value}
            className={cn(
              "flex min-w-0 flex-col gap-3 rounded-md border p-4 transition-colors",
              selected
                ? "border-accent-action-hi/40 bg-accent-action/10"
                : "border-border-quiet hover:border-accent-action-hi/40",
            )}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onKind(value)}
              className="flex min-h-11 w-full min-w-0 flex-col items-start gap-3 text-left"
            >
              <span className="flex w-full items-center gap-3">
                <KindMark
                  kind={value}
                  className={selected ? "text-accent-action-hi" : undefined}
                />
                <span className="text-sm font-medium text-text-primary">
                  {KIND_LABEL[value]}
                </span>
                {selected ? (
                  <span className="ml-auto inline-flex">
                    <InfoBadge tone="accent">Selected</InfoBadge>
                  </span>
                ) : null}
              </span>
              <span className="text-sm text-text-muted">
                {PROVIDER_TEXT[value]}
              </span>
            </button>
            {value === "s3" && selected ? (
              <div className="crate-form-field">
                <MonoLabel as="span">Preset</MonoLabel>
                <SegmentedControl
                  as="radio"
                  label="S3 preset"
                  size="sm"
                  value={preset}
                  onValueChange={onPreset}
                  className="flex-wrap"
                  items={S3_PRESETS.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function savedTestLines(destination: BackupDestination): ReactNode[] {
  const lines: ReactNode[] = ["Write, read and delete probe passed"];
  if (destination.repository_initialized_at)
    lines.push(
      `Repository initialised ${formatDay(destination.repository_initialized_at)} · ${
        destination.snapshot_count ?? 0
      } snapshots${
        destination.repository_bytes != null
          ? ` · ${formatBackupBytes(destination.repository_bytes)}`
          : ""
      }`,
    );
  return lines;
}

function TestPanel({
  test,
  draft,
  destination,
}: {
  test: TestState;
  draft: DestinationDraft;
  destination: BackupDestination | null;
}) {
  if (test.phase === "running")
    return (
      <TestResult
        ok={null}
        running
        title="Testing the connection"
        lines={[
          "A worker writes, reads and deletes a probe file, then opens the repository.",
        ]}
      />
    );
  if (test.phase === "error")
    return (
      <TestResult ok={false} title="Test not run" lines={[test.message]} />
    );
  if (test.phase === "done") {
    const { connection } = test;
    if (connection.status === "ok") {
      const lines: ReactNode[] = ["Write, read and delete probe passed"];
      if (!test.saved)
        lines.push(
          connection.repository === "existing"
            ? "A restic repository already exists there. Crate can only open it with its own password."
            : "No repository there yet: Crate creates one when you save and test.",
        );
      else
        lines.push(
          `Repository ${connection.repository === "initialized" ? "initialised" : "open"} · ${
            connection.snapshot_count ?? 0
          } snapshots${
            connection.repository_bytes != null
              ? ` · ${formatBackupBytes(connection.repository_bytes)}`
              : ""
          }`,
        );
      return (
        <TestResult ok title="Connection works" when="Just now" lines={lines} />
      );
    }
    return (
      <TestResult
        ok={false}
        title={
          connection.status === "unavailable"
            ? "Tools unavailable"
            : "Connection failed"
        }
        when="Just now"
        lines={[
          <code
            key="error"
            className="block whitespace-pre-wrap break-all font-mono text-label"
          >
            {connection.error || "The test failed without a message"}
          </code>,
        ]}
      />
    );
  }
  if (!destination) {
    if (draft.kind === "sftp")
      return (
        <TestResult
          ok={null}
          title="Tested after saving"
          lines={[
            "Save first: Crate generates the SSH key on save. Install its public key on the server, then test the connection.",
          ]}
        />
      );
    return (
      <TestResult
        ok={null}
        title="Not tested yet"
        lines={[
          draft.kind === "gdrive" || draft.kind === "dropbox"
            ? `Connect ${KIND_LABEL[draft.kind]} or paste a token, then test the connection.`
            : "Test connection runs a write, read and delete probe without saving anything.",
        ]}
      />
    );
  }
  if (destination.status === "failing" || destination.status === "unavailable")
    return (
      <TestResult
        ok={false}
        title="Connection failed"
        when={
          destination.last_checked_at
            ? formatAgo(destination.last_checked_at)
            : undefined
        }
        lines={[
          <code
            key="error"
            className="block whitespace-pre-wrap break-all font-mono text-label"
          >
            {destination.last_error || "The last test failed"}
          </code>,
        ]}
      />
    );
  if (destination.repository_initialized_at)
    return (
      <TestResult
        ok
        title="Connection works"
        when={
          destination.last_checked_at
            ? formatAgo(destination.last_checked_at)
            : undefined
        }
        lines={savedTestLines(destination)}
      />
    );
  return (
    <TestResult
      ok={null}
      title="Not tested yet"
      lines={[
        destination.oauth && destination.missing_secrets.includes("token")
          ? `Connect ${KIND_LABEL[destination.kind]} first, then test the connection.`
          : "Test the connection: the first passing test enables the destination.",
      ]}
    />
  );
}

/**
 * Add and edit a destination in a side drawer (BG1-8), like the Errors
 * connection panel. Unsaved settings are tested without storing secrets
 * (BG1-9); a saved destination has a Snapshots tab (BG1-13).
 */
export function DestinationDrawer({
  target,
  destination,
  onClose,
  onChanged,
  onSaved,
}: {
  target: DrawerTarget | null;
  destination: BackupDestination | null;
  onClose: () => void;
  onChanged: () => void;
  onSaved: (destination: BackupDestination) => void;
}) {
  const providers = useApi<BackupProvider[]>(
    target ? `${BACKUPS_API}/providers` : null,
  );
  const { pollTask, stopPolling } = useTaskPoll();
  const [step, setStep] = useState<"picker" | "form">("picker");
  const [kind, setKind] = useState<BackupKind>("s3");
  const [preset, setPreset] = useState("r2");
  const [draft, setDraft] = useState<DestinationDraft | null>(null);
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("settings");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const taskRef = useRef<string | null>(null);
  const open = target !== null;
  const editing = target?.mode === "edit";
  const provider = providers.data?.find(
    (p) => p.kind === (draft?.kind ?? destination?.kind ?? kind),
  );

  // Reset whenever the drawer opens on another target.
  const targetKey = target ? (target.mode === "edit" ? target.id : "add") : "";
  const createdRef = useRef<string | null>(null);
  useEffect(() => {
    // Saving a new destination turns the drawer into its edit view: keep the
    // form and the test that may already follow it.
    if (target?.mode === "edit" && target.id === createdRef.current) {
      createdRef.current = null;
      return;
    }
    createdRef.current = null;
    setStep(target?.mode === "edit" ? "form" : "picker");
    setTest({ phase: "idle" });
    setTab("settings");
    setDraft(null);
    setBusy(false);
    if (taskRef.current) stopPolling(taskRef.current);
    taskRef.current = null;
  }, [targetKey]);

  // An edited destination's draft starts from the saved settings.
  useEffect(() => {
    if (editing && destination && providers.data && !draft)
      setDraft(draftFrom(destination, provider));
  }, [editing, destination?.id, providers.data, draft]);

  function close() {
    if (taskRef.current) stopPolling(taskRef.current);
    taskRef.current = null;
    onClose();
  }

  function proceed() {
    setDraft(
      newDraft(
        kind,
        providers.data?.find((p) => p.kind === kind),
        preset,
      ),
    );
    setStep("form");
    setTest({ phase: "idle" });
  }

  function follow(taskId: string, saved: boolean) {
    taskRef.current = taskId;
    pollTask(
      taskId,
      (result) => {
        taskRef.current = null;
        const connection = connectionFromTask(result);
        if (!connection) {
          setTest({
            phase: "error",
            message: String(result?.error ?? "The test returned no result"),
          });
          return;
        }
        setTest({ phase: "done", saved, connection, at: Date.now() });
        if (saved) onChanged();
      },
      (error) => {
        taskRef.current = null;
        setTest({ phase: "error", message: error || "The test task failed" });
        if (saved) onChanged();
      },
      3000,
      TEST_TIMEOUT_MS,
    );
  }

  async function runTest(saved: BackupDestination | null = destination) {
    if (!draft) return;
    setTest({ phase: "running" });
    try {
      const result = saved
        ? await api<TaskEnqueue>(
            `${BACKUPS_API}/destinations/${saved.id}/test`,
            "POST",
          )
        : await api<TaskEnqueue>(
            `${BACKUPS_API}/destinations/test`,
            "POST",
            probePayload(draft, provider),
          );
      follow(result.task_id, Boolean(saved));
    } catch (error) {
      setTest({
        phase: "error",
        message: apiErrorText(error, "The test could not start"),
      });
    }
  }

  async function save(): Promise<BackupDestination | null> {
    if (!draft) return null;
    const missing = missingFields(draft, provider, destination);
    if (missing.length) {
      toast.error(
        `Fill in ${missing.map((m) => m.replace(/_/g, " ")).join(", ")}`,
      );
      return null;
    }
    setBusy(true);
    try {
      let saved: BackupDestination;
      if (destination) {
        const body = updatePayload(draft, destination, provider);
        saved = Object.keys(body).length
          ? await api<BackupDestination>(
              `${BACKUPS_API}/destinations/${destination.id}`,
              "PATCH",
              body,
            )
          : destination;
        toast.success("Destination saved");
      } else {
        saved = await api<BackupDestination>(
          `${BACKUPS_API}/destinations`,
          "POST",
          createPayload(draft, provider),
        );
        toast.success(
          saved.kind === "sftp"
            ? "Destination saved. Install its public key on the server, then test it."
            : "Destination saved. It stays disabled until its first test passes.",
        );
      }
      setDraft(draftFrom(saved, provider));
      if (!destination) createdRef.current = saved.id;
      onSaved(saved);
      onChanged();
      return saved;
    } catch (error) {
      toast.error(apiErrorText(error, "The destination could not be saved"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveAndTest() {
    const saved = await save();
    if (
      saved &&
      saved.kind !== "sftp" &&
      !(saved.oauth && saved.missing_secrets.includes("token"))
    )
      await runTest(saved);
  }

  async function patch(body: Record<string, unknown>, message: string) {
    if (!destination) return;
    setBusy(true);
    try {
      const saved = await api<BackupDestination>(
        `${BACKUPS_API}/destinations/${destination.id}`,
        "PATCH",
        body,
      );
      setDraft(draftFrom(saved, provider));
      onSaved(saved);
      onChanged();
      toast.success(message);
    } catch (error) {
      toast.error(apiErrorText(error, "The change could not be saved"));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const saved =
      destination &&
      !Object.keys(updatePayload(draft!, destination, provider)).length
        ? destination
        : await save();
    if (!saved) return;
    setBusy(true);
    try {
      const result = await api<{ authorize_url: string }>(
        `${BACKUPS_API}/destinations/${saved.id}/oauth/start`,
        "POST",
      );
      window.location.assign(result.authorize_url);
    } catch (error) {
      toast.error(apiErrorText(error, "The connection could not start"));
      setBusy(false);
    }
  }

  async function remove() {
    if (!destination) return;
    setBusy(true);
    try {
      await api(`${BACKUPS_API}/destinations/${destination.id}`, "DELETE");
      toast.success("Destination removed");
      setConfirmRemove(false);
      onChanged();
      close();
    } catch (error) {
      toast.error(apiErrorText(error, "The destination could not be removed"));
    } finally {
      setBusy(false);
    }
  }

  const activeKind = draft?.kind ?? destination?.kind ?? kind;
  const fields: FieldsProps | null = draft
    ? { draft, onChange: setDraft, destination }
    : null;
  const title =
    step === "picker"
      ? "Add destination"
      : draft?.name || destination?.name || KIND_LABEL[activeKind];
  const description =
    step === "picker"
      ? "Where should copies go? Each destination becomes its own restic repository, with a password Crate generates and adds to the recovery kit."
      : FORM_TEXT[activeKind];
  const testing = test.phase === "running";
  const canProbe = destination || activeKind !== "sftp";

  let form: ReactNode = null;
  if (fields && step === "form") {
    const cloud =
      activeKind === "gdrive" || activeKind === "dropbox" ? activeKind : null;
    const failingSftp =
      activeKind === "sftp" &&
      destination?.status === "failing" &&
      test.phase === "idle";
    form = (
      <div className="space-y-6">
        {failingSftp ? (
          <TestPanel
            test={test}
            draft={fields.draft}
            destination={destination}
          />
        ) : null}
        <FormSection title="Destination">
          <NameAndEnabled
            draft={fields.draft}
            onChange={fields.onChange}
            destination={fields.destination}
          />
          {activeKind === "local" ? (
            <LocalFields
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
            />
          ) : null}
          {activeKind === "s3" ? (
            <S3Fields
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
            />
          ) : null}
          {activeKind === "b2" ? (
            <B2Fields
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
            />
          ) : null}
          {activeKind === "sftp" ? (
            <SftpFields
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
            />
          ) : null}
          {cloud ? (
            <CloudFolderFields
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
              kind={cloud}
            />
          ) : null}
        </FormSection>
        {activeKind === "s3" ? (
          <FormSection
            title="Credentials"
            description="An API token with object read and write on this bucket only."
          >
            <S3Credentials
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
            />
          </FormSection>
        ) : null}
        {activeKind === "b2" ? (
          <FormSection
            title="Credentials"
            description="Create an application key restricted to this bucket, with read and write access. Crate never shows it again after saving."
          >
            <B2Credentials
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
            />
          </FormSection>
        ) : null}
        {activeKind === "sftp" ? (
          <FormSection
            title="SSH key"
            description="Generated by Crate (Ed25519). The private key is stored encrypted and only leaves the server in the recovery kit."
          >
            <SftpKey
              destination={destination}
              busy={busy}
              onForgetHostKey={() =>
                void patch(
                  { config: { known_hosts: "" } },
                  "Pinned host key forgotten",
                )
              }
            />
          </FormSection>
        ) : null}
        {cloud ? (
          <FormSection
            title={cloud === "gdrive" ? "OAuth client" : "Dropbox app"}
            description={
              cloud === "gdrive"
                ? "Crate requires the install's own client, with Admin's callback as a redirect URI; Google limits shared ones."
                : "Create an app in the Dropbox App Console with App folder access."
            }
          >
            <OAuthClientFields
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
              kind={cloud}
            />
          </FormSection>
        ) : null}
        {cloud ? (
          <FormSection title="Account">
            <ConnectBlock
              kind={cloud}
              destination={destination}
              busy={busy}
              onConnect={() => void connect()}
              onDisconnect={() =>
                void patch({ secrets: { token: null } }, "Disconnected")
              }
            />
            <PasteToken
              draft={fields.draft}
              onChange={fields.onChange}
              destination={fields.destination}
              kind={cloud}
              defaultOpen={!destination && cloud === "gdrive"}
            />
          </FormSection>
        ) : null}
        <FormSection title="Repository">
          <RepositoryPassword destination={destination} />
        </FormSection>
        {!failingSftp ? (
          <FormSection title="Test">
            <TestPanel
              test={test}
              draft={fields.draft}
              destination={destination}
            />
          </FormSection>
        ) : null}
      </div>
    );
  } else if (step === "form" && editing && !destination)
    form = (
      <p className="text-sm text-text-muted">
        This destination no longer exists.
      </p>
    );

  const body =
    step === "picker" ? (
      <ProviderPicker
        kind={kind}
        preset={preset}
        onKind={setKind}
        onPreset={setPreset}
      />
    ) : editing && destination ? (
      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList aria-label="Destination views">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">{form}</TabsContent>
        <TabsContent value="snapshots">
          {tab === "snapshots" ? (
            <SnapshotsTab destination={destination} />
          ) : null}
        </TabsContent>
      </Tabs>
    ) : (
      form
    );

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : close())}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <MonoLabel
            as="p"
            size="eyebrow"
            className="inline-flex items-center gap-2"
          >
            {step === "form" ? (
              <KindMark kind={activeKind} className="text-accent-action-hi" />
            ) : null}
            {step === "picker"
              ? "Backups"
              : `${editing ? "Edit destination" : "Add destination"} · ${KIND_LABEL[activeKind]}`}
          </MonoLabel>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="crate-overlay-body">
            {description}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-quiet p-4">
          {body}
        </div>
        <SheetFooter className="flex-row flex-wrap items-center justify-between">
          <div className="flex gap-2">
            {step === "form" && !editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("picker")}
              >
                Back
              </Button>
            ) : null}
            {editing && destination && tab === "settings" ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                Remove destination
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {step === "picker" ? (
              <>
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={proceed}
                  disabled={!providers.data}
                >
                  Continue
                </Button>
              </>
            ) : tab === "settings" && draft ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing || busy || !canProbe}
                  aria-busy={testing || undefined}
                  onClick={() => void runTest()}
                >
                  {testing ? "Testing" : "Test connection"}
                </Button>
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => void (destination ? save() : saveAndTest())}
                >
                  {destination ? "Save changes" : "Save destination"}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${destination?.name ?? "destination"}?`}
        description="Crate stops writing to it and forgets its credentials and repository password. The repository stays where it is; only a recovery kit downloaded before can open it."
        confirmLabel="Remove destination"
        tone="danger"
        pending={busy}
        onConfirm={remove}
      />
    </Sheet>
  );
}
