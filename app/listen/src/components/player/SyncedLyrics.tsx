import { useContext, useEffect, useRef, type RefObject } from "react";
import { PlayerStateContext } from "../../contexts/player-context";
import { PlayerProgressContext } from "../../contexts/player-progress-context";
import { usePlayerTimeReader } from "../../contexts/player-time-reader";
import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "../../lib/motion-availability";
import "./player-lyrics.css";
export interface SyncedLine {
  time: number;
  text: string;
}
function LyricsClock({
  lines,
  root,
}: {
  lines: SyncedLine[];
  root: RefObject<HTMLDivElement | null>;
}) {
  const progress = useContext(PlayerProgressContext);
  const isPlaying = useContext(PlayerStateContext)?.isPlaying ?? false;
  const readTime = usePlayerTimeReader();
  const previous = useRef(-2);
  const previousLines = useRef(lines);
  const durationRef = useRef(progress?.duration);
  durationRef.current = progress?.duration;
  const applyRef = useRef<(time: number) => void>(() => undefined);
  applyRef.current = (time: number) => {
    let active = -1;
    for (let i = lines.length - 1; i >= 0; i--)
      if (time >= lines[i]!.time) {
        active = i;
        break;
      }
    const rows = root.current?.querySelectorAll<HTMLButtonElement>(
      "button[data-lyric-line]",
    );
    if (!rows) return;
    if (previous.current !== active || previousLines.current !== lines) {
      previousLines.current = lines;
      rows.forEach((row, i) => {
        row.dataset.state =
          i === active ? "active" : i < active ? "past" : "future";
        if (i === active) row.setAttribute("aria-current", "true");
        else row.removeAttribute("aria-current");
      });
      const row = rows[active];
      const surface = root.current?.closest<HTMLElement>(
        '[data-slot="player-lyrics-surface"]',
      );
      if (row && surface) {
        const rowBox = row.getBoundingClientRect();
        const surfaceBox = surface.getBoundingClientRect();
        surface.scrollTo?.({
          top:
            surface.scrollTop +
            rowBox.top -
            surfaceBox.top -
            (surface.clientHeight - rowBox.height) / 2,
          behavior: isMotionBlocked() ? "instant" : "smooth",
        });
      }
      previous.current = active;
    }
    const start = lines[active]?.time ?? 0;
    const end = lines[active + 1]?.time ?? durationRef.current ?? start;
    rows[active]?.style.setProperty(
      "--lyric-progress",
      String(
        end > start
          ? Math.max(0, Math.min(1, (time - start) / (end - start)))
          : 0,
      ),
    );
  };
  // Committed progress (~4 Hz, and every seek) always lands. The reader holds
  // the same value or a newer tick, so this never steps the underline back.
  useEffect(() => {
    applyRef.current(readTime());
  }, [progress?.currentTime, progress?.duration, lines, root, readTime]);
  // Between commits the underline follows the exact engine time, as smoothly
  // as before the commits were coalesced. The loop only runs while playing
  // (isPlaying starts/stops it; it opens no socket or fetch) and motion is on.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let lastTime = Number.NaN;
    const frame = () => {
      const time = readTime();
      if (time !== lastTime) {
        lastTime = time;
        applyRef.current(time);
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!isMotionBlocked()) raf = requestAnimationFrame(frame);
    };
    const unsubscribe = subscribeToMotionAvailability(start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [isPlaying, readTime]);
  return null;
}
/** Static lyric rows; the small clock leaf owns active state, underline and line scrolling. */
export function SyncedLyrics({
  lines,
  onSeek,
}: {
  lines: SyncedLine[];
  onSeek: (time: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} data-slot="synced-lyrics" className="space-y-3 py-8">
      <LyricsClock lines={lines} root={root} />
      {lines.map((line, i) => (
        <button
          key={`${line.time}:${i}`}
          type="button"
          data-lyric-line
          data-state="future"
          className="listen-lyric-line"
          onClick={() => onSeek(line.time)}
        >
          {line.text || "♪"}
        </button>
      ))}
    </div>
  );
}
