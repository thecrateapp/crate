import { useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { toast } from "sonner";
import { ImageCropUpload } from "@/components/ImageCropUpload";
import {
  artistArtworkApiPath,
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";

import {
  ArtistHeroArtworkEditor,
  type HeroArtworkReload,
} from "./ArtistHeroArtworkEditor";
import { ArtistArtworkGallery } from "./ArtistArtworkGallery";

interface ArtistArtworkSectionProps {
  artistId: number;
  artistEntityUid?: string;
  artistName: string;
  genres?: string[];
  imageVersion?: string | null;
  canEdit: boolean;
}

const EMPTY_GENRES: string[] = [];

export function ArtistArtworkSection({
  artistId,
  artistEntityUid,
  artistName,
  genres = EMPTY_GENRES,
  imageVersion,
  canEdit,
}: ArtistArtworkSectionProps) {
  const [refresh, setRefresh] = useState(0);
  const [heroReload, setHeroReload] = useState<HeroArtworkReload | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const route = { artistId, artistEntityUid, artistName };
  const version = `${imageVersion || "artwork"}-${refresh}`;

  async function backfillEligibleArtists() {
    setBackfilling(true);
    try {
      const response = await fetch("/api/artwork/artist-heroes/backfill", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { task_id?: string };
      if (result.task_id) {
        const task = await waitForTask(result.task_id, 120_000);
        if (task.status === "failed") {
          throw new Error(task.error || "Artist hero backfill failed");
        }
      }
      toast.success("Artist hero backfill queued");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Artist hero backfill failed",
      );
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <MonoLabel as="h2" tone="accent">
            Artwork
          </MonoLabel>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage each artist image by its intended surface and aspect ratio.
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="outline"
            loading={backfilling}
            onClick={() => void backfillEligibleArtists()}
          >
            Backfill eligible artists
          </Button>
        ) : null}
      </div>

      <ArtistArtworkGallery
        artistId={artistId}
        artistName={artistName}
        canEdit={canEdit}
        onChanged={() => setRefresh((value) => value + 1)}
        onHeroChanged={(composition) =>
          setHeroReload((current) => ({
            token: (current?.token ?? 0) + 1,
            composition,
          }))
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <ArtworkCard
          title="Avatar"
          description="Square artist identity used in cards, rows and search."
          imageUrl={artistPhotoApiUrl(route, { size: 768, version })}
          imageClassName="aspect-square object-cover"
          canEdit={canEdit}
          endpoint={artistArtworkApiPath(route, "upload-photo")}
          aspect={1}
          onUploaded={() => setRefresh((value) => value + 1)}
        />
        <ArtworkCard
          title="Background"
          description="Wide fallback used by legacy artist and contextual surfaces."
          imageUrl={artistBackgroundApiUrl(route, { size: 1280, version })}
          imageClassName="aspect-[21/9] object-cover grayscale"
          canEdit={canEdit}
          endpoint={artistArtworkApiPath(route, "upload-background")}
          aspect={21 / 9}
          onUploaded={() => setRefresh((value) => value + 1)}
        />
      </div>

      <ArtistHeroArtworkEditor
        artistId={artistId}
        artistName={artistName}
        genres={genres}
        canEdit={canEdit}
        fallbackSourceUrl={artistBackgroundApiUrl(route, {
          size: 1280,
          version,
        })}
        reload={heroReload}
        onUploaded={() => setRefresh((value) => value + 1)}
      />
    </div>
  );
}

function ArtworkCard({
  title,
  description,
  imageUrl,
  imageClassName,
  canEdit,
  endpoint,
  aspect,
  onUploaded,
}: {
  title: string;
  description: string;
  imageUrl: string;
  imageClassName: string;
  canEdit: boolean;
  endpoint: string;
  aspect: number;
  onUploaded: () => void;
}) {
  return (
    <InstrumentPanel
      as="section"
      headingLevel={3}
      label={{ children: title, tone: "accent" }}
      description={description}
    >
      <div className="group/cover relative overflow-hidden rounded-md border border-border-quiet bg-surface-control">
        <img
          src={imageUrl}
          alt={`${title} artwork`}
          className={`w-full ${imageClassName}`}
        />
        {canEdit ? (
          <ImageCropUpload
            endpoint={endpoint}
            aspect={aspect}
            onUploaded={onUploaded}
            label={`Replace ${title.toLowerCase()}`}
            className="absolute bottom-2 right-2 z-10"
          />
        ) : null}
      </div>
    </InstrumentPanel>
  );
}
