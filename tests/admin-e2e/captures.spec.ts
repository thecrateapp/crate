import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";
import { capturePage } from "../visual/screenshots";

const pages = [
  {
    name: "dashboard",
    path: "/",
    heading: "Dashboard",
    ready: ["Needs Attention"],
  },
  {
    name: "tasks",
    path: "/tasks",
    heading: "Tasks",
    ready: ["Artist Enrichment", "Converge - Love Is Not Enough"],
  },
  {
    name: "health",
    path: "/health",
    heading: "Library Health",
    ready: ["5 open issues"],
  },
  {
    name: "genres",
    path: "/genres",
    heading: "Genres",
    ready: [
      "Hardcore",
      "Effective EQ sources",
      "863 tracks resolved through the Smart EQ hierarchy.",
    ],
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
    ready: ["Library Runtime", "enrich_artists"],
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
