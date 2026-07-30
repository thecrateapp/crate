const DEV_DOMAIN_SUFFIX = ".dev.lespedants.org";
const DEFAULT_OAUTH_SCHEME = "cratemusic";
const OAUTH_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/;

function resolveFixedServerUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";

  const parsed = new URL(raw);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(DEV_DOMAIN_SUFFIX) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "VITE_CRATE_FIXED_SERVER_URL must use HTTPS on *.dev.lespedants.org",
    );
  }
  return parsed.origin;
}

function resolveOAuthScheme(value: string | undefined): string {
  const scheme = value?.trim().toLowerCase() || DEFAULT_OAUTH_SCHEME;
  if (!OAUTH_SCHEME_PATTERN.test(scheme)) {
    throw new Error("VITE_CRATE_OAUTH_SCHEME is not a valid URL scheme");
  }
  return scheme;
}

export const FIXED_SERVER_URL = resolveFixedServerUrl(
  import.meta.env.VITE_CRATE_FIXED_SERVER_URL,
);
export function getNativeOAuthScheme(): string {
  return resolveOAuthScheme(import.meta.env.VITE_CRATE_OAUTH_SCHEME);
}

export function getNativeOAuthCallbackUrl(): string {
  return `${getNativeOAuthScheme()}://oauth/callback`;
}
