const PUBLIC_AUTH_BOOTSTRAP_PATHS = new Set([
  "/login",
  "/register",
  "/server-setup",
  "/auth/callback",
]);

const PUBLIC_CONTENT_PATH_PATTERNS = [/^\/crate\/(?!invite(?:\/|$))[^/]+\/?$/];

export function isPublicContentPath(pathname: string): boolean {
  return PUBLIC_CONTENT_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function shouldRedirectToLoginOnUnauthorized(pathname: string): boolean {
  return (
    !PUBLIC_AUTH_BOOTSTRAP_PATHS.has(pathname) && !isPublicContentPath(pathname)
  );
}

export function redirectToLoginOnUnauthorized(
  pathname: string,
  redirect: (path: string) => void,
) {
  if (shouldRedirectToLoginOnUnauthorized(pathname)) {
    redirect("/login");
  }
}

export function loginPathWithReturnTo(returnTo: string): string {
  return `/login?return_to=${encodeURIComponent(returnTo)}`;
}
