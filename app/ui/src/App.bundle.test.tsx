import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8");

describe("Admin bundle boundary", () => {
  it("never imports a page module statically", () => {
    expect(appSource).not.toMatch(/^import[^;]+from\s+["']@\/pages\//m);
  });

  it("loads every page route behind lazy()", () => {
    const dynamicPageImports = [
      ...appSource.matchAll(/import\(\s*["']@\/pages\/([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    const lazyPageImports = [
      ...appSource.matchAll(
        /lazy\(\s*\(\)\s*=>\s*import\(\s*["']@\/pages\/([^"']+)["']\s*\)/g,
      ),
    ].map((match) => match[1]);

    expect(dynamicPageImports.length).toBeGreaterThan(20);
    expect(lazyPageImports).toEqual(dynamicPageImports);
  });

  it("renders every routed page through its lazy component", () => {
    const lazyNames = new Set(
      [...appSource.matchAll(/const\s+(\w+)\s*=\s*lazy\(/g)].map(
        (match) => match[1],
      ),
    );
    const pageNames = readdirSync(path.join(process.cwd(), "src/pages"))
      .filter(
        (file) => /^[A-Z]\w*\.tsx$/.test(file) && !file.includes(".test."),
      )
      .map((file) => file.replace(/\.tsx$/, ""));
    const routerSource = appSource.slice(
      appSource.indexOf("export default function App"),
    );
    const renderedPages = pageNames.filter((name) =>
      new RegExp(`<${name}\\b`).test(routerSource),
    );

    expect(renderedPages.length).toBeGreaterThan(20);
    expect(renderedPages.filter((name) => !lazyNames.has(name))).toEqual([]);
  });
});
