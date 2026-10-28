import { useTranslation } from "react-i18next";
import { AppMenuButton } from "@crate/ui/primitives/AppPopover";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { CRATE_ICON_SIZE, Power, Square } from "@crate/ui/icons";
import type {
  PlaybackTarget,
  PlaybackTargetGroup,
} from "../../lib/playback-target-data";
import { PlaybackTargetIcon } from "./PlaybackTargetIcon";

export interface PlaybackTargetPanelProps {
  groups: PlaybackTargetGroup[];
  loading: boolean;
  error: boolean;
  pendingTargetId: string | null;
  castAction: "disconnect" | "stop" | null;
  onRetry: () => void;
  onTarget: (target: PlaybackTarget) => void;
  onDisconnectCast: () => void;
  onStopCast: () => void;
}
const GROUP_KEYS: Record<string, string> = {
  local: "player.output.group.local",
  "google-cast": "player.output.group.cast",
  "native-output": "player.output.group.system",
  "crate-connect": "player.output.group.connect",
};
export function PlaybackTargetPanel({
  groups,
  loading,
  error,
  pendingTargetId,
  castAction,
  onRetry,
  onTarget,
  onDisconnectCast,
  onStopCast,
}: PlaybackTargetPanelProps) {
  const { t } = useTranslation();
  const busy = Boolean(pendingTargetId || castAction);
  const activeCast = groups.some((group) =>
    group.targets.some(
      (target) => target.kind === "google-cast" && target.active,
    ),
  );
  return (
    <div data-slot="playback-target-panel" className="grid min-w-0 gap-4 p-4">
      <MonoLabel as="h2" tone="accent">
        {t("player.output.label")}
      </MonoLabel>
      {loading ? (
        <LoadingState fullWidth label={t("player.output.loading")} />
      ) : error ? (
        <ErrorState
          message={t("player.output.loadFailed")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : (
        <>
          {groups.length === 0 ? (
            <EmptyState message={t("player.output.empty")} />
          ) : null}
          <div
            role="menu"
            aria-label={t("player.output.targets")}
            className="grid min-w-0 gap-4"
          >
            {groups.map((group) => (
              <FormField
                key={group.providerId}
                kind="group"
                label={
                  GROUP_KEYS[group.providerId]
                    ? t(GROUP_KEYS[group.providerId]!)
                    : group.label
                }
              >
                {(field) => (
                  <div {...field} role="group" className="min-w-0">
                    {group.targets.map((target) => (
                      <PlaybackTargetRow
                        key={target.id}
                        target={target}
                        busy={busy}
                        onSelect={onTarget}
                      />
                    ))}
                    {group.error ? (
                      <ErrorState
                        message={t("player.output.providerFailed")}
                        onRetry={busy ? undefined : onRetry}
                        retryLabel={t("common.retry")}
                      />
                    ) : null}
                  </div>
                )}
              </FormField>
            ))}
            {activeCast ? (
              <FormField kind="group" label={t("player.output.cast.session")}>
                {(field) => (
                  <div
                    {...field}
                    role="group"
                    className="border-t border-border-quiet pt-2"
                  >
                    <AppMenuButton
                      role="menuitem"
                      disabled={busy}
                      onClick={onDisconnectCast}
                      className="min-h-11 py-2"
                    >
                      <Power size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
                      <span className="grid min-w-0 gap-1">
                        <MonoLabel as="span" className="text-inherit">
                          {t("player.output.cast.disconnect")}
                        </MonoLabel>
                        <span className="text-xs text-text-muted">
                          {t("player.output.cast.disconnectDescription")}
                        </span>
                      </span>
                    </AppMenuButton>
                    <AppMenuButton
                      role="menuitem"
                      disabled={busy}
                      danger
                      onClick={onStopCast}
                      className="min-h-11 py-2"
                    >
                      <Square size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
                      <span className="grid min-w-0 gap-1">
                        <MonoLabel as="span" className="text-inherit">
                          {t("player.output.cast.stop")}
                        </MonoLabel>
                        <span className="text-xs text-text-muted">
                          {t("player.output.cast.stopDescription")}
                        </span>
                      </span>
                    </AppMenuButton>
                  </div>
                )}
              </FormField>
            ) : null}
          </div>
        </>
      )}
      {busy ? (
        <LoadingState fullWidth label={t("player.output.connecting")} />
      ) : null}
    </div>
  );
}
function PlaybackTargetRow({
  target,
  busy,
  onSelect,
}: {
  target: PlaybackTarget;
  busy: boolean;
  onSelect: (target: PlaybackTarget) => void;
}) {
  const { t } = useTranslation();
  const status = target.active
    ? t("player.output.badge.active")
    : !target.available
      ? t("player.output.badge.unavailable")
      : target.kind === "system-route"
        ? t("player.output.badge.system")
        : t("player.output.badge.ready");
  return (
    <AppMenuButton
      role="menuitemradio"
      aria-checked={target.active}
      aria-disabled={!target.available || busy}
      data-active={target.active || undefined}
      disabled={busy}
      onClick={() => onSelect(target)}
      className="min-h-11 items-start py-3"
    >
      <span aria-hidden="true" className="shrink-0 pt-0.5">
        <PlaybackTargetIcon target={target} />
      </span>
      <span className="grid min-w-0 flex-1 gap-2 wrap-anywhere">
        <MonoLabel as="span" className="text-inherit">
          {target.name}
        </MonoLabel>
        <StatusDot
          tone={target.active ? "on" : target.available ? "off" : "warn"}
          label={status}
        />
        {target.subtitle ? (
          <span className="text-xs text-text-muted">{target.subtitle}</span>
        ) : null}
        {!target.available &&
        target.unavailableReason &&
        target.unavailableReason !== target.subtitle ? (
          <span className="text-xs text-text-muted">
            {target.unavailableReason}
          </span>
        ) : null}
      </span>
    </AppMenuButton>
  );
}
