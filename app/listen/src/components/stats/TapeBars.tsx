import { memo } from "react";

import { TAPE_HEIGHT, TAPE_WIDTH, type TapeModel } from "./stats-tape-model";

export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export const TapeBars = memo(function TapeBars({
  model,
}: {
  model: TapeModel;
}) {
  return (
    <svg
      viewBox={`0 0 ${TAPE_WIDTH} ${TAPE_HEIGHT}`}
      preserveAspectRatio="none"
      className="stats-signal-svg"
      aria-hidden="true"
    >
      {model.bars.map((bar) => (
        <rect
          key={bar.bucket}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          className="stats-signal-bar"
          data-hot={bar.hot ? "true" : undefined}
          data-today={bar.today ? "true" : undefined}
          style={{ animationDelay: `${bar.delayMs}ms` }}
        />
      ))}
      {model.moodPath ? (
        <path d={model.moodPath} pathLength={1} className="stats-signal-mood" />
      ) : null}
    </svg>
  );
});
