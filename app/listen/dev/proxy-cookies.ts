/** Dev-server response adaptation only. Never shipped in the Listen runtime. */
export function loopbackProxyCookies(
  cookies: string[] | undefined,
  host: string | undefined,
  secure: boolean,
): string[] | undefined {
  if (
    !cookies ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host ?? "")
  )
    return cookies;
  return cookies.map((cookie) => {
    const hostOnly = cookie.replace(/;\s*Domain=[^;]*/gi, "");
    if (secure) return hostOnly;
    return hostOnly
      .replace(/;\s*Secure(?=;|$)/gi, "")
      .replace(/;\s*SameSite=None(?=;|$)/gi, "; SameSite=Lax");
  });
}
