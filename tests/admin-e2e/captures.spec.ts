import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";
import { capturePage } from "../visual/screenshots";

const pages = [
  {
    name: "dashboard",
    path: "/",
    heading: "Dashboard",
    ready: ["No service interruption reported."],
  },
  {
    name: "tasks",
    path: "/tasks",
    heading: "Tasks",
    ready: ["Artist Enrichment", "Task desk"],
  },
  {
    name: "health",
    path: "/health",
    heading: "Library Health",
    ready: ["5 recorded issues"],
  },
  {
    name: "genres",
    path: "/genres",
    heading: "Genres",
    ready: ["Rock", "Genre EQ coverage", "94 taxonomy nodes"],
  },
  {
    name: "album",
    path: "/artists/quicksand/quicksand-crystallize",
    heading: "Crystallize",
    ready: ["Tracks"],
  },
  {
    name: "settings",
    path: "/settings",
    heading: "Settings",
    ready: [
      "Core library path, storage layout and current footprint.",
      "enrich_artists",
    ],
  },
  {
    name: "system",
    path: "/system",
    heading: "System Health",
    ready: ["48ms"],
  },
] as const;

test.beforeEach(async ({ page }) => {
  await prepareAdminCapture(page);
});

for (const specimen of pages) {
  test(`captures ${specimen.name} before Admin adoption`, async ({
    openAdminPage,
    page,
  }, info) => {
    await openAdminPage(specimen.path);
    await expect(
      page.getByRole("heading", { name: specimen.heading, exact: true }),
    ).toBeVisible();
    for (const text of specimen.ready) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
    await capturePage(page, info, `admin-${specimen.name}`, { fullPage: true });
  });
}
