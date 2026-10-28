import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
const harness = `/@fs/${resolve("tools/crate-ui-showcase/fixtures/OfflineArtworkRuntimeProof.tsx")}`;
test("real cached cover survives reload and renders through CrateImage with all network disabled", async ({
  page,
  context,
}) => {
  let imageRequests = 0;
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/albums/7/cover") {
      imageRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rP8AAAAASUVORK5CYII=",
          "base64",
        ),
      });
    } else
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"detail":"Test session"}',
      });
  });
  await page.goto("http://127.0.0.1:5174/login");
  await page.evaluate(async (path) => {
    const fixture = await import(/* @vite-ignore */ path);
    await fixture.saveProofCover();
  }, harness);
  expect(imageRequests).toBe(1);
  await page.reload();
  await page.evaluate(async (path) => {
    await import(/* @vite-ignore */ path);
  }, harness);
  await context.setOffline(true);
  await page.evaluate(async (path) => {
    const fixture = await import(/* @vite-ignore */ path);
    fixture.showProofCover();
  }, harness);
  const image = page.getByRole("img", { name: "Persisted offline cover" });
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect(image).toHaveAttribute("data-artwork-state", "ready");
  expect(
    await image.evaluate(
      (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
    ),
  ).toBe(true);
  await expect(image).not.toHaveAttribute("srcset");
  expect(imageRequests).toBe(1);
  await page.evaluate(async (path) => {
    const fixture = await import(/* @vite-ignore */ path);
    await fixture.clearProofCover();
  }, harness);
  await context.setOffline(false);
});

test("rejects a corrupt image-labelled response and accepts a later successful sync", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/albums/7/cover") {
      requests += 1;
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body:
          requests === 1
            ? Buffer.from("corrupt image")
            : Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rP8AAAAASUVORK5CYII=",
                "base64",
              ),
      });
    } else
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"detail":"Test session"}',
      });
  });
  await page.goto("http://127.0.0.1:5174/login");
  const save = () =>
    page.evaluate(async (path) => {
      const fixture = await import(/* @vite-ignore */ path);
      await fixture.saveProofCover();
      return fixture.hasProofCover();
    }, harness);
  expect(await save()).toBe(false);
  expect(await save()).toBe(true);
  expect(requests).toBe(2);
  await page.evaluate(async (path) => {
    const fixture = await import(/* @vite-ignore */ path);
    await fixture.clearProofCover();
  }, harness);
});
test("evicts persisted corruption and displays a healthy remote cover, then saves a replacement", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/albums/7/cover")
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rP8AAAAASUVORK5CYII=",
          "base64",
        ),
      });
    else
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"detail":"Test session"}',
      });
  });
  await page.goto("http://127.0.0.1:5174/login");
  await page.evaluate(async (path) => {
    const fixture = await import(/* @vite-ignore */ path);
    await fixture.seedBrokenPersistedCover();
    fixture.showProofCover();
  }, harness);
  const image = page.getByRole("img", { name: "Persisted offline cover" });
  await expect(image).toHaveAttribute("src", /\/api\/albums\/7\/cover/);
  await expect(image).toHaveAttribute("data-artwork-state", "ready");
  expect(
    await page.evaluate(async (path) => {
      const fixture = await import(/* @vite-ignore */ path);
      return fixture.hasProofCover();
    }, harness),
  ).toBe(false);
  expect(
    await page.evaluate(async (path) => {
      const fixture = await import(/* @vite-ignore */ path);
      await fixture.saveProofCover();
      return fixture.hasProofCover();
    }, harness),
  ).toBe(true);
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect(image).toHaveAttribute("data-artwork-state", "ready");
  await page.evaluate(async (path) => {
    const fixture = await import(/* @vite-ignore */ path);
    await fixture.clearProofCover();
  }, harness);
});
