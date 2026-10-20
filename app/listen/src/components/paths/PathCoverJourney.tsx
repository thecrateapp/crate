import { useMemo } from "react";
import { CrateImage } from "@/components/artwork/CrateImage";
import type { PathDetail } from "@/pages/paths-model";
import { buildPathCoverSteps } from "./path-cover-journey-model";
import { PathCoverJourneyView } from "./PathCoverJourneyView";
export function PathCoverJourney({
  path,
  activeStep,
  currentTrackKey,
  playing,
  onPlay,
}: {
  path: PathDetail;
  activeStep: number;
  currentTrackKey?: string;
  playing: boolean;
  onPlay: (index: number) => void;
}) {
  const steps = useMemo(() => buildPathCoverSteps(path.tracks), [path.tracks]);
  return (
    <PathCoverJourneyView
      steps={steps}
      origin={path.origin.label}
      destination={path.destination.label}
      activeStep={activeStep}
      currentTrackKey={currentTrackKey}
      playing={playing}
      onPlay={onPlay}
      renderImage={(props) => <CrateImage {...props} loading="lazy" />}
    />
  );
}
