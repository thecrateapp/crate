import { useSyncExternalStore } from "react";

import {
  getMediaAccessResumeVersion,
  getMediaAccessTicketsVersion,
  subscribeMediaAccessResumes,
  subscribeMediaAccessTickets,
} from "@/lib/media-access";

export function useMediaAccessVersion(): number {
  return useSyncExternalStore(
    subscribeMediaAccessTickets,
    getMediaAccessTicketsVersion,
    getMediaAccessTicketsVersion,
  );
}

export function useMediaAccessResumeVersion(): number {
  return useSyncExternalStore(
    subscribeMediaAccessResumes,
    getMediaAccessResumeVersion,
    getMediaAccessResumeVersion,
  );
}
