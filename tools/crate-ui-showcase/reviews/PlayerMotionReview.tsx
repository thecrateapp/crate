import { useEffect, useRef, useState, type ReactNode } from "react";
import i18next from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider, initReactI18next } from "react-i18next";
import english from "../../../app/listen/src/i18n/catalogs/en.json";
import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { PlayerSurfaceModeSwitch } from "../../../app/listen/src/components/player/PlayerSurfaceModeSwitch";
import { SpinningDiscFrame } from "../../../app/listen/src/components/player/SpinningDiscFrame";
import { SpinningDiscControl } from "../../../app/listen/src/components/player/SpinningDiscControl";
import { useSpinningDiscPlayback } from "../../../app/listen/src/components/player/use-spinning-disc-playback";
import { CollectionNavigationExamples } from "./AlbumAccessReview";
import { IMAGE_SAMPLES } from "../fixtures/image-identity";
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
    <FormField kind="group" label={label}>
      {(group) => (
        <div {...group} role="group" className="grid min-w-0 gap-4">
          {children}
        </div>
      )}
    </FormField>
  );
}
export function PlayerSurfaceModeExamples() {
  const [mode, setMode] = useState<"cd" | "cover" | "visualizer">("cd");
  return (
    <I18nextProvider i18n={i18n}>
      <Sample label="Display modes · icon actions without a container">
        <PlayerSurfaceModeSwitch mode={mode} onChange={setMode} />
        <output aria-label="Selected display mode">{mode}</output>
      </Sample>
      <Sample label="Display modes · mobile capability gate">
        <PlayerSurfaceModeSwitch
          mode={mode === "visualizer" ? "cd" : mode}
          onChange={setMode}
          allowVisualizer={false}
        />
      </Sample>
    </I18nextProvider>
  );
}
export function DiscMotionExample() {
  const [currentTime, setCurrentTime] = useState(5);
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const { rotorRef } = useSpinningDiscPlayback({
    currentTime,
    duration: 180,
    dragRotation: null,
    isJogging: false,
    isPlaying,
    isBuffering,
  });
  useEffect(() => {
    if (!isPlaying || isBuffering) return;
    const time = timeRef.current,
      start = performance.now();
    const timer = setInterval(
      () => setCurrentTime(time + (performance.now() - start) / 1000),
      250,
    );
    return () => clearInterval(timer);
  }, [isPlaying, isBuffering]);
  return (
    <I18nextProvider i18n={i18n}>
      <Sample label="Disc playback · compositor and stable phase">
        <div className="w-64 max-w-full">
          <SpinningDiscFrame
            rotorRef={rotorRef}
            artwork={
              <img
                src={IMAGE_SAMPLES[0]}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
            }
            control={
              <SpinningDiscControl
                disabled={false}
                isPlaying={isPlaying}
                isBuffering={isBuffering}
                onTogglePlay={() => setIsPlaying(!isPlaying)}
              />
            }
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setCurrentTime((time) => time + 0.75)}
          >
            Correct playback clock
          </Button>
          <Button
            variant="outline"
            aria-pressed={isBuffering}
            onClick={() => setIsBuffering(!isBuffering)}
          >
            Buffering
          </Button>
          <Button
            variant="outline"
            onClick={() => setCurrentTime((time) => time + 10)}
          >
            Seek forward
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const until = performance.now() + 120;
              while (performance.now() < until) {
                /* Deliberate review-only main-thread load. */
              }
            }}
          >
            Interface load
          </Button>
        </div>
        <output aria-label="Fixture playback clock">
          {currentTime.toFixed(2)}
        </output>
        <p className="text-sm text-text-muted">
          Actual disc frame, play control and motion controller. Local clock
          only; no audio engine, API calls or saved preferences.
        </p>
      </Sample>
    </I18nextProvider>
  );
}
export function PlayerMotionReview() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 p-4 sm:p-8">
      <PageHeader
        eyebrow="Checkpoint 1BA · review"
        title="Player motion and navigation"
        subtitle="Continuous disc rotation, unboxed mode actions and Collection kept open on its routes."
      />
      <DiscMotionExample />
      <PlayerSurfaceModeExamples />
      <CollectionNavigationExamples />
    </div>
  );
}
