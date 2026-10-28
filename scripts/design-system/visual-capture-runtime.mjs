export const CAPTURE_IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble";

function currentRuntime() {
  return {
    platform: process.platform,
    arch: process.arch,
    image: process.env.CRATE_PLAYWRIGHT_IMAGE,
    ci: process.env.CI === "true",
  };
}

export function canRecordBaselines(runtime = currentRuntime()) {
  return (
    runtime.platform === "linux" &&
    runtime.arch === "x64" &&
    runtime.image === CAPTURE_IMAGE &&
    runtime.ci === true
  );
}

export function assertBaselineUpdateAllowed(mode, runtime = currentRuntime()) {
  if ((mode !== "none" || runtime.ci) && !canRecordBaselines(runtime)) {
    throw new Error(
      `Visual baselines require Linux amd64 CI in ${CAPTURE_IMAGE}. Use CRATE_VISUAL_SMOKE=1 without --update-snapshots for local render checks.`,
    );
  }
}
