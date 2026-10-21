import { screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StatsFreshness } from "./StatsFreshness";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

afterEach(() => vi.useRealTimers());

it("shows relative update time and counting state", () => {
  vi.useFakeTimers({ now: new Date("2026-10-21T12:00:00Z") });
  renderWithListenProviders(
    <StatsFreshness
      snapshot={{ built_at: "2026-10-21T11:56:00Z" }}
      computedUntil="2026-10-21"
      provisional
    />,
    { locale: "en" },
  );
  expect(
    screen.getByText("Updated 4 minutes ago · today still counting"),
  ).toBeVisible();
});

it("renders nothing without built_at and omits counting when final", () => {
  vi.useFakeTimers({ now: new Date("2026-10-21T12:00:00Z") });
  const { container, unmount } = renderWithListenProviders(
    <StatsFreshness snapshot={{}} provisional={false} />,
    { locale: "en" },
  );
  expect(container.querySelector("p")).toBeNull();
  unmount();
  renderWithListenProviders(
    <StatsFreshness
      snapshot={{ built_at: "2026-10-21T09:00:00Z" }}
      provisional={false}
    />,
    { locale: "en" },
  );
  expect(screen.getByText("Updated 3 hours ago")).toBeVisible();
});
