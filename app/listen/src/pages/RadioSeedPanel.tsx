import type { ComponentProps } from "react";
import { CrateImage } from "@/components/artwork/CrateImage";
import { RadioSeedPanelView } from "./RadioSeedPanelView";
export function RadioSeedPanel(
  props: Omit<ComponentProps<typeof RadioSeedPanelView>, "renderImage">,
) {
  return (
    <RadioSeedPanelView
      {...props}
      renderImage={(image) => <CrateImage {...image} loading="lazy" />}
    />
  );
}
