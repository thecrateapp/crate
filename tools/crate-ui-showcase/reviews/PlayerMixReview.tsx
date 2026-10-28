import { useState } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import spanish from "../../../app/listen/src/i18n/catalogs/es.json";
import { Button } from "@crate/ui/shadcn/button";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { PlayerMixIndicator } from "../../../app/listen/src/components/player/PlayerMixIndicator";
import { resolvePlayerMixPresentation } from "../../../app/listen/src/components/player/player-mix-presentation";
import { SpinningDiscFrame } from "../../../app/listen/src/components/player/SpinningDiscFrame";
import { SpinningDiscControl } from "../../../app/listen/src/components/player/SpinningDiscControl";
import { useSpinningDiscPlayback } from "../../../app/listen/src/components/player/use-spinning-disc-playback";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { PlayerSeekBar } from "../../../app/listen/src/components/player/bar/PlayerSeekBar";
import { PlayerIdentityText } from "../../../app/listen/src/components/player/PlayerIdentityText";
import type { EngineMixState } from "../../../app/listen/src/lib/playback-engine";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
import "../../../app/listen/src/components/player/bar/player-seek-bar.css";
import "../../../app/listen/src/components/player/player-identity.css";

const i18n = i18next.createInstance();
void i18n
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources: { en: { translation: english }, es: { translation: spanish } },
    lng: "en",
    fallbackLng: "en",
    keySeparator: false,
    interpolation: { escapeValue: false },
  });

// Real player pieces; only the discrete native result is simulated. No audio/API.
export function PlayerMixExample() {
  const [mode, setMode] = useState<EngineMixState["mode"]>("crossfade");
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasTelemetry, setHasTelemetry] = useState(true);
  const [spanishLocale, setSpanishLocale] = useState(false);
  const { rotorRef } = useSpinningDiscPlayback({
    currentTime: 42,
    duration: 180,
    isPlaying,
    isBuffering: false,
    isJogging: false,
    dragRotation: null,
  });
  const mix = resolvePlayerMixPresentation(
    hasTelemetry
      ? {
          revision: "review-only",
          executionId: 1,
          mode,
          phase: mode === "gapless" ? "idle" : "mixing",
          bassHandoff: mode === "beatmatch",
          outgoingTrackId: "review-track",
          incomingTrackId: "review-next",
        }
      : null,
    { currentTrackId: "review-track", isPlaying, isBuffering: false },
  );
  return (
    <I18nextProvider i18n={i18n}>
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 p-6">
        <div
          role="group"
          aria-label="Simulated native technique"
          className="flex flex-wrap justify-center gap-2"
        >
          {(["gapless", "crossfade", "beatmatch"] as const).map((value) => (
            <FilterChip
              key={value}
              active={mode === value}
              onClick={() => {
                setMode(value);
                setHasTelemetry(true);
              }}
            >
              {value}
            </FilterChip>
          ))}
        </div>
        <div className="w-full max-w-[300px]">
          <SpinningDiscFrame
            rotorRef={rotorRef}
            mixTone={mix?.ringTone}
            artwork={<MediaCover src={IMAGE_SAMPLES[0]} alt="" />}
            control={
              <SpinningDiscControl
                isPlaying={isPlaying}
                isBuffering={false}
                disabled={false}
                onTogglePlay={() => setIsPlaying((value) => !value)}
              />
            }
          />
        </div>
        <div className="w-full max-w-[360px] text-center">
          <PlayerIdentityText
            title="Actual transition indicator"
            album="Simulated native execution"
          />
          <div className="mt-4">
            <PlayerMixIndicator mix={mix} />
            <PlayerSeekBar
              currentTime={42}
              duration={180}
              onSeek={() => {}}
              showTimes
              variant="glow"
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsPlaying((value) => !value)}
          >
            {isPlaying ? "Pause fixture" : "Resume fixture"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setHasTelemetry((value) => !value)}
          >
            {hasTelemetry ? "Clear telemetry" : "Restore telemetry"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void i18n.changeLanguage(spanishLocale ? "en" : "es");
              setSpanishLocale((value) => !value);
            }}
          >
            {spanishLocale ? "English" : "Español"}
          </Button>
        </div>
      </div>
    </I18nextProvider>
  );
}
