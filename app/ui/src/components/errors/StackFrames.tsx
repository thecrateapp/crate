import { cn } from "@crate/ui/lib/cn";

import type { DigestFrame } from "@/lib/error-inbox";

function frameLocation(frame: DigestFrame): string {
  const file = frame.filename ?? frame.module ?? "unknown file";
  return frame.lineno != null ? `${file}:${frame.lineno}` : file;
}

/**
 * Source lines around a frame, as Sentry stored them for the release that
 * failed. The frame's own line is marked with an accent rule and named for
 * screen readers. Follows the admin's read-only code recipe (the portable
 * JSON viewer in Imports): bordered app surface, mono 12/20.
 */
export function SourceContext({ frame }: { frame: DigestFrame }) {
  if (frame.context.length === 0)
    return (
      <p className="text-sm text-text-muted">
        Sentry sent no source lines for this frame.
      </p>
    );
  return (
    <pre
      data-slot="error-frame-source"
      className="overflow-x-auto rounded-md border border-border-quiet bg-app-surface py-3 font-mono text-xs leading-5 text-text-secondary"
    >
      <code className="grid min-w-max">
        {frame.context.map(([line, source]) => {
          const current = line === frame.lineno;
          return (
            <span
              key={line}
              data-current={current || undefined}
              className={cn(
                "grid grid-cols-[3.5rem_minmax(0,1fr)] border-l-2 pr-4",
                current
                  ? "border-accent-action-hi bg-accent-action/10 text-text-primary"
                  : "border-transparent",
              )}
            >
              <span className="select-none pr-4 text-right tabular-nums text-text-subtle">
                {line}
              </span>
              <span className="whitespace-pre">
                {source || " "}
                {current ? (
                  <span className="sr-only"> (error line)</span>
                ) : null}
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

/**
 * In-app frames, innermost first; the innermost one starts open. `suspected`
 * holds digest frame indexes an AI triage or investigation pointed at: they are
 * marked with an accent rule and a label, and start open too.
 */
export function StackFrames({
  frames,
  suspected = [],
}: {
  frames: DigestFrame[];
  suspected?: number[];
}) {
  const ordered = frames.map((frame, index) => ({ frame, index })).reverse();
  const flagged = new Set(suspected);
  return (
    <ol
      aria-label="In-app frames, innermost first"
      className="list-none border-t border-border-quiet p-0"
    >
      {ordered.map(({ frame, index }, position) => (
        <li
          key={index}
          data-suspected={flagged.has(index) || undefined}
          className={cn(
            "border-b border-border-quiet py-2",
            flagged.has(index) && "border-l-2 border-l-accent-action-hi pl-3",
          )}
        >
          <details
            open={position === 0 || flagged.has(index)}
            className="group"
          >
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden="true"
                className="font-mono text-label text-text-subtle group-open:text-accent-action-hi"
              >
                {String(frames.length - position).padStart(2, "0")}
              </span>
              <span className="min-w-0 font-mono text-sm text-text-primary wrap-anywhere">
                {frame.function ?? "anonymous"}
              </span>
              <span className="min-w-0 font-mono text-label text-text-muted wrap-anywhere">
                {frameLocation(frame)}
              </span>
              {position === 0 ? (
                <span className="font-mono text-label uppercase tracking-caps text-accent-action-hi">
                  Innermost
                </span>
              ) : null}
              {flagged.has(index) ? (
                <span className="font-mono text-label uppercase tracking-caps text-accent-action-hi">
                  Suspected
                </span>
              ) : null}
            </summary>
            <div className="pb-2 pt-1">
              {frame.module ? (
                <p className="mb-2 font-mono text-label text-text-subtle wrap-anywhere">
                  {frame.module}
                </p>
              ) : null}
              <SourceContext frame={frame} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
