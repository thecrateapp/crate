import { useContext, type ComponentProps } from "react";
import { PlayerProgressContext } from "../../contexts/player-context";
import { SpinningDisc } from "./SpinningDisc";
export function LiveSpinningDisc(props: ComponentProps<typeof SpinningDisc>) {
  const progress = useContext(PlayerProgressContext);
  return (
    <SpinningDisc
      {...props}
      currentTime={progress?.currentTime ?? props.currentTime}
      duration={progress?.duration ?? props.duration}
    />
  );
}
