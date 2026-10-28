import { describe, expect, it } from "vitest";
import { loopbackProxyCookies } from "../dev/proxy-cookies";

describe("development API proxy cookie scope", () => {
  const cookie =
    "crate_listen_token=fixture; Domain=.lespedants.org; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=3600";
  it("makes production cookies host-only and valid on the local HTTP preview", () => {
    expect(loopbackProxyCookies([cookie], "127.0.0.1:5174", false)).toEqual([
      "crate_listen_token=fixture; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600",
    ]);
  });
  it("retains HttpOnly, expiry and secure policy on HTTPS loopback", () => {
    expect(loopbackProxyCookies([cookie], "localhost:5174", true)).toEqual([
      "crate_listen_token=fixture; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=3600",
    ]);
  });
  it.each(["listen.lespedants.org", "localhost.attacker.test", "invalid/host"])(
    "leaves cookies unchanged outside loopback (%s)",
    (host) => {
      expect(loopbackProxyCookies([cookie], host, false)).toEqual([cookie]);
    },
  );
  it("handles deletion, missing cookies and IPv6 loopback", () => {
    expect(loopbackProxyCookies(undefined, "localhost", false)).toBeUndefined();
    expect(
      loopbackProxyCookies(
        [
          "crate_listen_token=; Domain=.lespedants.org; Max-Age=0; Secure; SameSite=None",
        ],
        "[::1]:5174",
        false,
      ),
    ).toEqual(["crate_listen_token=; Max-Age=0; SameSite=Lax"]);
  });
});
