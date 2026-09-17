import type { CastQueueItem } from "@crate/cast-protocol";

import type { ReceiverPhase, ReceiverStore } from "../receiver-store";
import { ProgressBar } from "./ProgressBar";
import { SpectrumCanvas } from "./SpectrumCanvas";

interface NowPlayingProps {
  item: CastQueueItem;
  phase: ReceiverPhase;
  progress: ReceiverStore["progress"];
  reducedMotion: boolean;
}

function phaseLabel(phase: ReceiverPhase): string {
  if (phase === "paused") return "Paused on Crate";
  if (phase === "buffering" || phase === "loading") return "Loading on Crate";
  if (phase === "recovering") return "Recovering playback";
  return "Playing on Crate";
}

export function NowPlaying({
  item,
  phase,
  progress,
  reducedMotion,
}: NowPlayingProps) {
  return (
    <section className="now-playing" aria-label="Now playing">
      <div className="eyebrow">
        <span className="live-dot" />
        {phaseLabel(phase)}
      </div>
      <h1>{item.title}</h1>
      <p className="artist">{item.artist}</p>
      {item.album ? <p className="album">{item.album}</p> : null}
      {item.quality ? <span className="quality">{item.quality}</span> : null}
      <SpectrumCanvas
        item={item}
        phase={phase}
        progress={progress}
        reducedMotion={reducedMotion}
      />
      <ProgressBar progress={progress} />
    </section>
  );
}
