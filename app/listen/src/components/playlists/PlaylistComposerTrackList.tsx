import { CrateImage } from "../artwork/CrateImage";
import { PlaylistComposerTrackListView } from "./PlaylistComposerTrackListView";
export function PlaylistComposerTrackList(
  props: Omit<
    Parameters<typeof PlaylistComposerTrackListView>[0],
    "renderImage"
  >,
) {
  return (
    <PlaylistComposerTrackListView
      {...props}
      renderImage={(image) => (
        <CrateImage
          src={image.src}
          alt={image.alt}
          className={image.className}
          loading="lazy"
          onError={image.onError}
        />
      )}
    />
  );
}
