import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardContent } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { EmptyState } from "@crate/ui/domain/states";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import type { PathCoverStep } from "./path-cover-journey-model";
import type { CoverLoader } from "./path-cover-textures";
import { PathCoverStage } from "./PathCoverStage";
import { PathStepStrip } from "./PathStepStrip";
import "./path-cover-journey.css";

/**
 * One cover on stage with a pixelate-blur transition between steps. The stage follows the
 * playing track or the step just chosen to play; no progress subscription.
 */
export function PathCoverJourneyView({
  steps,
  origin,
  destination,
  activeStep = -1,
  currentTrackKey,
  playing = false,
  onPlay,
  loadCover,
  renderImage,
}: {
  steps: PathCoverStep[];
  origin: string;
  destination: string;
  activeStep?: number;
  currentTrackKey?: string;
  playing?: boolean;
  onPlay: (index: number) => void;
  /** Decodes covers for the WebGL transition; without it covers fade in. */
  loadCover?: CoverLoader;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
}) {
  const { t } = useTranslation();
  const motion = useMotionAllowed();
  const [stage, setStage] = useState(Math.max(0, activeStep));
  const focus = Math.min(Math.max(0, stage), Math.max(0, steps.length - 1));
  const previousTrackKey = useRef(currentTrackKey);
  useEffect(() => {
    // List refreshes and play/pause keep the stage; an actual track change moves it.
    if (previousTrackKey.current === currentTrackKey) return;
    previousTrackKey.current = currentTrackKey;
    if (activeStep >= 0 && activeStep < steps.length) setStage(activeStep);
  }, [currentTrackKey]);
  const current = steps[focus];
  return (
    <Card
      data-slot="path-cover-journey"
      data-motion={motion ? "on" : "off"}
      className="path-cover-journey"
    >
      <CardHeader>
        <MonoLabel
          accent={t("paths.title")}
          meta={[t("common.trackCountLabel", { count: steps.length })]}
        />
      </CardHeader>
      <CardContent>
        {current ? (
          <>
            <PathCoverStage
              steps={steps}
              focus={focus}
              loadCover={loadCover}
              renderImage={renderImage}
            />
            <div
              className="grid min-w-0 gap-2 text-center"
              aria-live="polite"
              data-slot="path-cover-readout"
            >
              <MonoLabel>
                {t("paths.journey.position", {
                  step: focus + 1,
                  total: steps.length,
                })}
              </MonoLabel>
              <p className="wrap-anywhere font-display text-2xl font-semibold text-text-primary">
                {current.title}
              </p>
              <p className="wrap-anywhere text-caption text-text-muted">
                {current.artist}
              </p>
              {playing && activeStep === focus && (
                <div className="flex justify-center">
                  <StatusDot pulse label={t("common.playing")} />
                </div>
              )}
            </div>
            <PathStepStrip
              steps={steps}
              focus={focus}
              activeStep={activeStep}
              origin={origin}
              destination={destination}
              motion={motion}
              renderImage={renderImage}
              onSelect={(index) => {
                setStage(index);
                onPlay(index);
              }}
            />
          </>
        ) : (
          <EmptyState title={t("paths.journey.empty")} />
        )}
      </CardContent>
    </Card>
  );
}
