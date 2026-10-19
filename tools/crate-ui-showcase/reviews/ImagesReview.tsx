import { useState, type ReactNode } from "react";
import { Avatar } from "@crate/ui/primitives/Avatar";
import { EntityAvatar } from "@crate/ui/domain/entity/EntityAvatar";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { PlaylistArtwork } from "@crate/ui/domain/playlists/PlaylistArtwork";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";
import { Heart, Download } from "@crate/ui/icons";
import {
  CRATE_MARK_URL,
  IMAGE_SAMPLES,
  IMAGE_TRACKS,
  sampleCoverUrl,
} from "../fixtures/image-identity";

function Samples({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(group) => (
        <div
          {...group}
          role="group"
          className="flex min-w-0 flex-wrap items-center gap-4"
        >
          {children}
        </div>
      )}
    </FormField>
  );
}

export function ImagesReview() {
  const [swapped, setSwapped] = useState(false);
  const [failed, setFailed] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [result, setResult] = useState("No image action yet.");
  return (
    <main className="mx-auto grid max-w-5xl gap-10 p-6 sm:p-10">
      <PageHeader
        eyebrow="Checkpoint 1AV · Image and identity"
        title="Images keep their identity."
        subtitle="Shared frames and assets. Managed image transport remains in the app."
      />
      <Samples label="MediaCover · loaded, missing and failed">
        <MediaCover
          src={IMAGE_SAMPLES[0]}
          alt="Loaded album"
          className="size-28"
        />
        <MediaCover alt="Costa Norte" className="size-28" />
        <MediaCover
          src="/1av-missing-cover.png"
          alt="Failed album"
          className="size-28"
        />
      </Samples>
      <Samples label="MediaCover · shape roles">
        <MediaCover
          src={IMAGE_SAMPLES[1]}
          alt="Square album"
          shape="square"
          className="size-28"
        />
        <MediaCover
          src={IMAGE_SAMPLES[1]}
          alt="Rounded editorial artwork"
          shape="rounded"
          className="size-28"
        />
        <MediaCover
          src={IMAGE_SAMPLES[1]}
          alt="Circular artist portrait"
          shape="circle"
          className="size-28"
        />
      </Samples>
      <Samples label="MediaCover · source and fallback replacement">
        <MediaCover
          src={
            failed ? "/1av-missing-primary.png" : IMAGE_SAMPLES[swapped ? 1 : 0]
          }
          fallbackUrl={IMAGE_SAMPLES[2]}
          alt="Changing album"
          className="size-28"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setSwapped(!swapped);
              setFailed(false);
            }}
          >
            Change cover
          </Button>
          <Button variant="outline" onClick={() => setFailed(true)}>
            Fail primary cover
          </Button>
        </div>
      </Samples>
      <Samples label="Avatar · canonical sizes">
        {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
          <Avatar key={size} name={`Person ${size}`} size={size} />
        ))}
      </Samples>
      <Samples label="Avatar · image, fallback and decorative">
        <Avatar src={IMAGE_SAMPLES[0]} name="Ada Lovelace" size="xl" />
        <Avatar src="/1av-missing-avatar.png" name="Nina Simone" size="xl" />
        <Avatar name="Decorative portrait" alt="" size="xl" shape="rounded" />
      </Samples>
      <Samples label="EntityAvatar · ring and status">
        <EntityAvatar
          name="Costa Norte"
          src={IMAGE_SAMPLES[0]}
          size="xl"
          ring="accent"
        />
        <EntityAvatar
          name="Nina Simone"
          size="xl"
          ring="subtle"
          badge={<StatusDot tone="on" />}
          badgeLabel="Listening now"
        />
      </Samples>
      <Samples label="PlaylistArtwork · cover and collage counts">
        <PlaylistArtwork
          name="Uploaded playlist"
          coverDataUrl={IMAGE_SAMPLES[0]}
          className="size-28 rounded-lg"
          buildCoverUrl={sampleCoverUrl}
        />
        {[1, 2, 3, 4].map((count) => (
          <PlaylistArtwork
            key={count}
            name={`Playlist with ${count} covers`}
            tracks={IMAGE_TRACKS.slice(0, count)}
            buildCoverUrl={sampleCoverUrl}
            className="size-28 rounded-lg"
          />
        ))}
      </Samples>
      <Samples label="PlaylistArtwork · deduplication, empty and failed">
        <PlaylistArtwork
          name="Duplicate cover playlist"
          tracks={[IMAGE_TRACKS[0]!, IMAGE_TRACKS[0]!]}
          buildCoverUrl={sampleCoverUrl}
          className="size-28 rounded-lg"
        />
        <PlaylistArtwork
          name="Empty playlist"
          showCrateMark
          logoSrc={CRATE_MARK_URL}
          buildCoverUrl={sampleCoverUrl}
          className="size-28 rounded-lg"
        />
        <PlaylistArtwork
          name="Failed playlist cover"
          coverDataUrl="/1av-missing-playlist.png"
          buildCoverUrl={sampleCoverUrl}
          className="size-28 rounded-lg"
        />
        <PlaylistArtwork
          name="Admin decorative fallback opt-out"
          showFallbackIcon={false}
          buildCoverUrl={sampleCoverUrl}
          className="size-28 rounded-lg"
        />
      </Samples>
      <Samples label="Solid controls · equivalent geometry">
        <div className="relative">
          <MediaCover
            src={IMAGE_SAMPLES[0]}
            alt="Artwork with actions"
            className="size-40"
          />
          <div className="absolute top-2 right-2 flex gap-2">
            <IconButton
              label="Follow artwork"
              variant="card"
              aria-pressed={followed}
              onClick={() => setFollowed(!followed)}
            >
              <Heart aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Download artwork"
              variant="card"
              onClick={() => setResult("Artwork download requested.")}
            >
              <Download aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </Samples>
      <Samples label="Brand assets · named and decorative">
        <CrateLogo title="Crate" size={48} />
        <CrateLogo
          title="Crate without effects"
          size={48}
          effects={false}
          reducedMotion
        />
        <CrateLogo size={48} />
        <BandcampLogo size={48} />
        <BandcampLogo size={48} aria-hidden="true" />
      </Samples>
      <output aria-live="polite" className="text-sm text-text-secondary">
        {result}
      </output>
    </main>
  );
}
