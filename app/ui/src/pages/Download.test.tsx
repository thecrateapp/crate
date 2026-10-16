import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { refetch } = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ data: null, loading: false, error: null, refetch }),
}));
vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  apiSseUrl: (path: string) => path,
}));

import { DownloadPage } from "./Download";

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal(
    "EventSource",
    class {
      close() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("keeps Download's five real panels reachable after the shared tab restyle", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DownloadPage />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("tab")).toHaveLength(5);
  expect(
    screen.getByRole("tabpanel", { name: "Search Results" }),
  ).toBeVisible();
  screen.getByRole("tab", { name: "Search Results" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Upload" })).toHaveFocus();
  expect(screen.getByRole("tabpanel", { name: "Upload" })).toHaveTextContent(
    "Upload music into the library",
  );
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tabpanel", { name: "Queue" })).toBeVisible();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tabpanel", { name: "Wishlist" })).toBeVisible();
  await user.keyboard("{End}");
  expect(screen.getByRole("tabpanel", { name: "History" })).toBeVisible();
  await user.keyboard("{Home}");
  expect(
    screen.getByRole("tabpanel", { name: "Search Results" }),
  ).toBeVisible();
});
