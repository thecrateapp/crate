/** One moving edge owns the beam and both heads, including while a seek reverses. */
export function PlayerProgressBeam({
  progressPercent,
  trackClassName = "h-0.5",
}: {
  progressPercent: number;
  trackClassName?: string;
}) {
  const progress = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : 0;
  return (
    <>
      <div
        aria-hidden="true"
        className={`listen-player-progress-track absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full ${trackClassName}`}
      />
      <div
        aria-hidden="true"
        className="listen-player-progress-position"
        style={{ width: `${progress}%` }}
      >
        <div className="listen-player-progress-trail pointer-events-none absolute inset-x-0 top-0 h-2 -translate-y-1/2 overflow-hidden rounded-full opacity-65">
          <div className="listen-player-progress-glow absolute inset-0 blur-[2px]" />
        </div>
        <div
          className={`listen-player-progress-fill absolute inset-x-0 top-0 -translate-y-1/2 rounded-full ${trackClassName}`}
        />
        <div
          className={`listen-player-progress-thumb pointer-events-none absolute right-0 top-0 size-1 translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150 ${progress > 0 ? "opacity-[0.62]" : "opacity-0"}`}
        />
        <div className="listen-player-progress-thumb-active pointer-events-none absolute right-0 top-0 size-1.5 translate-x-1/2 -translate-y-1/2 rounded-full border opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" />
      </div>
    </>
  );
}
