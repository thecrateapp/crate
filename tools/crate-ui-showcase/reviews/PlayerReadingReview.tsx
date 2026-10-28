import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@crate/ui/domain/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Slider } from "@crate/ui/primitives/Slider";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@crate/ui/shadcn/select";
import { PlayerLyricsContent } from "../../../app/listen/src/components/player/PlayerLyricsContent";
import { InfoTabView } from "../../../app/listen/src/components/player/extended/InfoTabView";
import { InfoTabHeroArtworkView } from "../../../app/listen/src/components/player/extended/InfoTabHeroArtworkView";
import { PlayerProgressContext } from "../../../app/listen/src/contexts/player-progress-context";
import {
  readingInfo,
  READING_LINES,
  READING_TRACK,
} from "../fixtures/player-reading";
import { SettingsFixtureProvider } from "./SettingsFixtureProvider";
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label}>
      {(field) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...field}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
function LyricsPreviewFrame({
  unframed,
  children,
}: {
  unframed: boolean;
  children: ReactNode;
}) {
  return unframed ? (
    <section aria-label="Lyrics preview" className="min-w-0">
      {children}
    </section>
  ) : (
    <Card as="section" aria-label="Lyrics preview">
      {children}
    </Card>
  );
}
export function PlayerReadingExample({
  initialLyrics = "synced",
  initialInfo = "complete",
}: {
  initialLyrics?: string;
  initialInfo?: string;
}) {
  const [lyrics, setLyrics] = useState(initialLyrics),
    [info, setInfo] = useState(initialInfo),
    [presentation, setPresentation] = useState("drawer"),
    [time, setTime] = useState(12),
    [event, setEvent] = useState("Local callbacks only");
  const [unframed, setUnframed] = useState(false);
  const data = readingInfo(info);
  return (
    <div className="grid min-w-0 gap-8">
      <div className="flex min-w-0 flex-wrap items-end gap-4">
        <Choice
          label="Lyrics state"
          value={lyrics}
          onChange={setLyrics}
          options={[
            "synced",
            "long synced",
            "plain",
            "loading",
            "error",
            "empty",
          ]}
        />
        <Choice
          label="Lyrics placement"
          value={presentation}
          onChange={setPresentation}
          options={["drawer", "fullscreen"]}
        />
        <Choice
          label="Info state"
          value={info}
          onChange={setInfo}
          options={[
            "complete",
            "delivery",
            "partial",
            "zero",
            "long",
            "loading",
            "error",
            "empty",
          ]}
        />
        <FormField label="Lyric clock">
          <Slider
            min={0}
            max={90}
            value={time}
            onChange={(event) => setTime(Number(event.target.value))}
          />
        </FormField>
      </div>
      <FormField label="Plain lyrics host (no Card)" layout="inline">
        <Checkbox
          checked={unframed}
          onCheckedChange={(checked) => setUnframed(checked === true)}
        />
      </FormField>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <LyricsPreviewFrame unframed={unframed}>
          <CardHeader>
            <CardTitle as="h2">Lyrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[36rem] min-h-0 min-w-0 flex-col">
              <PlayerProgressContext
                value={{ currentTime: time, duration: 90 }}
              >
                <PlayerLyricsContent
                  lyrics={
                    lyrics === "synced" || lyrics === "long synced"
                      ? {
                          synced:
                            lyrics === "long synced"
                              ? [
                                  {
                                    time: 0,
                                    text: "Alongunbrokentimedlyric".repeat(12),
                                  },
                                ]
                              : READING_LINES,
                          plain: null,
                        }
                      : lyrics === "plain"
                        ? {
                            synced: null,
                            plain:
                              "Keep the Original Case\nAnd leave the spaces where they belong.\n\nA line with averylongunbrokenwordthatshouldwrapinsideitsownpanelwithoutclippingthepage.",
                          }
                        : null
                  }
                  loading={lyrics === "loading"}
                  error={lyrics === "error"}
                  onRetry={() => setLyrics("synced")}
                  presentation={presentation as "drawer" | "fullscreen"}
                  onSeek={(value) => {
                    setTime(value);
                    setEvent(`Seek to ${value}s`);
                  }}
                />
              </PlayerProgressContext>
            </div>
          </CardContent>
        </LyricsPreviewFrame>
        <Card as="section" aria-label="Info preview">
          <CardHeader>
            <CardTitle as="h2">Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[36rem] min-h-0 min-w-0 flex-col">
              <InfoTabView
                playbackQuality={
                  info === "delivery"
                    ? {
                        trackId: READING_TRACK.id,
                        badge: {
                          label: "AAC 192",
                          tier: "standard",
                          detail: "192 kbps",
                        },
                        origin: "stream",
                        source: {
                          format: "flac",
                          bitDepth: 24,
                          sampleRate: 96000,
                        },
                      }
                    : undefined
                }
                info={info === "empty" ? null : data}
                currentTrack={READING_TRACK}
                loading={info === "loading"}
                error={info === "error"}
                onRetry={() => setInfo("complete")}
                artwork={
                  <InfoTabHeroArtworkView
                    src={READING_TRACK.albumCover}
                    alt="A place by the sea album cover"
                  />
                }
                onOpenArtist={() => setEvent("Open artist")}
                onOpenAlbum={() => setEvent("Open album")}
              />
            </div>
          </CardContent>
        </Card>
      </div>
      <MonoLabel as="p" role="status" aria-label="Local fixture action">
        {event}
      </MonoLabel>
    </div>
  );
}
export function PlayerReadingReview() {
  return (
    <SettingsFixtureProvider>
      <main className="mx-auto grid min-w-0 max-w-content gap-8 px-4 py-6 sm:px-8">
        <PageHeader
          eyebrow="1BE · Review"
          title="Lyrics and track information"
          subtitle="Actual Listen views and shared components, with local media and callbacks."
        />
        <PlayerReadingExample />
      </main>
    </SettingsFixtureProvider>
  );
}
