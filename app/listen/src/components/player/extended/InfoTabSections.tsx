import type { ReactNode } from "react";
import type { TrackInfo } from "../../../lib/track-info-data";

import { InfoTabAudioProfile } from "./InfoTabAudioProfile";
import { InfoTabBliss } from "./InfoTabBliss";
import { InfoTabMood } from "./InfoTabMood";
import { InfoTabSource } from "./InfoTabSource";
import type { MoodEntry } from "./info-tab-data";

export function InfoTabAnalysisGrid({
  info,
  topMoods,
  hasAnalysis,
  qualityPills,
  sourceBadge,
}: {
  info: TrackInfo;
  topMoods: MoodEntry[];
  hasAnalysis: boolean;
  qualityPills: string[];
  sourceBadge?: ReactNode;
}) {
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <InfoTabAudioProfile hasAnalysis={hasAnalysis} info={info} />
      <InfoTabMood info={info} topMoods={topMoods} />
      <InfoTabBliss info={info} />
      <InfoTabSource
        info={info}
        qualityPills={qualityPills}
        badge={sourceBadge}
      />
    </div>
  );
}
