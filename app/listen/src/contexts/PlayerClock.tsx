import {
  createContext,
  use,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  PlayerProgressContext,
  type PlayerProgressValue,
} from "./player-context";
const PlayerClockContext = createContext<RefObject<PlayerProgressValue> | null>(
  null,
);
/** Stable read for event handlers/controllers. Only time/progress leaves subscribe to ticks. */
export function PlayerClockProvider({
  value,
  children,
}: {
  value: PlayerProgressValue;
  children: ReactNode;
}) {
  const clock = useRef(value);
  clock.current = value;
  return <PlayerClockContext value={clock}>{children}</PlayerClockContext>;
}
export function usePlayerClock() {
  const clock = useContext(PlayerClockContext);
  // Legacy/test providers without the clock retain their existing progress contract.
  const fallback = clock ? null : use(PlayerProgressContext);
  const ref = useRef(fallback ?? { currentTime: 0, duration: 0 });
  ref.current = fallback ?? ref.current;
  return clock ?? ref;
}
