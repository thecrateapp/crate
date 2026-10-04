import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Calendar, Disc3 } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { EntityRow } from "@crate/ui/domain/entity";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import { buildReleaseActions } from "@/components/actions/show-actions";
import { CrateImage } from "@/components/artwork/CrateImage";

import { buildUpcomingEventRowModel } from "./upcoming-event-row-model";
import type { UpcomingItem } from "./upcoming-model";

function ReleaseArtwork({ coverUrl }: { coverUrl?: string }) {
  return (
    <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-quiet bg-text-primary/5 text-accent-action">
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <Disc3 size={24} />
      )}
    </span>
  );
}

export const ReleaseRow = memo(function ReleaseRow({
  item,
}: {
  item: UpcomingItem;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const model = buildUpcomingEventRowModel(item, i18n.language, t);
  const { albumPath, artistPath, countdown } = model;

  const getActions = useCallback(
    () => buildReleaseActions({ albumPath, artistPath }, { t, navigate }),
    [albumPath, artistPath, navigate, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: item.title,
      subtitle: item.artist,
      imageUrl: model.coverUrl ?? null,
      imageAlt: item.title,
      imageShape: "square",
      fallbackIcon: Disc3,
    }),
    [item.artist, item.title, model.coverUrl],
  );
  const actionMenu = useListenEntityMenu(getActions, header);

  return (
    <EntityRow
      title={item.title}
      subtitle={[item.artist, item.subtitle].filter(Boolean).join(" · ")}
      meta={
        <span className="inline-flex items-center gap-1.5 font-medium uppercase tracking-[0.16em] text-accent-action">
          <Disc3 size={11} />
          {model.badgeLabel}
        </span>
      }
      leading={<ReleaseArtwork coverUrl={model.coverUrl} />}
      href={albumPath ?? undefined}
      openLabel={t("common.openItem", { name: item.title })}
      trailing={
        <>
          {model.dateLabel ? (
            <span className="hidden items-center gap-2 rounded-lg border border-border-quiet bg-text-primary/[0.06] px-3 py-2 text-sm font-semibold text-accent-action sm:inline-flex">
              <Calendar size={14} />
              {model.dateLabel}
            </span>
          ) : null}
          {countdown ? (
            <span className="rounded-lg border border-accent-action/15 bg-accent-action/10 px-3 py-2 text-sm font-semibold text-accent-action">
              {countdown.unit === "hours"
                ? t("radar.show.time.hoursToGo", { count: countdown.value })
                : t("radar.show.time.daysToGo", { count: countdown.value })}
            </span>
          ) : null}
        </>
      }
      actionMenu={actionMenu}
      menuLabel={t("actions.menu.more")}
      classNames={{ title: "text-base font-extrabold" }}
      className="upcoming-event-row-atmosphere rounded-[12px] border border-accent-action/10 p-4 hover:border-accent-action/25"
    />
  );
});
