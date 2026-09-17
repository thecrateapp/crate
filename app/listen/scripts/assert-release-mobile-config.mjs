import { fileURLToPath } from "node:url";

export function validateReleaseMobileConfig(env) {
  if (env.CRATE_ALLOW_MIXED_CONTENT === "true") {
    throw new Error("Release mobile builds cannot enable mixed content");
  }
  if (env.VITE_ALLOW_INSECURE_LOOPBACK === "true") {
    throw new Error("Release mobile builds cannot allow insecure loopback");
  }
  if (env.VITE_API_URL) {
    const url = new URL(env.VITE_API_URL);
    if (url.protocol !== "https:") {
      throw new Error("Release mobile server URLs must use HTTPS");
    }
  }
  if (
    env.CRATE_REQUIRE_CUSTOM_CAST_RECEIVER === "true" &&
    env.VITE_CAST_CUSTOM_RECEIVER_ENABLED === "true"
  ) {
    const nativeAppId = env.CRATE_CAST_RECEIVER_APP_ID?.trim();
    const webAppId = env.VITE_CAST_RECEIVER_APP_ID?.trim();
    const registeredAppId = /^[A-Za-z0-9]{8}$/;
    if (
      !nativeAppId ||
      !webAppId ||
      nativeAppId === "CC1AD845" ||
      webAppId === "CC1AD845" ||
      !registeredAppId.test(nativeAppId) ||
      !registeredAppId.test(webAppId)
    ) {
      throw new Error(
        "Tagged mobile releases require a registered Cast receiver application ID",
      );
    }
    if (nativeAppId !== webAppId) {
      throw new Error(
        "Native and web Cast receiver application IDs must match",
      );
    }
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], "file:"))
) {
  validateReleaseMobileConfig(process.env);
}
