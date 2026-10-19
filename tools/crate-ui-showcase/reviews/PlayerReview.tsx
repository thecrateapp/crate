import { useState, type ReactNode } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { FormField } from "@crate/ui/primitives/FormField";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { CRATE_ICON_SIZE, X, Play, Pause } from "@crate/ui/icons";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { PlayerBarFrame } from "../../../app/listen/src/components/player/bar/PlayerBarFrame";
import { PlayerBarTransportControls } from "../../../app/listen/src/components/player/bar/PlayerBarTransportControls";
import { PlayerSeekBar } from "../../../app/listen/src/components/player/bar/PlayerSeekBar";
import { PlayerVolumeControl } from "../../../app/listen/src/components/player/bar/PlayerVolumeControl";
import { QualityBadge } from "../../../app/listen/src/components/player/bar/QualityBadge";
import { PlayerIdentityText } from "../../../app/listen/src/components/player/PlayerIdentityText";
import { PlayerStage } from "../../../app/listen/src/components/player/PlayerStage";
import { PlayerPanels } from "../../../app/listen/src/components/player/PlayerPanels";
import { PlayerQueueHeader } from "../../../app/listen/src/components/player/PlayerQueueHeader";
import { PlayerQueueFrame } from "../../../app/listen/src/components/player/PlayerQueueFrame";
import { PlayerResumeNotice } from "../../../app/listen/src/components/player/PlayerResumeNotice";
import { SleepTimerView } from "../../../app/listen/src/components/settings/SleepTimerView";
import { SpectrumPlayButton } from "../../../app/listen/src/components/player/SpectrumPlayButton";
import { SyncedLyrics } from "../../../app/listen/src/components/player/SyncedLyrics";
import { PlayerProgressContext } from "../../../app/listen/src/contexts/player-progress-context";
import { TrackRowView } from "../../../app/listen/src/components/cards/TrackRowView";
import { TrackRowContent } from "../../../app/listen/src/components/cards/TrackRowContent";
import {
  TrackRowPlaybackControl,
  TrackRowPlaybackProgressView,
} from "../../../app/listen/src/components/cards/TrackRowPlaybackControl";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import "../../../app/listen/src/components/layout/listen-shell-metrics.css";
import "../../../app/listen/src/components/player/bar/player-seek-bar.css";
import "../../../app/listen/src/components/player/player-identity.css";
const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });
function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FormField label={label} kind="group">
      {(group) => (
        <div {...group} role="group" className="min-w-0">
          {children}
        </div>
      )}
    </FormField>
  );
}
function ReviewQueueRow({
  index,
  current,
  locked,
}: {
  index: number;
  current?: boolean;
  locked: boolean;
}) {
  return (
    <div inert={locked}>
      <TrackRowView active={current} onClick={() => {}}>
        <TrackRowContent
          title={index === 0 ? "Marea" : `Horizonte ${index}`}
          details={
            <p className="text-xs text-text-muted">
              Costa Norte · Luz de octubre
            </p>
          }
          duration="3:24"
          actions={
            <ActionButton label="Remove" disabled={locked}>
              <X size={CRATE_ICON_SIZE.lg} />
            </ActionButton>
          }
          leading={
            <TrackRowPlaybackControl
              index={index + 1}
              disabled={locked}
              isActive={!!current}
              isPlaying={!!current}
              label="Play Marea"
              onClick={() => {}}
              artwork={
                <MediaCover src={IMAGE_SAMPLES[0]} alt="" className="size-12" />
              }
              activeGlyph={
                <TrackRowPlaybackProgressView
                  isPlaying={!!current}
                  currentTime={74}
                  duration={204}
                />
              }
            />
          }
        />
      </TrackRowView>
    </div>
  );
}
export function PlayerTransportExamples() {
  const desktop = useIsDesktop();
  const [time, setTime] = useState(74),
    [playing, setPlaying] = useState(false),
    [buffer, setBuffer] = useState(false),
    [locked, setLocked] = useState(false),
    [remote, setRemote] = useState(false),
    [empty, setEmpty] = useState(false),
    [shuffle, setShuffle] = useState(false),
    [repeat, setRepeat] = useState<"off" | "all" | "one">("off"),
    [volume, setVolume] = useState(0.7);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-4">
        {[
          { label: "Buffering", value: buffer, set: setBuffer },
          { label: "Jam locked", value: locked, set: setLocked },
          { label: "Remote", value: remote, set: setRemote },
          { label: "No track", value: empty, set: setEmpty },
        ].map((item) => (
          <FormField key={item.label} label={item.label} layout="inline">
            {(field) => (
              <Checkbox
                {...field}
                checked={item.value}
                onCheckedChange={(value) => item.set(value === true)}
              />
            )}
          </FormField>
        ))}
      </div>
      <Sample label="Live dock geometry · actual frame and transport">
        <PlayerBarFrame isDesktop={desktop} position="inline">
          <div className="flex min-w-0 flex-1 items-center gap-3 md:max-w-64">
            <MediaCover
              src={empty ? undefined : IMAGE_SAMPLES[0]}
              alt=""
              className="size-12"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-medium">
                {empty ? "Nothing playing" : "Marea"}
              </p>
              <p className="truncate text-xs text-text-muted">
                {remote ? "Remote device" : "Costa Norte"}
              </p>
            </div>
          </div>
          <PlayerBarTransportControls
            t={i18n.t}
            frequenciesDb={[]}
            sampleRate={44100}
            showAnalyzer={false}
            isPlaying={playing}
            shuffle={shuffle}
            repeat={repeat}
            jamQueueLocked={locked || empty}
            jamTransportDisabled={locked || empty}
            effectiveIsPlaying={playing}
            effectiveIsBuffering={buffer}
            effectiveDisplayedTime={time}
            effectiveDisplayedDuration={empty ? 0 : 204}
            progressPct={(time / 204) * 100}
            seekHover={null}
            onSeekHoverChange={() => {}}
            onToggleShuffle={() => setShuffle(!shuffle)}
            onPreviousTrack={() => setTime(0)}
            onPlayPause={() => setPlaying(!playing)}
            onNextTrack={() => setTime(0)}
            onCycleRepeat={() =>
              setRepeat(
                repeat === "off" ? "all" : repeat === "all" ? "one" : "off",
              )
            }
            onSeek={setTime}
          />
          <div className="hidden items-center gap-2 md:flex">
            <QualityBadge
              badge={{
                tier: "lossless",
                label: "FLAC 16/44.1",
                detail: "16 bit · 44.1 kHz",
              }}
              origin={remote ? "stream" : "source"}
            />
            <PlayerVolumeControl
              volume={volume}
              onVolumeChange={setVolume}
              onOverlayChange={() => {}}
            />
          </div>
        </PlayerBarFrame>
      </Sample>
      <Sample label="Seek · native pointer, forward/reverse, keyboard · same beam and head">
        <div data-testid="large-seek">
          <PlayerSeekBar
            currentTime={time}
            duration={empty ? 0 : 204}
            onSeek={setTime}
            disabled={locked}
            showTimes
            thin
            variant="glow"
          />
        </div>
      </Sample>
      <output aria-label="Seek position" className="font-mono text-xs">
        {time.toFixed(1)}
      </output>
      <p className="text-xs text-text-muted">
        Local fixture callbacks only. No playback engine, API, fake analyser or
        saved preferences.
      </p>
    </div>
  );
}
export function PlayerPanelsExamples() {
  const [tab, setTab] = useState("player"),
    [time, setTime] = useState(5),
    [count, setCount] = useState(3),
    [locked, setLocked] = useState(false),
    [sleep, setSleep] = useState(""),
    [notice, setNotice] = useState(true),
    [playing, setPlaying] = useState(false);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap gap-4">
        <Button variant="secondary" onClick={() => setCount(count ? 0 : 30)}>
          {count ? "Empty queue" : "Long queue"}
        </Button>
        <FormField label="Queue locked" layout="inline">
          {(field) => (
            <Checkbox
              {...field}
              checked={locked}
              onCheckedChange={(value) => setLocked(value === true)}
            />
          )}
        </FormField>
        <Button variant="ghost" onClick={() => setTime(time === 5 ? 15 : 5)}>
          Advance lyric
        </Button>
      </div>
      <Sample label="Text tabs and actual queue/lyric pieces">
        <div className="flex h-[560px] min-w-0 rounded-panel border border-border-subtle bg-surface-canvas">
          <PlayerPanels
            label="Player panels"
            value={tab}
            onValueChange={setTab}
            items={[
              {
                value: "player",
                label: "Now playing",
                content: (
                  <PlayerStage
                    artwork={
                      <MediaCover
                        src={IMAGE_SAMPLES[0]}
                        alt="Luz de octubre"
                        className="aspect-square w-full"
                      />
                    }
                  >
                    <PlayerIdentityText
                      title="Marea"
                      album="Costa Norte · Luz de octubre"
                    />
                    <SpectrumPlayButton
                      size="lg"
                      active={playing}
                      onClick={() => setPlaying(!playing)}
                      aria-label={playing ? "Pause" : "Play"}
                    >
                      {playing ? (
                        <Pause size={CRATE_ICON_SIZE.xl} />
                      ) : (
                        <Play size={CRATE_ICON_SIZE.xl} fill="currentColor" />
                      )}
                    </SpectrumPlayButton>
                  </PlayerStage>
                ),
              },
              {
                value: "queue",
                label: "Queue",
                content: (
                  <PlayerQueueFrame position="inline">
                    <PlayerQueueHeader
                      title="Queue"
                      summary={`${count} tracks · ${Math.floor((count * 204) / 60)} min`}
                      source="Playing from: Luz de octubre"
                      closeLabel="Close queue"
                      onClose={() => setTab("player")}
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {count ? (
                        Array.from({ length: count }, (_, index) => (
                          <ReviewQueueRow
                            key={index}
                            index={index}
                            current={index === 0}
                            locked={locked}
                          />
                        ))
                      ) : (
                        <p className="p-4 text-sm text-text-muted">
                          Queue is empty
                        </p>
                      )}
                    </div>
                  </PlayerQueueFrame>
                ),
              },
              {
                value: "lyrics",
                label: "Lyrics",
                content: (
                  <PlayerProgressContext
                    value={{ currentTime: time, duration: 30 }}
                  >
                    <div className="overflow-y-auto p-5">
                      <SyncedLyrics
                        lines={[
                          { time: 0, text: "Across the quiet water" },
                          { time: 10, text: "The light returns" },
                          { time: 20, text: "A line still to come" },
                        ]}
                        onSeek={setTime}
                      />
                    </div>
                  </PlayerProgressContext>
                ),
              },
            ]}
          />
        </div>
      </Sample>
      <Sample label="Resume and sleep · actual notices and form controls">
        <div className="grid gap-5">
          {notice ? (
            <PlayerResumeNotice
              message="Continue on this device"
              detail="Marea · 1:14"
              actionLabel="Continue"
              secondaryLabel="Not now"
              dismissLabel="Dismiss"
              onContinue={() => setNotice(false)}
              onDismiss={() => setNotice(false)}
            />
          ) : (
            <Button variant="ghost" onClick={() => setNotice(true)}>
              Show resume notice
            </Button>
          )}
          <SleepTimerView
            label="Sleep timer"
            value={sleep}
            onChange={setSleep}
            options={[
              { value: "15min", label: "15 min" },
              { value: "30min", label: "30 min" },
              { value: "end_of_track", label: "End of track" },
            ]}
            active={!!sleep}
            remaining={
              sleep && sleep !== "end_of_track" ? "Pausing in 15:00" : undefined
            }
            cancelLabel="Cancel"
            onCancel={() => setSleep("")}
          />
        </div>
      </Sample>
    </div>
  );
}
export function PlayerReview() {
  return (
    <I18nextProvider i18n={i18n}>
      <main className="mx-auto grid max-w-6xl gap-10 px-4 py-8 md:px-8">
        <PageHeader
          title="1AZ · Listen Player"
          subtitle="Shared references, real player views. Review before commit."
        />
        <PlayerTransportExamples />
        <PlayerPanelsExamples />
      </main>
    </I18nextProvider>
  );
}
export function PlayerTransportStory() {
  return (
    <I18nextProvider i18n={i18n}>
      <PlayerTransportExamples />
    </I18nextProvider>
  );
}
export function PlayerPanelsStory() {
  return (
    <I18nextProvider i18n={i18n}>
      <PlayerPanelsExamples />
    </I18nextProvider>
  );
}
