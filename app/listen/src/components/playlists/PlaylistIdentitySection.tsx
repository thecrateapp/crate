import type { ComponentProps } from "react";
import { PlaylistArtwork } from "./PlaylistArtwork";
import { PlaylistIdentityView } from "./PlaylistIdentityView";
export function PlaylistIdentitySection(
  props: Omit<ComponentProps<typeof PlaylistIdentityView>, "artwork">,
) {
  return (
    <PlaylistIdentityView
      {...props}
      artwork={
        <PlaylistArtwork
          name={props.state.name || props.t("playlistComposer.newPlaylist")}
          coverDataUrl={props.state.coverDataUrl}
          tracks={props.state.tracks}
          className="size-24 sm:size-28"
        />
      }
    />
  );
}
