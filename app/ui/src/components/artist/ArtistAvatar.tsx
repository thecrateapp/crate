import { Link } from "react-router";
import { EntityAvatar } from "@crate/ui/domain/entity/EntityAvatar";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistAvatarProps {
  name: string;
  artistId?: number;
  artistSlug?: string;
  size?: number;
  linked?: boolean;
}
export function ArtistAvatar({
  name,
  artistId,
  artistSlug,
  size = 36,
  linked = false,
}: ArtistAvatarProps) {
  const avatar = (
    <EntityAvatar
      src={artistPhotoApiUrl({ artistId, artistSlug, artistName: name })}
      name={name}
      alt={name}
      size="sm"
      shape="circle"
      style={{ width: size, height: size }}
    />
  );
  return (
    <TooltipHint content={name}>
      {linked && artistId != null ? (
        <Link
          to={artistPagePath({ artistId, artistSlug, artistName: name })}
          aria-label={`Open ${name}`}
          className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {avatar}
        </Link>
      ) : (
        avatar
      )}
    </TooltipHint>
  );
}
export function ArtistAvatarStack({
  names,
  size = 18,
}: {
  names: string[];
  size?: number;
}) {
  return (
    <div className="flex shrink-0 -space-x-1">
      {names.map((name) => (
        <ArtistAvatar key={name} name={name} size={size} />
      ))}
    </div>
  );
}
