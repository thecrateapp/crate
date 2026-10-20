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
const dockerignore = readFileSync(
  resolve(listenRoot, "Dockerfile.dockerignore"),
  "utf8",
);

describe("Listen Docker workspace dependencies", () => {
  it("declares the shared Cast protocol package", () => {
    expect(listenPackage.dependencies["@crate/cast-protocol"]).toBe("*");
    expect(
      workspaceLockfile.packages["app/listen"]?.dependencies?.[
        "@crate/cast-protocol"
      ],
    ).toBe("*");
  });

  it("installs the local workspaces from the root lockfile", () => {
    expect(dockerfile).toContain("COPY package.json package-lock.json ./");
    expect(dockerfile).toContain(
      "COPY app/shared/cast/package.json app/shared/cast/",
    );
    expect(dockerfile).toContain(
      "RUN npm ci --workspace=app/listen --workspace=app/shared/ui --workspace=app/shared/cast",
    );
    expect(dockerfile).not.toContain("--package-lock=false");
    expect(dockerfile).not.toContain("sed -i");
  });

  it("sends the shared Cast protocol in the build context", () => {
    expect(dockerignore).toMatch(/^!app\/shared\/cast\/$/m);
    expect(dockerfile).toContain("COPY app/shared/ app/shared/");
  });
});
