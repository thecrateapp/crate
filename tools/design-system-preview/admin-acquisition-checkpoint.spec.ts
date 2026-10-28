import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`Acquisition search workspace stays clear at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-acquisition-demo.html");

    const real = page.getByRole("region", {
      name: "Página real de Acquisition",
      exact: true,
    });
    await expect(
      real.getByRole("heading", { level: 1, name: "Acquisition" }),
    ).toBeVisible();
    const search = real.getByRole("textbox", { name: "Search music" });
    await expect(search).toHaveValue("Caspian");
    const searchGeometry = await search.evaluate((input) => {
      const inputRect = input.getBoundingClientRect();
      const button = input
        .closest("form")!
        .querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const buttonRect = button.getBoundingClientRect();
      const icon = input.parentElement!.querySelector("svg")!;
      const iconRect = icon.getBoundingClientRect();
      return {
        inputHeight: inputRect.height,
        buttonHeight: buttonRect.height,
        inputCenter: inputRect.top + inputRect.height / 2,
        buttonCenter: buttonRect.top + buttonRect.height / 2,
        iconCenter: iconRect.top + iconRect.height / 2,
      };
    });
    expect(
      Math.abs(searchGeometry.inputHeight - searchGeometry.buttonHeight),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(searchGeometry.inputCenter - searchGeometry.iconCenter),
    ).toBeLessThanOrEqual(1);
    if (width >= 640) {
      expect(
        Math.abs(searchGeometry.inputCenter - searchGeometry.buttonCenter),
      ).toBeLessThanOrEqual(1);
    }
    await expect(real.getByText("On Circles", { exact: true })).toBeVisible();
    const suggestions = real.getByRole("region", {
      name: "Listener suggestions",
    });
    await expect(
      suggestions.getByRole("article", { name: "Drowse artist suggestion" }),
    ).toBeVisible();
    await expect(
      suggestions.getByRole("button", { name: "Search artist" }),
    ).toBeVisible();
    await expect(
      real.getByRole("radiogroup", { name: "Tidal download quality" }),
    ).toBeVisible();
    await real
      .getByRole("tablist", { name: "Search result provider" })
      .getByRole("tab", { name: "Soulseek" })
      .click();
    await expect(real.getByText("northstar", { exact: true })).toBeVisible({
      timeout: 5000,
    });

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });

  test(`Acquisition upload and follow-up panels remain usable at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-acquisition-demo.html");
    const real = page.getByRole("region", {
      name: "Página real de Acquisition",
      exact: true,
    });

    await real.getByRole("tab", { name: "Upload" }).click();
    const upload = real.getByRole("region", { name: "Upload music" });
    await expect(upload).toBeVisible();
    await upload.getByLabel("Choose music files").setInputFiles({
      name: "Sample Album.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("sample archive"),
    });
    await expect(upload.getByText("Sample Album.zip")).toBeVisible();
    await expect(
      real.getByRole("button", { name: "Add to library" }),
    ).toBeEnabled();

    await real.getByRole("tab", { name: /Queue/ }).click();
    const queue = real.getByRole("region", { name: "Active downloads" });
    await expect(
      queue.getByRole("article", { name: "On Circles" }),
    ).toBeVisible();
    await expect(
      queue.getByRole("progressbar", {
        name: "Dust and Disquiet download progress",
      }),
    ).toHaveAttribute("aria-valuenow", "42");

    await real.getByRole("tab", { name: /Wishlist/ }).click();
    const wishlist = real.getByRole("region", { name: "Download wishlist" });
    await expect(
      wishlist.getByRole("article", { name: "Dust and Disquiet" }),
    ).toBeVisible();

    await real.getByRole("tab", { name: "History" }).click();
    const history = real.getByRole("region", { name: "Download history" });
    await expect(
      history.getByRole("article", { name: "Waking Season" }),
    ).toBeVisible();
    await expect(
      history.getByRole("article", { name: "Lost Songs" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });

  test(`Tidal artist releases keep their actions visible at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/admin-acquisition-demo.html");
    const real = page.getByRole("region", {
      name: "Página real de Acquisition",
      exact: true,
    });
    await real.getByRole("button", { name: /browse albums/i }).click();

    const artistAlbums = real.getByRole("region", {
      name: "Caspian Tidal albums",
    });
    await expect(
      artistAlbums.getByRole("heading", { name: "Caspian on Tidal" }),
    ).toBeVisible();
    const localAlbum = artistAlbums.getByRole("article", {
      name: "On Circles Tidal album",
    });
    await expect(localAlbum).toContainText("Upgrade available");
    await expect(
      localAlbum.getByRole("button", { name: "Get upgrade" }),
    ).toBeVisible();
    await expect(
      localAlbum.getByRole("button", { name: "View tracks" }),
    ).toBeVisible();
    await expect(
      localAlbum.getByRole("button", { name: "Wishlist" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });
}
