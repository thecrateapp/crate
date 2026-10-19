import { useState, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { EntityPrimaryAction } from "@crate/ui/domain/entity/EntityPrimaryAction";
import { MediaGrid } from "@crate/ui/domain/lists/MediaGrid";
import { MediaRail } from "@crate/ui/domain/lists/MediaRail";
import { TrackList } from "@crate/ui/domain/tracks/TrackList";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { FormField } from "@crate/ui/primitives/FormField";
import { ActionGroup, ActionButton } from "@crate/ui/primitives/ActionGroup";
import { Slider } from "@crate/ui/primitives/Slider";
import { ListPlus, Play } from "@crate/ui/icons";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";

function Samples({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField kind="group" label={label}>
      {(group) => (
        <div {...group} role="group" className="grid min-w-0 gap-4">
          {children}
        </div>
      )}
    </FormField>
  );
}
const title = "Luz de octubre";
const longTitle =
  "AnUnbrokenTitleThatStillNeedsToRemainReadableWithoutEscapingItsCollectionOnSmallScreens";
export function EntityExamples() {
  const [result, setResult] = useState("No entity action yet.");
  const menu = {
    getActions: () => [
      {
        key: "queue",
        label: "Add to queue",
        onSelect: () => setResult("Queued album."),
      },
    ],
  };
  return (
    <>
      <Samples label="MediaCover · minimum 48px for tracks, albums and artists">
        <div className="flex flex-wrap gap-4">
          {(["square", "rounded", "circle"] as const).map((shape) => (
            <MediaCover
              key={shape}
              src={IMAGE_SAMPLES[0]}
              alt={`Minimum ${shape}`}
              shape={shape}
              className="size-8"
            />
          ))}
        </div>
      </Samples>
      <Samples label="EntityRow · active, selected, disabled and full text">
        <EntityRow
          title={title}
          subtitle="Costa Norte"
          meta="2026 · 8 tracks"
          href="/albums/october"
          openLabel="Open active album"
          active
          cover={{ src: IMAGE_SAMPLES[0] }}
          actionMenu={menu}
          menuButton="always"
          trailing={
            <ActionGroup label="Album actions">
              <ActionButton
                label="Play active album"
                tooltip="Play"
                onClick={() => setResult("Playing album.")}
              >
                <Play />
              </ActionButton>
            </ActionGroup>
          }
        />
        <EntityRow
          title="Selected album"
          subtitle="Selection is separate from current playback"
          selected
          href="/albums/selected"
          menuButton="none"
        />
        <EntityRow
          title="Unavailable album"
          href="/albums/unavailable"
          disabled
          menuButton="none"
        />
        <EntityRow
          title={longTitle}
          subtitle={longTitle}
          meta={0}
          truncate={false}
          onOpen={() => setResult("Opened full title.")}
          menuButton="none"
        />
      </Samples>
      <Samples label="EntityCard · identity, state and independent actions">
        <MediaGrid density="wide">
          <EntityCard
            title={title}
            subtitle="Costa Norte"
            meta="2026 · 8 tracks"
            active
            href="/albums/october"
            openLabel="Open card album"
            layout="grid"
            cover={{ src: IMAGE_SAMPLES[0] }}
            actionMenu={menu}
            menuButton="always"
            overlay={{
              onPlay: () => setResult("Playing card."),
              playLabel: "Play card album",
            }}
          />
          <EntityCard
            title="Selected card"
            selected
            href="/albums/selected"
            layout="grid"
            cover={{ src: IMAGE_SAMPLES[1] }}
            menuButton="none"
          />
          <EntityCard
            title={longTitle}
            subtitle={longTitle}
            truncate={false}
            layout="grid"
            disabled
            href="/albums/unavailable"
            menuButton="none"
          />
        </MediaGrid>
      </Samples>
      <Samples label="EntityCard · compact, tile and editorial profiles">
        <MediaRail label="Artist profiles">
          {(["compact", "tile", "editorial"] as const).map((size) => (
            <EntityCard
              key={size}
              shape="circle"
              profileSize={size}
              title={size}
              cover={{ src: IMAGE_SAMPLES[1] }}
              menuButton="none"
            />
          ))}
        </MediaRail>
        <MediaGrid density="wide">
          <EntityCard
            title="Fill grid profile"
            shape="circle"
            profileSize="tile"
            fillGrid
            layout="grid"
            cover={{ src: IMAGE_SAMPLES[1] }}
            menuButton="none"
          />
        </MediaGrid>
      </Samples>
      <Samples label="EntityPrimaryAction · native link, external, callback, disabled and static">
        <div className="flex flex-wrap gap-4">
          <EntityPrimaryAction href="/albums/october" className="link-meta">
            Internal album link
          </EntityPrimaryAction>
          <EntityPrimaryAction
            href="https://example.org/album"
            external
            className="link-meta"
          >
            External album link
          </EntityPrimaryAction>
          <EntityPrimaryAction
            onOpen={() => setResult("Callback action.")}
            className="link-meta"
          >
            Callback action
          </EntityPrimaryAction>
          <EntityPrimaryAction href="/disabled" disabled className="link-meta">
            Disabled action
          </EntityPrimaryAction>
          <EntityPrimaryAction className="text-text-muted">
            Static identity
          </EntityPrimaryAction>
        </div>
      </Samples>
      <p role="status">{result}</p>
    </>
  );
}
export function CollectionExamples() {
  const albums = [title, "Bruma", "Marea", "Horizonte"];
  const card = (name: string, grid = false) => (
    <EntityCard
      key={name}
      title={name}
      subtitle="Costa Norte"
      href="/albums/october"
      cover={{ src: IMAGE_SAMPLES[0] }}
      layout={grid ? "grid" : "rail"}
      menuButton="none"
    />
  );
  return (
    <>
      <Samples label="MediaGrid · loaded and reserved geometry">
        <MediaGrid aria-label="Loaded albums">
          {albums.map((name) => card(name, true))}
        </MediaGrid>
        <GridSkeleton count={4} density="default" variant="album" />
      </Samples>
      <Samples label="MediaGrid · compact, wide and bounded minimum">
        <MediaGrid density="compact">
          {albums.map((name) => card(name, true))}
        </MediaGrid>
        <MediaGrid density="wide">
          {albums.map((name) => card(name, true))}
        </MediaGrid>
        <MediaGrid minItemWidth={220}>
          {albums.slice(0, 2).map((name) => card(name, true))}
        </MediaGrid>
      </Samples>
      <Samples label="MediaRail · content and columns">
        <MediaRail label="Content rail">
          {albums.map((name) => card(name))}
        </MediaRail>
        <MediaRail label="Columns rail" fit="columns">
          {albums.map((name) => card(name, true))}
        </MediaRail>
      </Samples>
      <Samples label="TrackList · zero, one and many">
        <TrackList
          items={[]}
          itemKey={(n) => n}
          renderRow={(n) => (
            <TrackRowView aria-label={n}>
              <TrackRowContent leading={null} title={n} actions={null} />
            </TrackRowView>
          )}
          empty={
            <p className="text-text-muted">No tracks in this collection.</p>
          }
          label="Empty tracks"
        />
        <TrackList
          items={[title]}
          itemKey={(n) => n}
          renderRow={(n) => (
            <TrackRowView aria-label={n}>
              <TrackRowContent leading={null} title={n} actions={null} />
            </TrackRowView>
          )}
          label="One track"
        />
        <TrackList
          items={albums}
          itemKey={(n) => n}
          renderRow={(n) => (
            <TrackRowView aria-label={n}>
              <TrackRowContent leading={null} title={n} actions={null} />
            </TrackRowView>
          )}
          label="Many tracks"
        />
      </Samples>
      <Samples label="HairlineRow · separate approved 12/18 text-list role">
        <HairlineList>
          <HairlineRow active>Everything in Its Right Place</HairlineRow>
          <HairlineRow>Daydreaming</HairlineRow>
        </HairlineList>
      </Samples>
    </>
  );
}
export function TracksExample() {
  const [active, setActive] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(45);
  const [result, setResult] = useState(
    "Fixture playback only; no audio or server calls.",
  );
  return (
    <>
      <Samples label="Listen TrackRow · shared playback contract in every collection">
        <TrackList
          label="Playback examples"
          items={[
            { id: 1, title: "Marea", density: "default" as const },
            { id: 2, title: "Horizonte", density: "default" as const },
            {
              id: 3,
              title: "Compact queue track",
              density: "compact" as const,
            },
            {
              id: 4,
              title: "Unavailable track",
              disabled: true,
              density: "default" as const,
            },
            {
              id: 5,
              title: "Selected track",
              selected: true,
              density: "default" as const,
            },
            {
              id: 6,
              title: "Numbered album track",
              number: true,
              density: "default" as const,
            },
          ]}
          itemKey={(row) => row.id}
          renderRow={(row) => {
            const isActive = active === row.id;
            const play = () => {
              if (isActive) setPlaying(!playing);
              else {
                setActive(row.id);
                setPlaying(true);
              }
            };
            return (
              <TrackRowView
                aria-label={row.title}
                aria-selected={row.selected ?? false}
                active={isActive}
                selected={row.selected}
                disabled={row.disabled}
                density={row.density}
                onClick={() => {
                  if (!row.disabled) play();
                }}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    ["Enter", " "].includes(event.key)
                  ) {
                    event.preventDefault();
                    if (!row.disabled) play();
                  }
                }}
              >
                <TrackRowContent
                  title={row.title}
                  details={
                    <span className="text-xs text-text-muted">
                      Costa Norte · Luz de octubre
                    </span>
                  }
                  duration="3:00"
                  quality={{ label: "FLAC", tier: "lossless", detail: "FLAC" }}
                  actions={
                    <ActionGroup label={`${row.title} actions`}>
                      <ActionButton
                        label={`Queue ${row.title}`}
                        tooltip="Queue"
                        onClick={(event) => {
                          event.stopPropagation();
                          setResult(`Queued ${row.title}.`);
                        }}
                      >
                        <ListPlus />
                      </ActionButton>
                    </ActionGroup>
                  }
                  leading={
                    <TrackRowPlaybackControl
                      disabled={row.disabled ?? false}
                      index={row.id}
                      isActive={isActive}
                      isPlaying={playing}
                      label={`${isActive && playing ? "Pause" : "Play"} ${row.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        play();
                      }}
                      artwork={
                        row.number ? undefined : (
                          <MediaCover
                            src={IMAGE_SAMPLES[0]}
                            alt=""
                            className="absolute inset-0 size-full"
                          />
                        )
                      }
                      activeGlyph={
                        isActive ? (
                          <TrackRowPlaybackProgressView
                            isPlaying={playing}
                            currentTime={progress}
                            duration={100}
                          />
                        ) : undefined
                      }
                    />
                  }
                />
              </TrackRowView>
            );
          }}
        />
      </Samples>
      <FormField label="Playback position">
        <Slider
          min={0}
          max={100}
          value={progress}
          onChange={(event) => setProgress(event.currentTarget.valueAsNumber)}
        />
      </FormField>
      <p role="status">{result}</p>
    </>
  );
}
function RouteProbe() {
  const location = useLocation();
  return (
    <p className="font-mono text-xs" data-testid="route-probe">
      {location.pathname}
    </p>
  );
}
export function CollectionsReview() {
  return (
    <MemoryRouter>
      <main className="mx-auto grid max-w-5xl gap-10 p-6 sm:p-10">
        <PageHeader
          eyebrow="Checkpoint 1AW · Entities, tracks and collections"
          title="One language for every collection."
          subtitle="Actual shared components and Listen track presentation. The mockup remains the visual reference."
        />
        <TracksExample />
        <EntityExamples />
        <CollectionExamples />
        <RouteProbe />
      </main>
    </MemoryRouter>
  );
}
