import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
export function PlayerQueueHeader({
  title,
  summary,
  source,
  closeLabel,
  onClose,
}: {
  title: string;
  summary: string;
  source?: string | null;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className="border-b border-border-quiet px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <MonoLabel as="h2">{title}</MonoLabel>
        <ActionButton label={closeLabel} onClick={onClose}>
          <X size={CRATE_ICON_SIZE.lg} />
        </ActionButton>
      </div>
      <p className="font-mono text-xs text-text-muted">{summary}</p>
      {source ? (
        <p className="mt-2 truncate text-xs text-text-subtle">{source}</p>
      ) : null}
    </header>
  );
}
