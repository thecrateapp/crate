import { useContext, useEffect, useRef, type RefObject } from "react";
import { PlayerProgressContext } from "../../contexts/player-progress-context";
import { isMotionBlocked } from "../../lib/motion-availability";
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
  const previous = useRef(-2);
  const previousLines = useRef(lines);
  useEffect(() => {
    const time = progress?.currentTime ?? 0;
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
      rows[active]?.scrollIntoView?.({
        block: "center",
        behavior: isMotionBlocked() ? "instant" : "smooth",
      });
      previous.current = active;
    }
    const start = lines[active]?.time ?? 0;
    const end = lines[active + 1]?.time ?? progress?.duration ?? start;
    rows[active]?.style.setProperty(
      "--lyric-progress",
      String(
        end > start
          ? Math.max(0, Math.min(1, (time - start) / (end - start)))
          : 0,
      ),
    );
  }, [progress?.currentTime, progress?.duration, lines, root]);
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
