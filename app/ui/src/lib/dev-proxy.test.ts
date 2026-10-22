import { describe, expect, it } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { createApiProxyOptions } from "../../dev-proxy";

describe("Admin development API proxy", () => {
  it("strips upstream cookie domains so local login sessions persist", () => {
    expect(createApiProxyOptions("https://api.lespedants.org")).toEqual({
      target: "https://api.lespedants.org",
      changeOrigin: true,
      secure: false,
      cookieDomainRewrite: "",
    });
  });

  it("rewrites a hosted session cookie to a host-only local cookie", async () => {
    const upstream = createHttpServer((_request, response) => {
      response.setHeader(
        "Set-Cookie",
        "crate_session=local-test; Domain=.lespedants.org; Path=/; Secure; HttpOnly; SameSite=None",
      );
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", resolve),
    );

    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Test API did not bind to a TCP port");
    }

    const vite = await createViteServer({
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
        proxy: {
          "/api": createApiProxyOptions(
            `http://127.0.0.1:${upstreamAddress.port}`,
          ),
        },
      },
    });

    try {
      await vite.listen();
      const viteAddress = vite.httpServer?.address();
      if (!viteAddress || typeof viteAddress === "string") {
        throw new Error("Test Vite server did not bind to a TCP port");
      }

      const response = await fetch(
        `http://127.0.0.1:${viteAddress.port}/api/auth/login`,
      );
      const cookie = response.headers.get("set-cookie") ?? "";

      expect(response.status).toBe(200);
      expect(cookie).toContain("crate_session=local-test");
      expect(cookie).not.toContain("Domain=");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=None");
    } finally {
      await vite.close();
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
