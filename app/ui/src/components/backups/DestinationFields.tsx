// Provider-specific sections of the add/edit destination drawer (mockups 2b-2h).
import { useEffect, useId, useState, type ReactNode } from "react";

import { ChevronDown, ChevronRight } from "@crate/ui/icons";
import { FormField } from "@crate/ui/primitives/FormField";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import { AdminSelect } from "@/components/ui/AdminSelect";
import {
  S3_PRESETS,
  formatAgo,
  formatDay,
  rcloneDriveAuthorizeCommand,
  rcloneDropboxAuthorizeCommand,
  type BackupDestination,
} from "@/lib/backups";
import { cn } from "@/lib/utils";

import { CopyAction, SecretField } from "./backup-ui";
import type { DestinationDraft } from "./destination-form";

export interface FieldsProps {
  draft: DestinationDraft;
  onChange: (draft: DestinationDraft) => void;
  destination: BackupDestination | null;
}

function setConfig(props: FieldsProps, name: string, value: string) {
  props.onChange({
    ...props.draft,
    config: { ...props.draft.config, [name]: value },
  });
}

function setSecret(props: FieldsProps, name: string, value: string) {
  props.onChange({
    ...props.draft,
    secrets: { ...props.draft.secrets, [name]: value },
  });
}

function savedText(destination: BackupDestination | null) {
  const at = destination?.updated_at ?? destination?.created_at;
  return at
    ? `${formatDay(at)} · never shown again`
    : "Write-only. Never shown again.";
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 border-t border-border-quiet pt-5 first:border-t-0 first:pt-0"
    >
      <div className="space-y-1">
        <MonoLabel as="h3" tone="accent" id={headingId}>
          {title}
        </MonoLabel>
        {description ? (
          <p className="text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function TextField({
  props,
  name,
  label,
  hint,
  placeholder,
  mono = true,
  type,
}: {
  props: FieldsProps;
  name: string;
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <FormField label={label} hint={hint}>
      <Input
        className={mono ? "font-mono" : undefined}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        value={props.draft.config[name] ?? ""}
        onChange={(event) => setConfig(props, name, event.target.value)}
      />
    </FormField>
  );
}

/** Name and the enabled switch, which stays off until a test passes (BG1-11). */
export function NameAndEnabled(props: FieldsProps) {
  const { draft, onChange, destination } = props;
  const tested = Boolean(destination?.repository_initialized_at);
  const toggle = (
    <Switch
      checked={draft.enabled}
      disabled={!tested}
      onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
      aria-label="Enabled"
    />
  );
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <FormField label="Name">
        <Input
          value={draft.name}
          autoComplete="off"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </FormField>
      <div className="flex min-h-10 items-center gap-3">
        {tested ? (
          toggle
        ) : (
          <TooltipHint content="The first passing test enables it">
            <span className="inline-flex" tabIndex={0}>
              {toggle}
            </span>
          </TooltipHint>
        )}
        <span className="text-sm text-text-secondary">Enabled</span>
      </div>
    </div>
  );
}

export function LocalFields(props: FieldsProps) {
  return (
    <>
      <FormField
        label="Folder"
        hint="Relative to the backup volume. Crate creates it if it does not exist."
      >
        {(control) => (
          <div className="flex min-w-0 items-stretch">
            <span
              aria-hidden="true"
              className="flex items-center rounded-l-md border border-r-0 border-border-quiet bg-surface-control px-3 font-mono text-sm text-text-subtle"
            >
              /backups/
            </span>
            <Input
              id={control.id}
              aria-labelledby={control["aria-labelledby"]}
              aria-describedby={control["aria-describedby"]}
              className="rounded-l-none font-mono"
              spellCheck={false}
              autoComplete="off"
              value={props.draft.config.path ?? ""}
              onChange={(event) => setConfig(props, "path", event.target.value)}
            />
          </div>
        )}
      </FormField>
      <p className="text-sm text-state-warning-text">
        This volume is on the same server as the database. It protects against
        mistakes and bad upgrades, not against losing the server: pair it with
        an off-site destination.
      </p>
    </>
  );
}

export function S3Fields(props: FieldsProps) {
  const { draft, onChange } = props;
  const preset =
    S3_PRESETS.find((p) => p.id === draft.preset) ??
    S3_PRESETS[S3_PRESETS.length - 1]!;
  function choosePreset(id: string) {
    const next = S3_PRESETS.find((p) => p.id === id);
    if (!next) return;
    const templates = S3_PRESETS.map((p) => p.endpoint);
    const endpoint = draft.config.endpoint ?? "";
    const keepEndpoint = endpoint && !templates.includes(endpoint);
    const named =
      S3_PRESETS.some((p) => p.label === draft.name) ||
      draft.name === "S3-compatible";
    onChange({
      ...draft,
      preset: id,
      name: named && id !== "other" ? next.label : draft.name,
      config: {
        ...draft.config,
        endpoint: keepEndpoint
          ? endpoint
          : next.endpoint.includes("<")
            ? ""
            : next.endpoint,
        region: next.region,
        bucket_lookup: next.bucketLookup,
      },
    });
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        label="Preset"
        hint="Fills the endpoint format, region and bucket lookup."
      >
        {(control) => (
          <AdminSelect
            id={control.id}
            aria-labelledby={control["aria-labelledby"]}
            aria-describedby={control["aria-describedby"]}
            triggerClassName="w-full max-w-none"
            value={draft.preset}
            onChange={choosePreset}
            placeholder="Preset"
            allowClear={false}
            options={S3_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        )}
      </FormField>
      <TextField
        props={props}
        name="endpoint"
        label="Endpoint"
        hint={preset.endpointHint}
        placeholder="https://"
      />
      <TextField
        props={props}
        name="bucket"
        label="Bucket"
        placeholder="crate-backups"
      />
      <TextField
        props={props}
        name="prefix"
        label="Folder in the bucket"
        hint="Optional prefix."
        placeholder="db"
      />
      <TextField
        props={props}
        name="region"
        label="Region"
        hint={preset.regionHint ?? "Leave empty when the provider has none."}
      />
      <FormField
        label="Bucket lookup"
        hint="Auto works for most providers; MinIO often needs path."
        kind="group"
      >
        {(control) => (
          <SegmentedControl
            id={control.id}
            aria-describedby={control["aria-describedby"]}
            as="radio"
            label="Bucket lookup"
            value={
              (draft.config.bucket_lookup || "auto") as "auto" | "dns" | "path"
            }
            onValueChange={(value) => setConfig(props, "bucket_lookup", value)}
            items={[
              { value: "auto", label: "Auto" },
              { value: "dns", label: "DNS" },
              { value: "path", label: "Path" },
            ]}
          />
        )}
      </FormField>
    </div>
  );
}

export function S3Credentials(props: FieldsProps) {
  const set = props.destination?.secrets_set ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SecretField
        label="Access key ID"
        saved={set.includes("access_key_id")}
        savedText={savedText(props.destination)}
        value={props.draft.secrets.access_key_id ?? ""}
        onChange={(value) => setSecret(props, "access_key_id", value)}
      />
      <SecretField
        label="Secret access key"
        saved={set.includes("secret_access_key")}
        savedText={savedText(props.destination)}
        value={props.draft.secrets.secret_access_key ?? ""}
        onChange={(value) => setSecret(props, "secret_access_key", value)}
      />
    </div>
  );
}

export function B2Fields(props: FieldsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        props={props}
        name="bucket"
        label="Bucket"
        placeholder="crate-backups"
      />
      <TextField
        props={props}
        name="prefix"
        label="Folder in the bucket"
        hint="Optional prefix."
        placeholder="db"
      />
    </div>
  );
}

export function B2Credentials(props: FieldsProps) {
  const set = props.destination?.secrets_set ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SecretField
        label="Application key ID"
        saved={set.includes("key_id")}
        savedText={savedText(props.destination)}
        placeholder="005a1b2c3d4e5f60000000001"
        value={props.draft.secrets.key_id ?? ""}
        onChange={(value) => setSecret(props, "key_id", value)}
      />
      <SecretField
        label="Application key"
        saved={set.includes("application_key")}
        savedText={savedText(props.destination)}
        placeholder="K005…"
        value={props.draft.secrets.application_key ?? ""}
        onChange={(value) => setSecret(props, "application_key", value)}
      />
    </div>
  );
}

export function SftpFields(props: FieldsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <TextField
        props={props}
        name="host"
        label="Host"
        placeholder="u123456.your-storagebox.de"
      />
      <TextField
        props={props}
        name="port"
        label="Port"
        type="number"
        hint="Storage Boxes serve SFTP on 23."
      />
      <TextField props={props} name="user" label="User" />
      <TextField
        props={props}
        name="path"
        label="Folder on the server"
        placeholder="crate/restic"
      />
    </div>
  );
}

const KEY_TYPES: Record<string, string> = {
  "ssh-ed25519": "ED25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA",
  "ecdsa-sha2-nistp384": "ECDSA",
  "ecdsa-sha2-nistp521": "ECDSA",
};

/** "ED25519 SHA256:…" as ssh-keygen -l prints it, from a known_hosts line. */
export function useHostKeyFingerprint(knownHosts: string): string {
  const [fingerprint, setFingerprint] = useState("");
  const line = knownHosts.split("\n").find((l) => l.trim()) ?? "";
  const [, type = "", key = ""] = line.trim().split(/\s+/);
  useEffect(() => {
    let cancelled = false;
    const label = KEY_TYPES[type] ?? type.toUpperCase();
    async function run() {
      try {
        const bytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", bytes),
        );
        let binary = "";
        for (const byte of digest) binary += String.fromCharCode(byte);
        if (!cancelled)
          setFingerprint(`${label} SHA256:${btoa(binary).replace(/=+$/, "")}`);
      } catch {
        if (!cancelled) setFingerprint(`${label} ${key.slice(0, 24)}…`);
      }
    }
    if (key) void run();
    else setFingerprint("");
    return () => {
      cancelled = true;
    };
  }, [type, key]);
  return fingerprint;
}

export function SftpKey({
  destination,
  busy,
  onForgetHostKey,
}: {
  destination: BackupDestination | null;
  busy: boolean;
  onForgetHostKey: () => void;
}) {
  const publicKey = String(destination?.config.public_key ?? "");
  const knownHosts = String(destination?.config.known_hosts ?? "");
  const fingerprint = useHostKeyFingerprint(knownHosts);
  if (!destination)
    return (
      <p className="rounded-md border border-dashed border-border-quiet px-4 py-3 text-sm text-text-secondary">
        Crate generates an Ed25519 key pair when you save. Install its public
        key on the server, then test the connection.
      </p>
    );
  return (
    <>
      <FormField
        label="Public key"
        hint="Add this line to .ssh/authorized_keys on the server, for example with Hetzner's install-ssh-key."
        kind="group"
      >
        {(control) => (
          <div
            id={control.id}
            role="group"
            aria-labelledby={control["aria-labelledby"]}
            aria-describedby={control["aria-describedby"]}
            className="flex min-w-0 items-start gap-2"
          >
            <code className="min-w-0 flex-1 break-all rounded-md border border-border-quiet bg-surface-control px-3 py-2.5 font-mono text-label text-text-primary">
              {publicKey}
            </code>
            <CopyAction value={publicKey} label="Copy public key" />
          </div>
        )}
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-quiet px-4 py-3">
        <div className="min-w-0 space-y-1">
          <MonoLabel as="p">Pinned host key</MonoLabel>
          {knownHosts ? (
            <>
              <p className="break-all font-mono text-sm text-text-primary">
                {fingerprint}
              </p>
              <p className="text-xs text-text-muted">
                Pinned at the first test. A different key stops every copy.
              </p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              None yet. The next test learns the server's key and pins it.
            </p>
          )}
        </div>
        {knownHosts ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onForgetHostKey}
          >
            Forget pinned key
          </Button>
        ) : null}
      </div>
    </>
  );
}

type CloudKind = "gdrive" | "dropbox";

export function CloudFolderFields(props: FieldsProps & { kind: CloudKind }) {
  if (props.kind === "dropbox")
    return (
      <TextField
        props={props}
        name="path"
        label="Folder"
        hint="Inside the app folder. Created on the first copy."
      />
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        props={props}
        name="path"
        label="Folder"
        hint="Created on the first copy."
      />
      <TextField
        props={props}
        name="root_folder_id"
        label="Root folder ID"
        hint="Optional. Put the folder under a specific Drive folder or shared drive."
        placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
      />
    </div>
  );
}

export function OAuthClientFields(props: FieldsProps & { kind: CloudKind }) {
  const drive = props.kind === "gdrive";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        props={props}
        name="client_id"
        label={drive ? "OAuth client ID" : "App key"}
        hint={
          drive
            ? "From your own Google Cloud project (Web application client). Crate requires the install's own client."
            : "From your own Dropbox app, with App folder access."
        }
        placeholder={
          drive
            ? "123456789012-abc….apps.googleusercontent.com"
            : "a1b2c3d4e5f6g7h"
        }
      />
      <SecretField
        label={drive ? "OAuth client secret" : "App secret"}
        saved={Boolean(
          props.destination?.secrets_set.includes("client_secret"),
        )}
        savedText={savedText(props.destination)}
        placeholder="Write-only"
        value={props.draft.secrets.client_secret ?? ""}
        onChange={(value) => setSecret(props, "client_secret", value)}
      />
    </div>
  );
}

export function ConnectBlock({
  kind,
  destination,
  busy,
  onConnect,
  onDisconnect,
}: {
  kind: CloudKind;
  destination: BackupDestination | null;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const provider = kind === "gdrive" ? "Google Drive" : "Dropbox";
  const connected = Boolean(destination?.secrets_set.includes("token"));
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-md border px-4 py-4",
        connected
          ? "border-border-quiet bg-raised-surface"
          : "border-dashed border-border-quiet",
      )}
    >
      <div className="min-w-0 space-y-1">
        <StatusDot
          tone={connected ? "on" : "off"}
          label={connected ? "Connected" : "Not connected"}
        />
        <p className="text-sm text-text-secondary">
          {connected
            ? kind === "gdrive"
              ? `Token saved${
                  destination?.last_checked_at
                    ? `, checked ${formatAgo(destination.last_checked_at)}`
                    : ""
                } · scope drive.file · Crate sees only the files it created.`
              : "Token saved · App folder access."
            : kind === "gdrive"
              ? "Opens Google's consent screen and returns here. Scope: drive.file."
              : "Opens Dropbox's consent screen and returns here."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {connected ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onConnect}
            >
              Reconnect
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button type="button" disabled={busy} onClick={onConnect}>
            {`Connect ${provider}`}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The no-browser path: run rclone authorize elsewhere with the same client and
 * paste the token (BG1-10). The command is built here from what was typed; the
 * secret never goes to the server for it.
 */
export function PasteToken(
  props: FieldsProps & { kind: CloudKind; defaultOpen?: boolean },
) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const panelId = useId();
  const clientId = (props.draft.config.client_id ?? "").trim();
  const clientSecret = (props.draft.secrets.client_secret ?? "").trim();
  const ready = Boolean(clientId && clientSecret);
  const command = ready
    ? props.kind === "gdrive"
      ? rcloneDriveAuthorizeCommand(clientId, clientSecret)
      : rcloneDropboxAuthorizeCommand(clientId, clientSecret)
    : `rclone authorize ${props.kind === "gdrive" ? "drive" : "dropbox"} "<blob>"`;
  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 items-center gap-1 text-text-muted hover:text-text-primary"
      >
        {open ? (
          <ChevronDown
            data-admin-ux="backups-paste-token-collapse"
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            data-admin-ux="backups-paste-token-expand"
            aria-hidden="true"
          />
        )}
        No browser on this network? Paste a token from rclone authorize
      </button>
      {open ? (
        <div
          id={panelId}
          className="mt-2 space-y-4 border-l border-border-quiet pl-4"
        >
          <p className="text-sm text-text-muted">
            On a computer with a browser, run the command below, approve access,
            then paste the JSON token it prints.
            {props.kind === "gdrive"
              ? " The client needs http://127.0.0.1:53682/ as a redirect URI."
              : null}
          </p>
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-quiet bg-surface-control px-3 py-1">
            <code className="min-w-0 flex-1 truncate font-mono text-label text-text-primary">
              {command}
            </code>
            {ready ? <CopyAction value={command} label="Copy command" /> : null}
          </div>
          {!ready ? (
            <p className="text-xs text-text-muted">
              Type the client ID and secret above to build the command; the
              secret is needed again because Crate never shows the saved one.
            </p>
          ) : null}
          <FormField
            label="Token"
            hint="Stored encrypted, like the other secrets. Saved with the destination."
          >
            <Textarea
              rows={3}
              className="font-mono text-label"
              spellCheck={false}
              placeholder='{"access_token":"…","token_type":"Bearer","refresh_token":"…","expiry":"…"}'
              value={props.draft.secrets.token ?? ""}
              onChange={(event) =>
                setSecret(props, "token", event.target.value)
              }
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
}

export function RepositoryPassword({
  destination,
}: {
  destination: BackupDestination | null;
}) {
  const kitSaved = Boolean(destination?.recovery_kit_confirmed_at);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-quiet px-4 py-3">
      <div className="min-w-0 space-y-1">
        <MonoLabel as="p">Repository password</MonoLabel>
        <p className="text-sm text-text-secondary">
          {destination
            ? `Generated by Crate on ${formatDay(destination.created_at)}. Stored encrypted; only the recovery kit contains it.`
            : "Crate generates it when you save. Download the recovery kit afterwards: it is the only copy outside this server."}
        </p>
      </div>
      {destination ? (
        <InfoBadge tone={kitSaved ? "accent" : "warning"}>
          {kitSaved ? "In the kit" : "Kit not saved"}
        </InfoBadge>
      ) : (
        <InfoBadge>Generated on save</InfoBadge>
      )}
    </div>
  );
}
