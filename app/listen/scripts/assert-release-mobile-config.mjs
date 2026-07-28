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
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], "file:"))
) {
  validateReleaseMobileConfig(process.env);
}
