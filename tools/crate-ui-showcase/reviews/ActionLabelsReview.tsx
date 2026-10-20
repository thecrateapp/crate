import { useState } from "react";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ContextMenuExamples } from "./ContextMenuReview";
import { PlayerBarTrackCopy } from "../../../app/listen/src/components/player/bar/PlayerBarTrackCopy";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";

export function PlayerSourceLabelExample() {
  const [event, setEvent] = useState("No source navigation yet");
  return (
    <SettingsFixtureProvider>
      <FormField kind="group" label="Player bar source · desktop caption">
        {(props) => (
          <div {...props} role="group" className="grid min-w-0 gap-4">
            <PlayerBarTrackCopy
              displayTrack={{
                id: "source-example",
                title: "Everything in Its Right Place",
                artist: "Radiohead",
              }}
              displayCrossfadeTransition={null}
              crossfadeProgress={0}
              displayPlaySource={{
                type: "playlist",
                name: "Night Drives",
                href: "/playlist/night-drives",
              }}
              sourceLabel="Night Drives"
              isDesktop
              onOpenAlbum={() => {}}
              onOpenArtist={() => {}}
              onOpenSource={() => setEvent("Night Drives requested")}
            />
            <output aria-label="Player source navigation result">
              {event}
            </output>
          </div>
        )}
      </FormField>
    </SettingsFixtureProvider>
  );
}

export function MonoLabelLinkExamples() {
  return (
    <FormField kind="group" label="MonoLabel link feedback">
      {(props) => (
        <div
          {...props}
          role="group"
          className="flex flex-wrap items-center gap-6"
        >
          <a
            href="#mono-label-destination"
            className="inline-flex min-h-11 items-center"
          >
            <MonoLabel as="span">Discover artists</MonoLabel>
          </a>
          <a
            href="#mono-label-destination"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(event) => event.preventDefault()}
            className="inline-flex min-h-11 items-center"
          >
            <MonoLabel as="span">Unavailable destination</MonoLabel>
          </a>
          <MonoLabel id="mono-label-destination">Read-only metadata</MonoLabel>
        </div>
      )}
    </FormField>
  );
}

export function ActionLabelsReview() {
  const [event, setEvent] = useState("No section action yet");
  const [longLabels, setLongLabels] = useState(false);
  return (
    <main className="mx-auto grid max-w-3xl gap-8 p-4 sm:p-6">
      <PageHeader
        title="Section actions and menu options"
        eyebrow="1BD · Approved action labels"
        subtitle="Accent MonoLabels and glowing dots for View All; uppercase MonoLabels for context-menu options. Actual shared components, local fixture actions."
      />
      <section className="grid min-w-0 gap-4" aria-label="Section action">
        <SectionHeader
          title="Recent albums"
          count={12}
          actionLabel="View All"
          onAction={() => setEvent("View All selected")}
        />
        <output aria-label="Section action result">{event}</output>
      </section>
      <MonoLabelLinkExamples />
      <PlayerSourceLabelExample />
      <FormField layout="inline" label="Long menu options">
        <Checkbox
          checked={longLabels}
          onCheckedChange={(checked) => setLongLabels(checked === true)}
        />
      </FormField>
      <ContextMenuExamples longLabels={longLabels} />
      <MonoLabel>
        Enabled options use accent foreground on hover and keyboard focus. Media
        names keep their original case.
      </MonoLabel>
    </main>
  );
}
