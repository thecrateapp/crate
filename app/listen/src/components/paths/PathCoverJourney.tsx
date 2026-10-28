import { useMemo } from "react";
import { CrateImage } from "@/components/artwork/CrateImage";
import { ensureMediaAccessUrl } from "@/lib/api";
import { usesConfigurableServer } from "@/lib/platform";
import type { PathDetail } from "@/pages/paths-model";
import { buildPathCoverSteps } from "./path-cover-journey-model";
import { createCoverLoader } from "./path-cover-textures";
import { PathCoverJourneyView } from "./PathCoverJourneyView";
// Same credential policy as API requests: cookies on web, media tickets on native runtimes.
const loadListenCover = createCoverLoader(
  (url) => ensureMediaAccessUrl(url, "artwork"),
  usesConfigurableServer ? "omit" : "include",
);
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
      loadCover={loadListenCover}
      renderImage={(props) => <CrateImage {...props} loading="lazy" />}
    />
  );
}
