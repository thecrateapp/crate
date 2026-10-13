import { expect, test } from "./fixtures";

test.skip(
  ({ isMobile }) => isMobile,
  "Access rules are layout independent; the desktop hero exposes every action",
);

test("shows another user's public playlist read-only with follow and copy", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/playlist/42");
  await expect(page.getByRole("heading", { name: "Late shift" })).toBeVisible();

  const secondary = page.getByRole("group", {
    name: "Secondary playlist actions",
  });
  await expect(secondary.getByRole("button", { name: "Follow" })).toBeVisible();
  await expect(secondary.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(
    secondary.getByRole("button", { name: "Collaborators" }),
  ).toHaveCount(0);

  await page.getByTestId("hero-menu-trigger").click();
  await expect(
    page.getByRole("menuitem", { name: "Add to my playlists" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Delete playlist" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  const follow = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/playlists/42/follow",
  );
  await secondary.getByRole("button", { name: "Follow" }).click();
  await follow;
  await expect(page.getByText("You now follow Late shift.")).toBeVisible();
});

test("lets collaborators edit without owner-only actions", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/playlist/43");
  await expect(page.getByRole("heading", { name: "Van rides" })).toBeVisible();

  const secondary = page.getByRole("group", {
    name: "Secondary playlist actions",
  });
  await expect(secondary.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(secondary.getByRole("button", { name: "Follow" })).toHaveCount(
    0,
  );

  await page.getByTestId("hero-menu-trigger").click();
  await expect(
    page.getByRole("menuitem", { name: "Delete playlist" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Add to my playlists" }),
  ).toHaveCount(0);
});

test("separates shared and followed playlists in the library", async ({
  openListenPage,
  page,
}) => {
  await openListenPage("/library?tab=playlists");

  await expect(page.getByText("Shared with me")).toBeVisible();
  await expect(page.getByText("Following", { exact: true })).toBeVisible();
  await expect(page.getByText("Van rides")).toBeVisible();
  await expect(page.getByText("Late shift")).toBeVisible();
  await expect(page.getByText("Jane").first()).toBeVisible();
});
