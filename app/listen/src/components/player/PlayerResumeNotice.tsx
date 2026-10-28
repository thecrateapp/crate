import { Button } from "@crate/ui/shadcn/button";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
/** Local and remote resume use canonical actions on an opaque notice surface. */
export function PlayerResumeNotice({
  message,
  detail,
  actionLabel,
  secondaryLabel,
  dismissLabel,
  onContinue,
  onDismiss,
  busy = false,
}: {
  message: string;
  detail: string;
  actionLabel: string;
  secondaryLabel?: string;
  dismissLabel: string;
  onContinue: () => void;
  onDismiss: () => void;
  busy?: boolean;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-panel border border-border-subtle bg-surface-overlay p-4"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{message}</p>
        <p className="mt-2 truncate font-mono text-xs text-text-muted">
          {detail}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onContinue} disabled={busy}>
            {actionLabel}
          </Button>
          {secondaryLabel ? (
            <Button variant="ghost" onClick={onDismiss}>
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
      <ActionButton label={dismissLabel} onClick={onDismiss}>
        <X size={CRATE_ICON_SIZE.lg} />
      </ActionButton>
    </div>
  );
}
