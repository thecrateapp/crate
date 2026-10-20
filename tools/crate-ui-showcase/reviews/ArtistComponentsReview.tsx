import "../../../app/listen/src/components/layout/listen-shell-metrics.css";
import { useState } from "react";
import { ArtistBioProfile } from "@crate/ui/domain/ArtistBioProfile";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
import { ArtistHeroFrame } from "@crate/ui/domain/ArtistHeroFrame";
import { ArtistHeroPresentation } from "@crate/ui/domain/ArtistHeroPresentation";
import { Button } from "@crate/ui/shadcn/button";
import { FormField } from "@crate/ui/primitives/FormField";
import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { AppModal } from "@crate/ui/primitives/AppModal";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

export const ARTIST_BIO_FIXTURE =
  "The artist moves between nocturnal electronics and improvised music. Natural case, names and paragraphs remain readable across the full modal width. ".repeat(
    5,
  ) +
  "\n\nFind more at https://example.com/music. A second paragraph keeps its own rhythm.";
export function ArtistBioExample({
  sparse = false,
  initialExpanded = true,
}: {
  sparse?: boolean;
  initialExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [event, setEvent] = useState("No profile action");
  return (
    <>
      <ArtistBioProfile
        artistName="Mixed Case Artist"
        photoUrl={sparse ? undefined : IMAGE_SAMPLES[0]}
        meta={sparse ? [] : ["Since 1991", "Bristol, United Kingdom"]}
        genres={
          sparse
            ? []
            : [
                { name: "trip-hop", percent: 74, source: "lastfm" },
                { name: "experimental", percent: 0, source: "lastfm" },
              ]
        }
        bio={sparse ? "" : ARTIST_BIO_FIXTURE}
        bioExpanded={expanded}
        onBioToggle={() => setExpanded(!expanded)}
        stats={
          sparse
            ? undefined
            : { listeners: 12000, playcount: 450000, spotifyPopularity: 0 }
        }
        libraryStats={{ albums: 0, tracks: 0, sizeMb: 0 }}
        members={
          sparse
            ? []
            : [
                {
                  name: "Alex Example",
                  roles: ["vocals", "guitar"],
                  begin: "1991-10",
                },
                {
                  name: "Former Member",
                  roles: ["drums"],
                  begin: "1990",
                  end: "1998-08-28",
                },
              ]
        }
        urls={
          sparse
            ? []
            : [{ type: "official homepage", url: "https://example.com" }]
        }
        onGenreSelect={(genre) => setEvent(`Genre: ${genre.name}`)}
        onExternalLink={(url) => setEvent(`Link: ${url}`)}
        scrollableBody={false}
      />
      <output aria-live="polite" aria-label="Profile event">
        {event}
      </output>
    </>
  );
}
export function ArtistBioDialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open biography</Button>
      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Artist biography"
        size="xl"
        panelClassName="flex min-h-0 flex-col sm:max-h-[92vh]"
        mobileSafeArea
      >
        <ArtistBioProfile
          artistName="Mixed Case Artist"
          photoUrl={IMAGE_SAMPLES[0]}
          bio={ARTIST_BIO_FIXTURE}
          onClose={() => setOpen(false)}
        />
      </AppModal>
    </>
  );
}
export function ArtistBioTextExample() {
  return (
    <div className="grid max-w-3xl gap-6">
      <FormField kind="group" label="Biography text · links and punctuation">
        {(props) => (
          <p {...props} role="group">
            <ArtistBioText text="Natural case biography. Visit https://example.com/music. Or www.example.org, for more." />
          </p>
        )}
      </FormField>
      <FormField kind="group" label="Truncated without splitting a URL">
        {(props) => (
          <p {...props} role="group">
            <ArtistBioText
              text="A short introduction https://example.com/a-long-path-that-should-not-be-split and some more text."
              maxChars={42}
            />
          </p>
        )}
      </FormField>
    </div>
  );
}
export function ArtistHeroCompositionExample({
  composition = "desktop",
}: {
  composition?: "desktop" | "mobile";
}) {
  const [event, setEvent] = useState("No hero action");
  return (
    <div className={composition === "mobile" ? "max-w-sm" : "w-full"}>
      <ArtistHeroFrame
        composition={composition}
        artwork={
          <img
            src={IMAGE_SAMPLES[0]}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        }
      >
        <ArtistHeroPresentation
          composition={composition}
          kicker="Featured artist"
          artistName="Mixed Case Artist"
          genres={<GenrePillRow items={[{ name: "trip-hop", percent: 74 }]} />}
          actions={
            <Button
              className="pointer-events-auto mt-4"
              onClick={() => setEvent("Play requested")}
            >
              Play
            </Button>
          }
        />
      </ArtistHeroFrame>
      <output aria-live="polite">{event}</output>
    </div>
  );
}
