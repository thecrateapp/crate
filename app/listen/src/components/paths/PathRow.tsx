import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { CRATE_ICON_SIZE, Route } from "@crate/ui/icons";

import type { ContextMenuHeader } from "@crate/ui/domain/actions";
import { EntityRow } from "@crate/ui/domain/entity";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
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
      subtitle={
        <MonoLabel
          as="span"
          meta={[
            t("common.trackCountLabel", { count: path.track_count }),
            new Date(path.created_at).toLocaleDateString(i18n.language),
          ]}
        />
      }
      meta={<MonoLabel as="span">{route}</MonoLabel>}
      leading={
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-action/10 text-accent-action">
          <Route size={CRATE_ICON_SIZE.sm} />
        </span>
      }
      href={href}
      trailing={
        <PlayButton size="sm" label={t("player.play")} onClick={onPlay} />
      }
      actionMenu={actionMenu}
      menuLabel={t("actions.menu.more")}
    />
  );
});
