import { useTranslation } from "react-i18next";
import { EntityRow } from "@crate/ui/domain/entity";
import { EmptyState } from "@crate/ui/domain/states";
import {
  MediaCover,
  type MediaCoverProps,
} from "@crate/ui/domain/media/MediaCover";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { CRATE_ICON_SIZE, HardDrive } from "@crate/ui/icons";
import { offlineItemArtworkPath } from "../../lib/offline-artwork-identity";
import { formatBytes } from "../../lib/utils";
import type { OfflineItemRecord } from "../../lib/offline-model";

/** Snapshot presentation only. Storage, transfer scheduling and global actions stay in OfflineSection. */
export function OfflineDownloadsView({
  items,
  renderImage,
}: {
  items: OfflineItemRecord[];
  renderImage?: MediaCoverProps["renderImage"];
}) {
  const { t } = useTranslation();
  return (
    <FormField kind="group" label={t("settings.offline.downloadsTitle")}>
      {(group) => (
        <div
          {...group}
          role="group"
          className="min-w-0 divide-y divide-border-quiet"
        >
          {items.length ? (
            items.map((item) => {
              const active = ["queued", "downloading", "syncing"].includes(
                item.state,
              );
              const knownTotal =
                Number.isFinite(item.trackCount) && item.trackCount > 0;
              const knownReady =
                Number.isFinite(item.readyTrackCount) &&
                item.readyTrackCount >= 0;
              const progressText =
                knownTotal && knownReady
                  ? t("settings.offline.trackProgress", {
                      ready: item.readyTrackCount,
                      total: item.trackCount,
                    })
                  : undefined;
              // Before the first manifest, the runtime uses 0 as an unknown-size sentinel.
              const bytes =
                item.totalBytes != null &&
                Number.isFinite(item.totalBytes) &&
                item.totalBytes >= 0 &&
                (item.totalBytes > 0 || Boolean(item.contentVersion))
                  ? formatBytes(item.totalBytes)
                  : null;
              return (
                <div key={item.key} className="grid min-w-0 gap-2 pb-3">
                  <EntityRow
                    title={item.title}
                    aria-label={item.title}
                    truncate={false}
                    menuButton="none"
                    leading={
                      <MediaCover
                        src={offlineItemArtworkPath(item)}
                        renderImage={renderImage}
                        alt=""
                        className="size-12 shrink-0"
                        fallback={<HardDrive size={CRATE_ICON_SIZE.md} />}
                      />
                    }
                    subtitle={
                      <MonoLabel
                        as="span"
                        meta={[
                          t(`settings.offline.kind.${item.kind}`),
                          bytes
                            ? t("settings.offline.totalSize", { size: bytes })
                            : null,
                        ]}
                      />
                    }
                    meta={
                      <StatusDot
                        tone={
                          item.state === "error"
                            ? "warn"
                            : item.state === "ready"
                              ? "on"
                              : "off"
                        }
                        pulse={active}
                        label={t(`settings.offline.state.${item.state}`)}
                      />
                    }
                  />
                  {progressText ? (
                    <MonoLabel as="p">{progressText}</MonoLabel>
                  ) : null}
                  {active ? (
                    <ProgressHairline
                      label={item.title}
                      value={
                        knownTotal && knownReady
                          ? item.readyTrackCount / item.trackCount
                          : undefined
                      }
                      valueText={progressText}
                    />
                  ) : null}
                </div>
              );
            })
          ) : (
            <EmptyState
              variant="dashed"
              message={t("settings.offline.downloadsEmpty")}
            />
          )}
        </div>
      )}
    </FormField>
  );
}
