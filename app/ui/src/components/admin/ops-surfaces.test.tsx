import { ChevronDown } from "lucide-react";
import { Button } from "@crate/ui/shadcn/button";
import { cleanup, render, screen } from "@testing-library/react";

import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { OpsPageHero, OpsPanel, OpsStatTile } from "./ops-surfaces";

describe("OpsStatTile status colours", () => {
  it.each([
    ["success", "text-accent-action-hi"],
    ["danger", "text-state-warning-text"],
    ["warning", "text-state-warning-text"],
    ["primary", "text-text-primary"],
    ["default", "text-text-primary"],
  ] as const)(
    "keeps %s meaning and readable value on semantic colours",
    (tone, valueClass) => {
      render(
        <OpsStatTile
          label="Failed jobs"
          value="12"
          caption="Last hour"
          tone={tone}
        />,
      );
      expect(screen.getByText("12")).toHaveClass(valueClass);
      expect(screen.getByText("Failed jobs")).toBeVisible();
      expect(screen.getByText("Last hour")).toBeVisible();
    },
  );
});

it("keeps the V3 page display, ruled-panel caption and metric hierarchy", () => {
  render(
    <>
      <OpsPageHero title="Analysis" description="Body copy" />
      <OpsPanel title="Coverage">Content</OpsPanel>
      <OpsStatTile label="Tracks" value="1,200" />
    </>,
  );
  expect(screen.getByRole("heading", { name: "Analysis" })).toHaveClass(
    "font-display",
    "font-extrabold",
  );
  expect(screen.getByRole("heading", { name: "Coverage" })).toHaveClass(
    "font-mono",
    "font-normal",
    "uppercase",
  );
  expect(screen.getByText("Tracks")).toHaveClass("font-mono", "font-normal");
  expect(screen.getByText("1,200")).toHaveClass("font-display", "tabular-nums");
  expect(screen.getByText("Body copy")).not.toHaveClass(
    "font-display",
    "font-mono",
  );
});

describe("Admin operational surfaces without decorative glyphs", () => {
  it("uses the shared named ruled panel with associated description", () => {
    render(
      <OpsPanel
        title="Queue"
        description="Current work"
        action={<button type="button">Refresh</button>}
      >
        <span>2 jobs</span>
      </OpsPanel>,
    );
    const panel = screen.getByRole("region", { name: "Queue" });
    expect(panel).toHaveAccessibleDescription("Current work");
    expect(panel).toContainElement(
      screen.getByRole("heading", { name: "Queue", level: 2 }),
    );
    expect(panel).toContainElement(
      screen.getByRole("button", { name: "Refresh" }),
    );
  });
  it("keeps the page heading, description, children and action while removing the hero glyph", async () => {
    const action = vi.fn();
    const { container } = render(
      <OpsPageHero
        title="Tasks"
        description="Background jobs"
        className="custom-hero"
        actions={<button onClick={action}>Refresh</button>}
      >
        <span>Connected</span>
      </OpsPageHero>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeVisible();
    expect(screen.getByText("Background jobs")).toBeVisible();
    expect(screen.getByText("Connected")).toBeVisible();
    expect(container.firstChild).toHaveClass("custom-hero");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh" }));
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps values including zero and ReactNode captions without the stat glyph", () => {
    const { container } = render(
      <OpsStatTile
        label="Queued"
        value={0}
        caption={<span>Waiting for work</span>}
        className="custom-stat"
      />,
    );
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("Queued")).toBeVisible();
    expect(screen.getByText("Waiting for work")).toBeVisible();
    expect(container.firstChild).toHaveClass("custom-stat");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps panel actions and content usable while removing only the panel glyph", async () => {
    const action = vi.fn();
    const { container } = render(
      <OpsPanel
        title="Worker control"
        description="Queue details"
        className="custom-panel"
        action={<button onClick={action}>Show details</button>}
      >
        <a href="/tasks?tab=running">Running tasks</a>
      </OpsPanel>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Worker control" }),
    ).toBeVisible();
    expect(screen.getByText("Queue details")).toBeVisible();
    expect(screen.getByRole("link", { name: "Running tasks" })).toHaveAttribute(
      "href",
      "/tasks?tab=running",
    );
    expect(container.firstChild).toHaveClass("custom-panel");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show details" }));
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector("svg")).toBeNull();
  });
});

it("preserves functional disclosure and loading glyphs supplied by action slots", () => {
  const { container } = render(
    <OpsPanel
      title="Queues"
      action={
        <button aria-expanded={false}>
          Details
          <ChevronDown aria-hidden="true" />
        </button>
      }
    >
      <Button loading>Refreshing</Button>
    </OpsPanel>,
  );
  expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(screen.getByRole("button", { name: "Refreshing" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refreshing" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(container.querySelectorAll("svg")).toHaveLength(2);
});

afterEach(cleanup);
describe("OpsPageHero header layout opt-in", () => {
  it("preserves the legacy contract for unreviewed consumers", () => {
    const { container } = render(
      <OpsPageHero
        title="Tasks"
        description="Existing description"
        actions={<button>Existing action</button>}
      >
        <span>Existing status</span>
      </OpsPageHero>,
    );
    expect(
      container.querySelector('[data-slot="admin-page-header"]'),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Existing action" }).parentElement,
    ).toHaveClass("xl:justify-end");
    expect(screen.getByRole("heading", { name: "Tasks" })).toHaveClass(
      "font-display",
    );
    expect(screen.getByText("Existing status")).toBeVisible();
  });
  it("opts reviewed pages into the common composition without dropping identity or actions", () => {
    const { container } = render(
      <OpsPageHero
        compactActions
        title="Analysis"
        description="Existing description"
        actions={<button>Existing action</button>}
      >
        <span>Existing status</span>
      </OpsPageHero>,
    );
    const header = container.querySelector('[data-slot="admin-page-header"]')!;
    expect(header).toContainElement(
      screen.getByRole("button", { name: "Existing action" }),
    );
    expect(header).toContainElement(
      screen.getByRole("heading", { name: "Analysis" }),
    );
    expect(header).toContainElement(screen.getByText("Existing description"));
    expect(header).toContainElement(screen.getByText("Existing status"));
  });
});
