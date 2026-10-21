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

it("falls back to computed_until when built_at is missing", () => {
  vi.useFakeTimers({ now: new Date("2026-10-21T12:00:00Z") });
  renderWithListenProviders(
    <StatsFreshness snapshot={{}} computedUntil="2026-10-21T11:50:00Z" />,
    { locale: "en" },
  );
  expect(screen.getByText("Updated 10 minutes ago")).toBeVisible();
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

it.each([
  // FastAPI (pydantic) serialises TIMESTAMPTZ with microseconds and Z.
  ["FastAPI", "2026-10-21T11:56:00.318791Z"],
  // The Go read plane emits RFC3339Nano: a trimmed fraction, and an offset
  // when the process runs outside UTC.
  ["read plane", "2026-10-21T13:56:00.3187+02:00"],
])("parses the %s snapshot timestamp format", (_source, builtAt) => {
  vi.useFakeTimers({ now: new Date("2026-10-21T12:00:00Z") });
  renderWithListenProviders(
    <StatsFreshness snapshot={{ built_at: builtAt }} provisional={false} />,
    { locale: "en" },
  );
  expect(screen.getByText("Updated 4 minutes ago")).toBeVisible();
});
