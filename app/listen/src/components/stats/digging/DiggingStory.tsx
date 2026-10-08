import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";

import { isMotionBlocked } from "@/lib/motion-availability";

export const DIGGING_CHAPTER_MS = 5200;

export interface DiggingChapter {
  key: string;
  label: string;
  tone?: "accent" | "photo" | "dark";
  render: () => ReactNode;
}

export function DiggingStory({
  chapters,
  onClose,
}: {
  chapters: DiggingChapter[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const autoplay = useRef(!isMotionBlocked());
  const rootRef = useRef<HTMLDivElement>(null);
  const count = chapters.length;
  const last = index >= count - 1;

  const step = useCallback(
    (delta: number) =>
      setIndex((current) => Math.min(count - 1, Math.max(0, current + delta))),
    [count],
  );

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!autoplay.current || paused || last) return;
    const timer = window.setTimeout(() => step(1), DIGGING_CHAPTER_MS);
    return () => window.clearTimeout(timer);
  }, [index, last, paused, step]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
  }

  function handleTap(clientX: number, width: number) {
    step(clientX < width * 0.3 ? -1 : 1);
  }

  const chapter = chapters[index];
  if (!chapter) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="stats-digging z-app-upcoming-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("stats.digging.label")}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="stats-digging-progress" aria-hidden="true">
        {chapters.map((item, position) => (
          <span key={item.key}>
            <i
              data-state={
                position < index
                  ? "done"
                  : position === index
                    ? "active"
                    : "idle"
              }
              data-paused={paused || !autoplay.current ? "true" : undefined}
              style={{ animationDuration: `${DIGGING_CHAPTER_MS}ms` }}
            />
          </span>
        ))}
      </div>
      <IconButton
        label={t("stats.digging.close")}
        variant="card"
        size="sm"
        className="stats-digging-close"
        onClick={onClose}
      >
        <X size={CRATE_ICON_SIZE.md} />
      </IconButton>
      <section
        key={chapter.key}
        className="stats-digging-chapter"
        data-tone={chapter.tone ?? "accent"}
        aria-roledescription={t("stats.digging.chapter")}
        aria-label={t("stats.digging.progress", {
          current: index + 1,
          total: count,
          label: chapter.label,
        })}
        onPointerDown={() => setPaused(true)}
        onPointerUp={(event) => {
          setPaused(false);
          const target = event.target as HTMLElement;
          if (target.closest("a,button")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          handleTap(event.clientX - rect.left, rect.width);
        }}
        onPointerLeave={() => setPaused(false)}
      >
        {chapter.render()}
      </section>
      <div className="sr-only" aria-live="polite">
        {t("stats.digging.progress", {
          current: index + 1,
          total: count,
          label: chapter.label,
        })}
      </div>
    </div>,
    document.body,
  );
}
