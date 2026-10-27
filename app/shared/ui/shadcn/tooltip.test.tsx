import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "./button";
import {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

it("preserves focus, refs, description and click handlers with one custom tooltip", async () => {
  const click = vi.fn();
  const ref = { current: null as HTMLButtonElement | null };
  const { container } = render(
    <TooltipHint content="Helpful detail">
      <button ref={ref} onClick={click} aria-label="Save">
        Save
      </button>
    </TooltipHint>,
  );
  const button = screen.getByRole("button", { name: "Save" });
  expect(ref.current).toBe(button);
  expect(container.querySelector("[title]")).toBeNull();
  const user = userEvent.setup();
  await user.tab();
  expect(button).toHaveFocus();
  const tip = await screen.findByRole("tooltip", { name: "Helpful detail" });
  expect(button).toHaveAttribute("aria-describedby", tip.id);
  await user.keyboard("{Escape}{Enter}");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(click).toHaveBeenCalledTimes(1);
});

it("lets an existing Tooltip own nested compatibility hints", async () => {
  const { container } = render(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button title="Legacy title">Save</Button>
        </TooltipTrigger>
        <TooltipContent>Approved description</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  await userEvent.tab();
  expect(
    await screen.findByRole("tooltip", { name: "Approved description" }),
  ).toBeVisible();
  expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  expect(container.querySelector("[title]")).toBeNull();
});

it("stays closed when a dialog moves focus onto it after a click", async () => {
  render(
    <TooltipHint content="Genre source">
      <button>hardcore</button>
    </TooltipHint>,
  );
  const button = screen.getByRole("button", { name: "hardcore" });
  fireEvent.pointerDown(document.body);
  act(() => button.focus());
  expect(button).toHaveFocus();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("stays closed on a touch-only screen until the keyboard is used", async () => {
  vi.resetModules();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(hover: none)",
  }));
  try {
    const { TooltipHint: FreshTooltipHint } = await import("./tooltip");
    render(
      <FreshTooltipHint content="Close the player">
        <button>Close</button>
      </FreshTooltipHint>,
    );
    const button = screen.getByRole("button", { name: "Close" });
    act(() => button.focus());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => button.blur());
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => button.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Close the player",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("adds no wrapper or tab stop without content", () => {
  const { container } = render(
    <TooltipHint>
      <span>Visible label</span>
    </TooltipHint>,
  );
  expect(container.children).toHaveLength(1);
  expect(container.firstElementChild).toBe(screen.getByText("Visible label"));
  expect(container.querySelector("[tabindex]")).toBeNull();
});

it("does not describe a focused control with an empty hint", async () => {
  render(
    <TooltipHint>
      <button>Drag handle</button>
    </TooltipHint>,
  );
  await userEvent.tab();
  expect(
    screen.getByRole("button", { name: "Drag handle" }),
  ).not.toHaveAttribute("aria-describedby");
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("dismisses its hint when the drag owner has already handled Escape", async () => {
  const user = userEvent.setup();
  const capture = (event: KeyboardEvent) => {
    if (event.key === "Escape") event.preventDefault();
  };
  window.addEventListener("keydown", capture, true);
  try {
    render(
      <TooltipHint content="Reorder albums">
        <button>Drag handle</button>
      </TooltipHint>,
    );
    await user.tab();
    expect(
      await screen.findByRole("tooltip", { name: "Reorder albums" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  } finally {
    window.removeEventListener("keydown", capture, true);
  }
});
