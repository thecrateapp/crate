import type { Page } from "@playwright/test";
import type { ChapterScript, Device } from "../director";
import type { App } from "./apps";

export interface Take {
  app: App;
  devices: Device[];
  start(device: Device): string;
  prepare?(page: Page): Promise<void>;
  warm?: ChapterScript;
  run: ChapterScript;
}

export type Takes = Record<string, Take>;
