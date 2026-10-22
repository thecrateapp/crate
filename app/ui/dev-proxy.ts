/**
 * Keep upstream auth cookies usable from the local Vite origin. When API_URL
 * points at a hosted API, its cookies are scoped to that production domain;
 * browsers reject them on localhost/127.0.0.1 unless the dev proxy strips the
 * Domain attribute. The upstream Secure and HttpOnly flags are preserved.
 */
export function createApiProxyOptions(target: string) {
  return {
    target,
    changeOrigin: true,
    secure: false,
    cookieDomainRewrite: "",
  };
}
