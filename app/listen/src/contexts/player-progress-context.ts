import { createContext } from "react";
export interface PlayerProgressValue {
  currentTime: number;
  duration: number;
}
export const PlayerProgressContext = createContext<PlayerProgressValue | null>(
  null,
);
