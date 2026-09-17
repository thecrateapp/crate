import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const listenRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const listenPackage = JSON.parse(
  readFileSync(resolve(listenRoot, "package.json"), "utf8"),
) as { dependencies: Record<string, string> };
const workspaceLockfile = JSON.parse(
  readFileSync(resolve(listenRoot, "../../package-lock.json"), "utf8"),
) as {
  packages: Record<string, { dependencies?: Record<string, string> }>;
};
const dockerfile = readFileSync(resolve(listenRoot, "Dockerfile"), "utf8");

describe("Listen Docker workspace dependencies", () => {
  it("declares the shared Cast protocol package", () => {
    expect(listenPackage.dependencies["@crate/cast-protocol"]).toBe("*");
    expect(
      workspaceLockfile.packages["app/listen"]?.dependencies?.[
        "@crate/cast-protocol"
      ],
    ).toBe("*");
  });

  it("filters local workspace packages before installing npm dependencies", () => {
    const installFilter =
      dockerfile.match(/RUN sed -i([\s\S]*?)&& npm install/)?.[1] ?? "";

    expect(installFilter).toContain(
      String.raw`-e '/"@crate\/cast-protocol"/d'`,
    );
    expect(installFilter).toContain(String.raw`-e '/"@crate\/ui"/d'`);
  });

  it("installs the local Cast package in the production image", () => {
    expect(dockerfile).toContain("COPY shared/cast/ /app-shared/shared/cast/");
    expect(dockerfile).toContain(
      "ln -s /app-shared/shared/cast node_modules/@crate/cast-protocol",
    );
  });
});
