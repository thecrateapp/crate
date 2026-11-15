import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AppModal,
  ModalBody,
  ModalFooter,
} from "@crate/ui/primitives/AppModal";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { apiErrorText } from "@/lib/agent-plan-presentation";
import { api } from "@/lib/api";
import {
  BACKUPS_API,
  KIT_PASSPHRASE_MIN,
  KitDownloadError,
  downloadRecoveryKit,
  notifyBackupsChanged,
  type BackupOverview,
} from "@/lib/backups";

/** Shown until the kit is downloaded and the operator confirms it is stored (BG1-4). */
export function RecoveryKitWarning({
  kit,
  onDownload,
}: {
  kit: BackupOverview["kit"];
  onDownload: () => void;
}) {
  if (kit.saved || kit.total === 0) return null;
  const downloaded = Boolean(kit.downloaded_at);
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-md border border-state-warning/25 bg-state-warning/10 p-4 md:flex-row md:items-center md:justify-between md:p-5"
    >
      <div className="min-w-0 space-y-2">
        <StatusDot tone="warn" label="Recovery kit not saved" />
        <p className="text-sm text-text-primary">
          {kit.uncovered} of {kit.total} destination
          {kit.total === 1
            ? " has a repository password"
            : "s have repository passwords"}{" "}
          that exist only on this server. If the server is lost, those copies
          cannot be opened.
        </p>
        <p className="text-sm text-text-muted">
          {downloaded
            ? "A kit was downloaded but not confirmed as stored. Download a new one, keep it off this server and confirm it."
            : "Download the kit and keep it somewhere else: a password manager or a printed copy. It holds repository locations, passwords and restore steps, not the credentials key."}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" onClick={onDownload}>
          Download recovery kit
        </Button>
      </div>
    </div>
  );
}

type Step = "download" | "confirm";

/**
 * Download the kit behind the account password (D1), sealed with a passphrase
 * the operator chooses (age v1), then confirm "I stored it" (BG1-4).
 */
export function RecoveryKitDialog({
  open,
  destinationCount,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  destinationCount: number;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [step, setStep] = useState<Step>("download");
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");

  function reset() {
    setStep("download");
    setPassword("");
    setPassphrase("");
    setRepeat("");
    setPasswordError(null);
    setPassphraseError(null);
    setFormError(null);
    setBusy(false);
    setFilename("");
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  const repeatError =
    repeat && repeat !== passphrase ? "The passphrases do not match." : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setFormError(null);
    if (passphrase.length < KIT_PASSPHRASE_MIN) {
      setPassphraseError(
        `The kit passphrase needs ${KIT_PASSPHRASE_MIN} characters or more.`,
      );
      return;
    }
    setPassphraseError(null);
    if (repeat !== passphrase) return;
    setBusy(true);
    try {
      const name = await downloadRecoveryKit(password, passphrase);
      setFilename(name);
      setPassword("");
      setPassphrase("");
      setRepeat("");
      setStep("confirm");
      notifyBackupsChanged();
    } catch (error) {
      if (error instanceof KitDownloadError && error.status === 403)
        setPasswordError("The password is not correct.");
      else if (error instanceof KitDownloadError && error.status === 400)
        setPassphraseError(error.message);
      else if (error instanceof KitDownloadError && error.status === 409)
        setFormError(
          "This account has no password. Set one in your profile to download the kit.",
        );
      else
        setFormError(
          error instanceof Error
            ? error.message
            : "The recovery kit could not be downloaded",
        );
    } finally {
      setBusy(false);
    }
  }

  async function confirmStored() {
    setBusy(true);
    try {
      await api(`${BACKUPS_API}/recovery-kit/confirm`, "POST");
      toast.success("Recovery kit confirmed as stored");
      notifyBackupsChanged();
      reset();
      onConfirmed();
    } catch (error) {
      toast.error(apiErrorText(error, "The confirmation failed"));
      setBusy(false);
    }
  }

  return (
    <AppModal
      open={open}
      onClose={close}
      size="sm"
      eyebrow="Backups"
      title={step === "download" ? "Download recovery kit" : "Store the kit"}
      description={
        step === "download"
          ? "Confirm your account password. Every download is recorded in the audit log."
          : "The warning stays until you confirm the kit is stored off this server."
      }
      closeDisabled={busy}
    >
      {step === "download" ? (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <ModalBody>
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-2 rounded-md border border-border-quiet p-4">
                <MonoLabel as="p">The kit holds</MonoLabel>
                <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                  <li>
                    Location and repository password of all {destinationCount}{" "}
                    destination{destinationCount === 1 ? "" : "s"}, the SFTP key
                    included
                  </li>
                  <li>Restore steps with restic and pg_restore</li>
                  <li>The fingerprint of CRATE_CREDENTIAL_KEY, not the key</li>
                </ul>
              </div>
              <p className="text-sm text-state-warning-text">
                Anyone with this file and its passphrase can read your backups.
                Keep it off this server.
              </p>
              <FormField label="Account password" error={passwordError}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </FormField>
              <FormField
                label="Kit passphrase"
                hint={`${KIT_PASSPHRASE_MIN} characters or more. Crate never stores it.`}
                error={passphraseError}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Repeat the passphrase" error={repeatError}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
                  required
                />
              </FormField>
              <p className="text-xs text-text-muted">
                The file is crate-recovery-kit-YYYYMMDD.md.age, encrypted with
                age: open it with <code className="font-mono">age -d</code> and
                the passphrase.
              </p>
              {formError ? (
                <p role="alert" className="text-sm text-state-warning-text">
                  {formError}
                </p>
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !password || !passphrase || !repeat}
              aria-busy={busy || undefined}
            >
              {busy ? "Preparing kit" : "Download kit"}
            </Button>
          </ModalFooter>
        </form>
      ) : (
        <>
          <ModalBody>
            <div className="space-y-4 px-5 py-4">
              <div className="space-y-2 rounded-md border border-border-quiet bg-raised-surface p-4">
                <StatusDot tone="on" label="Kit downloaded" />
                <p className="break-all font-mono text-sm text-text-primary">
                  {filename}
                </p>
              </div>
              <p className="text-sm text-text-secondary">
                Move the file somewhere off this server, such as a password
                manager or another computer, and keep its passphrase apart from
                it. Then confirm.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={busy}
            >
              Later
            </Button>
            <Button
              type="button"
              onClick={() => void confirmStored()}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              I stored it
            </Button>
          </ModalFooter>
        </>
      )}
    </AppModal>
  );
}
