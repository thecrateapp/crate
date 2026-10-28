import type { FullConfig } from "@playwright/test";
import { assertBaselineUpdateAllowed } from "../../scripts/design-system/visual-capture-runtime.mjs";

export default function captureSetup(config: FullConfig) {
  assertBaselineUpdateAllowed(config.updateSnapshots);
}
