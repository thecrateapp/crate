import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Music2 } from "@crate/ui/icons";
import {
  Card,
  CardHeader,
  CardContent,
  CardAction,
} from "@crate/ui/shadcn/card";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { EmptyState } from "@crate/ui/domain/states";
import { useMotionAllowed } from "@crate/ui/lib/motion-gate";
import {
  pathCoverWindow,
  type PathCoverStep,
} from "./path-cover-journey-model";
import "./path-cover-journey.css";

/** Sequence composition, not a projection of sound/energy. No frame loop or progress subscription. */
export function PathCoverJourneyView({
  steps,
  origin,
  destination,
  activeStep = -1,
  currentTrackKey,
  playing = false,
  onPlay,
  renderImage,
}: {
  steps: PathCoverStep[];
  origin: string;
  destination: string;
  activeStep?: number;
  currentTrackKey?: string;
  playing?: boolean;
  onPlay: (index: number) => void;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
}) {
  const { t } = useTranslation();
  const motion = useMotionAllowed();
  const [inspected, setInspected] = useState(Math.max(0, activeStep));
  const focus = Math.min(Math.max(0, inspected), Math.max(0, steps.length - 1));
  const stage = useRef<HTMLDivElement>(null);
  const previousTrackKey = useRef(currentTrackKey);
  const focusButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    // List refreshes and play/pause must not reset manual inspection.
    if (previousTrackKey.current === currentTrackKey) return;
    previousTrackKey.current = currentTrackKey;
    if (activeStep >= 0 && activeStep < steps.length) {
      restoreFocus.current =
        Boolean(stage.current?.contains(document.activeElement)) &&
        activeStep !== focus;
      setInspected(activeStep);
    }
  }, [currentTrackKey]);
  useEffect(() => {
    if (restoreFocus.current) {
      focusButton.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [focus]);
  const current = steps[focus];
  const indices = pathCoverWindow(steps.length, focus);
  const inspect = (index: number, keyboard = false) => {
    const next = Math.min(steps.length - 1, Math.max(0, index));
    // A boundary key must never leave a pending focus request.
    restoreFocus.current = keyboard && next !== focus;
    setInspected(next);
  };
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
        <CardAction>
          <ActionGroup label={t("paths.title")}>
            <ActionButton
              label={t("paths.journey.previous")}
              onClick={() => inspect(focus - 1)}
              disabled={focus === 0 || !steps.length}
            >
              <ArrowLeft aria-hidden="true" />
            </ActionButton>
            <ActionButton
              label={t("paths.journey.next")}
              onClick={() => inspect(focus + 1)}
              disabled={focus >= steps.length - 1}
            >
              <ArrowRight aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {current ? (
          <>
            <div
              ref={stage}
              className="path-cover-stage"
              role="group"
              aria-label={t("paths.title")}
              onKeyDown={(event) => {
                const index =
                  event.key === "ArrowLeft"
                    ? focus - 1
                    : event.key === "ArrowRight"
                      ? focus + 1
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? steps.length - 1
                          : null;
                if (index == null) return;
                event.preventDefault();
                inspect(index, true);
              }}
            >
              {indices.map((index) => {
                const step = steps[index]!;
                const offset = index - focus;
                return (
                  <button
                    key={`${step.index}:${step.title}:${step.artist}`}
                    type="button"
                    className="path-cover-step"
                    data-distance={Math.abs(offset)}
                    data-focused={index === focus || undefined}
                    data-current={index === activeStep || undefined}
                    ref={index === focus ? focusButton : undefined}
                    tabIndex={index === focus ? 0 : -1}
                    aria-current={index === activeStep ? "step" : undefined}
                    aria-label={t("paths.journey.stepAction", {
                      step: index + 1,
                      title: step.title,
                      artist: step.artist,
                    })}
                    style={
                      {
                        "--path-offset": offset,
                        "--path-distance": Math.abs(offset),
                        "--path-scale": 1 - Math.abs(offset) * 0.13,
                        zIndex: 10 - Math.abs(offset),
                      } as CSSProperties
                    }
                    onClick={() => {
                      inspect(index);
                      onPlay(index);
                    }}
                  >
                    <MediaCover
                      src={step.coverUrl}
                      alt=""
                      fallbackIcon={Music2}
                      className="size-full"
                      renderImage={renderImage}
                    />
                  </button>
                );
              })}
            </div>
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
            <div className="mt-6 flex min-w-0 flex-wrap justify-between gap-3 border-t border-border-quiet pt-4">
              <MonoLabel>{origin}</MonoLabel>
              <MonoLabel>{destination}</MonoLabel>
            </div>
          </>
        ) : (
          <EmptyState message={t("paths.journey.empty")} />
        )}
      </CardContent>
    </Card>
  );
}
