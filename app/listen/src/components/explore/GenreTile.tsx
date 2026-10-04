import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, ArrowRight, Tag } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { useEntityMenu } from "@crate/ui/domain/entity/useEntityMenu";
import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  buildGenreActions,
  shareGenre,
  startGenreRadio,
} from "@/components/actions/genre-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { cn } from "@/lib/utils";

export type GenreTileVariant = "room" | "related";

interface GenreTileProps {
  variant: GenreTileVariant;
  slug: string;
  name: string;
  kicker: string;
  detail?: string | null;
  imageCandidates: string[];
  placeholderIndex?: number;
  onOpen: () => void;
}

function useImageFallback(candidates: string[]) {
  const fingerprint = candidates.join("|");
  const [state, setState] = useState({ fingerprint, index: 0 });
  const index = state.fingerprint === fingerprint ? state.index : 0;
  const onError = useCallback(() => {
    setState((previous) => ({
      fingerprint,
      index: Math.min(
        (previous.fingerprint === fingerprint ? previous.index : 0) + 1,
        candidates.length,
      ),
    }));
  }, [candidates.length, fingerprint]);
  return { url: candidates[index] ?? null, onError };
}

export const GenreTile = memo(function GenreTile({
  variant,
  slug,
  name,
  kicker,
  detail,
  imageCandidates,
  placeholderIndex = 0,
  onOpen,
}: GenreTileProps) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const { url: coverUrl, onError } = useImageFallback(imageCandidates);
  const room = variant === "room";

  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  const getActions = useCallback(
    () =>
      buildGenreActions(
        {
          genre: { slug, name, imageUrl: coverUrl },
          onOpen: () => onOpenRef.current(),
          onStartRadio: () => startGenreRadio(slug, playAll, t),
          onShare: () => shareGenre({ slug, name, imageUrl: coverUrl }, t),
        },
        t,
      ),
    [coverUrl, name, playAll, slug, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: name,
      subtitle: t("genre.kind"),
      imageUrl: coverUrl,
      imageAlt: name,
      imageShape: "square",
      fallbackIcon: Tag,
    }),
    [coverUrl, name, t],
  );
  const actionMenu = useListenEntityMenu(getActions, header);
  const { controller, targetProps, menu } = useEntityMenu({
    actionMenu,
    getFallbackHeader: () => header,
  });

  return (
    <article
      className={cn(
        "item-action-target group relative isolate overflow-hidden text-left",
        room
          ? "explore-genre-card min-h-36 rounded-panel"
          : "explore-related-genre-card min-h-[132px] rounded-lg transition-[border-color,filter,transform] hover:-translate-y-px",
      )}
      data-variant={variant}
      {...targetProps}
    >
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading={room ? "lazy" : "eager"}
          onError={onError}
          className={cn(
            "absolute inset-0 -z-10 size-full object-cover saturate-125 transition duration-300",
            room
              ? "opacity-60 blur-[1px] group-hover:scale-[1.04] group-hover:opacity-70"
              : "scale-[1.04] opacity-35 group-hover:opacity-45",
          )}
        />
      ) : null}
      <div
        className={cn(
          "absolute inset-0 -z-10",
          room
            ? cn(
                "explore-genre-card-overlay opacity-80",
                coverUrl
                  ? "explore-genre-card-overlay-image"
                  : `explore-genre-card-overlay-placeholder explore-genre-card-overlay-position-${
                      placeholderIndex % 4
                    }`,
              )
            : "explore-related-genre-overlay",
        )}
      />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex size-full flex-col justify-between text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-action/60",
          room
            ? "min-h-36 gap-5 rounded-panel p-4"
            : "min-h-[132px] gap-4 rounded-lg p-3",
        )}
      >
        <span className="block pr-10">
          <span
            className={cn(
              "block text-xs uppercase",
              room
                ? "font-bold tracking-eyebrow text-accent-action/90"
                : "font-semibold tracking-kicker text-accent-action/85",
            )}
          >
            {kicker}
          </span>
          {room ? null : (
            <span className="mt-2 line-clamp-2 block text-sm font-semibold leading-5 text-text-primary">
              {name}
            </span>
          )}
        </span>
        {room ? (
          <span className="block">
            <span className="block text-lg font-black leading-none tracking-display text-text-primary">
              {name}
            </span>
            {detail ? (
              <span className="mt-2 line-clamp-2 block text-xs leading-5 text-text-primary/62">
                {detail}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-text-muted">{detail}</span>
            <ArrowRight
              size={CRATE_ICON_SIZE.xs}
              className="shrink-0 text-text-primary/35 transition group-hover:translate-x-0.5 group-hover:text-accent-action"
            />
          </span>
        )}
      </button>
      <ItemActionMenuButton
        buttonRef={controller.triggerRef}
        hasActions={controller.hasActions}
        onClick={controller.openFromTrigger}
        expanded={controller.open}
        title={t("actions.menu.more")}
        className="absolute right-2 top-2 z-20 size-8 opacity-75 transition-opacity hover:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
      />
      {menu}
    </article>
  );
});
