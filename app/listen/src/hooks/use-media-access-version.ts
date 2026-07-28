import { useSyncExternalStore } from "react";

import {
  getMediaAccessTicketsVersion,
  subscribeMediaAccessTickets,
} from "@/lib/media-access";

export function useMediaAccessVersion(): number {
  return useSyncExternalStore(
    subscribeMediaAccessTickets,
    getMediaAccessTicketsVersion,
    getMediaAccessTicketsVersion,
  );
}
