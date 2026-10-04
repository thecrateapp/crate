import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Play, Route } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { EntityRow } from "@crate/ui/domain/entity";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { useListenEntityMenu } from "@/components/actions/entity-menu";
import {
  buildPathActions,
  pathPagePath,
} from "@/components/actions/path-actions";
import type { PathSummary } from "@/pages/paths-model";

interface PathRowProps {
  path: PathSummary;
  onPlay: () => void;
  onDelete: () => void;
}

export const PathRow = memo(function PathRow({
  path,
  onPlay,
  onDelete,
}: PathRowProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const href = pathPagePath(path.id);
  const route = [
    path.origin.label,
    ...path.waypoints.map((w) => w.label),
    path.destination.label,
  ]
    .filter(Boolean)
    .join(" → ");

  const handlers = useRef({ onPlay, onDelete });
  useEffect(() => {
    handlers.current = { onPlay, onDelete };
  });
  const getActions = useCallback(
    () =>
      buildPathActions(
        {
          onPlay: () => handlers.current.onPlay(),
          onOpen: () => navigate(href),
          onDelete: () => handlers.current.onDelete(),
        },
        t,
      ),
    [href, navigate, t],
  );
  const header = useMemo<ContextMenuHeader>(
    () => ({
      type: "media",
      title: path.name,
      subtitle: route,
      imageUrl: null,
      imageAlt: path.name,
      imageShape: "square",
      fallbackIcon: Route,
    }),
    [path.name, route],
  );
  const actionMenu = useListenEntityMenu(getActions, header);

  return (
    <EntityRow
      title={path.name}
      subtitle={`${t("common.trackCountLabel", {
        count: path.track_count,
      })} · ${new Date(path.created_at).toLocaleDateString(i18n.language)}`}
      meta={route || undefined}
      leading={
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-action/10 text-accent-action">
          <Route size={16} />
        </span>
      }
      href={href}
      trailing={
        <IconButton
          tone="primary"
          label={t("player.play")}
          onClick={onPlay}
          className="size-9 bg-accent-action/15 hover:bg-accent-action/25 [&_svg:not([class*='size-'])]:size-3.5"
        >
          <Play size={CRATE_ICON_SIZE.xs} className="ml-0.5 fill-current" />
        </IconButton>
      }
      actionMenu={actionMenu}
      menuLabel={t("actions.menu.more")}
      className="border border-text-primary/6 bg-text-primary/[0.02] hover:border-accent-action/20"
    />
  );
});
