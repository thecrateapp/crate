import { CRATE_ICON_SIZE, ListMusic } from "@crate/ui/icons";
import {
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ImgHTMLAttributes,
  type Key,
  type ReactNode,
} from "react";

export interface PlaylistArtworkTrack {
  artist?: string;
  artist_id?: number;
  global_artist_uid?: string;
  artist_entity_uid?: string;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  global_album_uid?: string;
  album_entity_uid?: string;
  album_slug?: string;
}

export interface PlaylistArtworkImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  key?: Key;
}

export interface PlaylistArtworkProps extends Omit<
  ComponentPropsWithRef<"div">,
  "children"
> {
  name?: string;
  coverDataUrl?: string | null;
  tracks?: PlaylistArtworkTrack[];
  className?: string;
  showCrateMark?: boolean;
  showFallbackIcon?: boolean;
  crateMarkClassName?: string;
  logoSrc?: string;
  buildCoverUrl: (track: PlaylistArtworkTrack) => string | null;
  renderImage?: (props: PlaylistArtworkImageProps) => ReactNode;
}

function playlistGradientHues(name: string): { hue1: number; hue2: number } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 44) % 360;
  return { hue1, hue2 };
}

function CrateMark({
  logoSrc,
  className = "",
}: {
  logoSrc: string;
  className?: string;
}) {
  return (
    <div
      className={`absolute right-2.5 top-2.5 flex items-center justify-center ${className}`}
    >
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className=" size-4 opacity-95 drop-shadow-artwork-compact-mark"
      />
    </div>
  );
}

export function PlaylistArtwork({
  name = "Playlist",
  coverDataUrl,
  tracks = [],
  className = "",
  showCrateMark = false,
  showFallbackIcon = true,
  crateMarkClassName,
  logoSrc = "/icons/logo.svg",
  buildCoverUrl,
  renderImage,
  ...props
}: PlaylistArtworkProps) {
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const usableCover =
    coverDataUrl && !failedSources.has(coverDataUrl) ? coverDataUrl : null;
  const collageSources: string[] = [];
  const collageSourceSet = new Set<string>();
  for (const track of tracks) {
    const source = buildCoverUrl(track);
    if (source && !failedSources.has(source) && !collageSourceSet.has(source)) {
      collageSources.push(source);
      collageSourceSet.add(source);
    }
    if (collageSources.length >= 4) break;
  }

  const crateMark = showCrateMark ? (
    <CrateMark logoSrc={logoSrc} className={crateMarkClassName} />
  ) : null;
  const artworkImage = (props: PlaylistArtworkImageProps) => {
    if (renderImage) return renderImage(props);
    const { key, ...imageProps } = props;
    return (
      <img
        key={key}
        {...imageProps}
        onError={() => {
          const source = imageProps.src;
          if (typeof source === "string")
            setFailedSources((current) => new Set([...current, source]));
        }}
      />
    );
  };

  if (usableCover) {
    return (
      <div
        {...props}
        data-slot="playlist-artwork"
        data-layout="cover"
        className={`relative overflow-hidden bg-text-primary/5 ${className}`}
      >
        {artworkImage({
          src: usableCover,
          alt: name,
          className: "size-full object-cover",
        })}
        {crateMark}
      </div>
    );
  }

  if (collageSources.length > 0) {
    if (collageSources.length === 1) {
      return (
        <div
          {...props}
          data-slot="playlist-artwork"
          data-layout="single"
          className={`relative overflow-hidden bg-text-primary/5 ${className}`}
        >
          {artworkImage({
            src: collageSources[0],
            alt: name,
            className: "size-full object-cover",
          })}
          {crateMark}
        </div>
      );
    }

    const collageClassName =
      collageSources.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

    return (
      <div
        role={name ? "img" : undefined}
        aria-label={name || undefined}
        {...props}
        data-slot="playlist-artwork"
        data-layout="collage"
        className={`relative overflow-hidden bg-text-primary/5 ${className}`}
      >
        <div className={`grid size-full ${collageClassName} gap-[2px]`}>
          {collageSources.map((source, index) =>
            artworkImage({
              key: `${source}-${index}`,
              src: source,
              alt: "",
              className: `size-full object-cover ${
                collageSources.length === 3 && index === 2 ? "col-span-2" : ""
              }`,
            }),
          )}
        </div>
        {crateMark}
      </div>
    );
  }

  const { hue1, hue2 } = playlistGradientHues(name);

  return (
    <div
      role={name ? "img" : undefined}
      aria-label={name || undefined}
      {...props}
      data-slot="playlist-artwork"
      data-layout="placeholder"
      className={`playlist-artwork-placeholder relative flex items-center justify-center overflow-hidden ${className}`}
      style={
        {
          ...props.style,
          "--playlist-artwork-hue-1": String(hue1),
          "--playlist-artwork-hue-2": String(hue2),
        } as CSSProperties
      }
    >
      {showFallbackIcon ? (
        <ListMusic
          aria-hidden="true"
          size={CRATE_ICON_SIZE.xl}
          className="text-text-primary/60"
        />
      ) : null}
      {crateMark}
    </div>
  );
}
