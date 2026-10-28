import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoFile } from "../../lib/source-drift";
import {
  ALLOWLIST,
  allowlistMatch,
  CAPABILITIES,
  PROBES,
  SCOPES,
  TOKEN,
} from "./viz";

describe("allowlistMatch", () => {
  it("allows only listed methods on listed paths, like _is_vdj_access_token_request", () => {
    expect(allowlistMatch("GET", "/api/capabilities")).toBe(2);
    expect(allowlistMatch("get", "/api/tracks/by-entity/abc/compatible")).toBe(
      8,
    );
    expect(allowlistMatch("HEAD", "/api/tracks/by-entity/abc/stream")).toBe(9);
    expect(allowlistMatch("POST", "/api/capabilities")).toBe(-1);
    expect(allowlistMatch("GET", "/api/tracks/by-entity/a/b/stream")).toBe(-1);
    expect(allowlistMatch("GET", "/api/capabilities/extra")).toBe(-1);
  });

  it("mixes allowed and refused requests in the probe sequence", () => {
    const results = PROBES.map(
      (probe) => allowlistMatch(probe.method, probe.path) >= 0,
    );
    expect(results).toContain(true);
    expect(results).toContain(false);
  });

  it("describes a token of the documented shape", () => {
    expect(TOKEN.example.startsWith(TOKEN.prefix)).toBe(true);
    expect(TOKEN.example.length - TOKEN.prefix.length).toBe(
      Math.ceil((TOKEN.bytes * 4) / 3),
    );
  });

  it("never mentions beat matching or automation in the example response", () => {
    expect(JSON.stringify(CAPABILITIES)).not.toMatch(/beatmatch|automation/i);
  });
});

const branchSource = (path: string) =>
  existsSync(repoFile(path)) ? readFileSync(repoFile(path), "utf8") : null;

describe("access tokens copied from the API", () => {
  const auth = branchSource("app/crate/api/auth.py");
  const tokens = branchSource("app/crate/db/repositories/access_tokens.py");
  const schema = branchSource("app/crate/api/schemas/capabilities.py");

  it.skipIf(!auth || !auth.includes("_VDJ_ACCESS_TOKEN_ROUTES"))(
    "uses the same allowlist",
    () => {
      const start = auth!.indexOf("_VDJ_ACCESS_TOKEN_ROUTES");
      const block = auth!.slice(start, auth!.indexOf("\n)\n", start));
      const routes = [...block.matchAll(/\{([^}]+)\},\s*rf?"([^"]+)"/g)].map(
        ([, methods, pattern]) => ({
          methods: [...methods!.matchAll(/"(\w+)"/g)].map(([, m]) => m).sort(),
          pattern: pattern!.replace("{_ENTITY_SEGMENT}", "[^/]+"),
        }),
      );
      expect(
        ALLOWLIST.map((route) => ({
          methods: [...route.methods].sort(),
          pattern: route.pattern,
        })),
      ).toEqual(routes);
    },
  );

  it.skipIf(!tokens)("uses supported scopes and the crv_ prefix", () => {
    expect(tokens).toContain(`ACCESS_TOKEN_PREFIX = "${TOKEN.prefix}"`);
    expect(tokens).toContain(`ACCESS_TOKEN_BYTES = ${TOKEN.bytes}`);
    for (const scope of SCOPES) expect(tokens).toContain(`"${scope}"`);
  });

  it.skipIf(!schema)("only shows fields of CapabilitiesResponse", () => {
    for (const section of Object.values(CAPABILITIES))
      for (const key of Object.keys(section))
        expect(schema).toMatch(new RegExp(`^\\s+${key}:`, "m"));
  });
});
