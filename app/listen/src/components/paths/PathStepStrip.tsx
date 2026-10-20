import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Music2 } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import type { PathCoverStep } from "./path-cover-journey-model";

/** 48 px thumbnail + 8 px gap; mirrored by --path-step-pitch in path-cover-journey.css. */
const THUMB_PITCH = 56;

/**
 * Origin → step thumbnails → destination. Arrow/Home/End only move the roving focus; click or
 * Enter plays a step. The stage never shows a step the queue is not playing or about to play.
 */
export function PathStepStrip({
  steps,
  focus,
  activeStep,
  origin,
  destination,
  motion,
  renderImage,
  onSelect,
}: {
  steps: PathCoverStep[];
  /** Step on stage. */
  focus: number;
  activeStep: number;
  origin: string;
  destination: string;
  motion: boolean;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [cursor, setCursor] = useState(focus);
  const roving = Math.min(Math.max(0, cursor), Math.max(0, steps.length - 1));
  const reveal = (index: number) => {
    // Scroll the strip itself; passive playback must never scroll the document.
    const node = scroller.current;
    node?.scrollTo?.({
      left: index * THUMB_PITCH + THUMB_PITCH / 2 - node.clientWidth / 2,
      behavior: motion ? "smooth" : "auto",
    });
  };
  useEffect(() => {
    // The stage moved (a click or a real track change): the roving stop follows it, and keyboard
    // focus follows only when it was already inside the strip.
    const inside = Boolean(group.current?.contains(document.activeElement));
    setCursor(focus);
    if (inside) buttons.current[focus]?.focus({ preventScroll: true });
    reveal(focus);
  }, [focus]);
  const move = (index: number) => {
    const next = Math.min(steps.length - 1, Math.max(0, index));
    setCursor(next);
    buttons.current[next]?.focus({ preventScroll: true });
    reveal(next);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index =
      event.key === "ArrowLeft"
        ? roving - 1
        : event.key === "ArrowRight"
          ? roving + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? steps.length - 1
              : null;
    if (index == null) return;
    event.preventDefault();
    move(index);
  };
  return (
    <div className="path-step-route">
      <MonoLabel className="path-step-origin">{origin}</MonoLabel>
      <div ref={scroller} className="path-step-scroller">
        <div
          ref={group}
          role="group"
          aria-label={t("paths.title")}
          className="path-step-track"
          onKeyDown={onKeyDown}
          style={
            {
              "--path-step-count": steps.length,
              "--path-step-progress": Math.max(0, activeStep),
            } as CSSProperties
          }
        >
          {steps.map((step, index) => (
            <button
              key={`${step.index}:${step.title}:${step.artist}`}
              type="button"
              className="path-step-thumb"
              data-focused={index === focus || undefined}
              data-past={(activeStep >= 0 && index < activeStep) || undefined}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              tabIndex={index === roving ? 0 : -1}
              aria-current={index === activeStep ? "step" : undefined}
              aria-label={t("paths.journey.stepAction", {
                step: index + 1,
                title: step.title,
                artist: step.artist,
              })}
              onClick={() => {
                setCursor(index);
                onSelect(index);
              }}
            >
              <MediaCover
                src={step.coverUrl}
                alt=""
                fallbackIcon={Music2}
                className="size-12"
                renderImage={renderImage}
              />
              <MonoLabel
                as="span"
                tone={index === activeStep ? "accent" : "subtle"}
              >
                {String(index + 1).padStart(2, "0")}
              </MonoLabel>
            </button>
          ))}
        </div>
      </div>
      <MonoLabel className="path-step-destination">{destination}</MonoLabel>
    </div>
  );
}
