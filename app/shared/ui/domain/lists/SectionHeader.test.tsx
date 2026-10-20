import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SectionActionButton, SectionHeader } from "./SectionHeader";

it("keeps section context and zero subtitle/count visible with native heading naming", () => {
  render(
    <section aria-labelledby="album-heading">
      <SectionHeader
        id="album-heading"
        title="Albums"
        eyebrow="Collection"
        subtitle={0}
        count={0}
      />
    </section>,
  );
  expect(screen.getByText("Collection")).toBeVisible();
  expect(screen.getByRole("region", { name: "Albums" })).toBeVisible();
  expect(screen.getAllByText("0")).toHaveLength(2);
});

it("uses an accent MonoLabel for the section action and retains its callback", () => {
  const onAction = vi.fn();
  render(
    <SectionHeader title="Albums" actionLabel="View All" onAction={onAction} />,
  );
  const action = screen.getByRole("button", { name: "View All" });
  expect(screen.getByText("View All")).toHaveClass(
    "font-mono",
    "uppercase",
    "text-accent-action-hi",
  );
  expect(action).toHaveClass("min-h-11", "p-0");
  fireEvent.click(action);
  expect(onAction).toHaveBeenCalledOnce();
});

it("replaces the action arrow with a decorative glowing accent dot", () => {
  render(
    <SectionHeader title="Albums" actionLabel="View All" onAction={() => {}} />,
  );
  const action = screen.getByRole("button", { name: "View All" });
  const dot = action.querySelector(".crate-status-dot");
  expect(dot).toHaveAttribute("aria-hidden", "true");
  expect(dot?.parentElement).toHaveClass(
    "text-accent-action-hi",
    "drop-shadow-accent-action",
  );
  expect(action.querySelector("svg")).toBeNull();
});

it("retains native action props, disabled behavior and refs without a button inset", () => {
  const onClick = vi.fn();
  const ref = { current: null as HTMLButtonElement | null };
  const { rerender } = render(
    <SectionActionButton ref={ref} disabled onClick={onClick}>
      Show more
    </SectionActionButton>,
  );
  const action = screen.getByRole("button", { name: "Show more" });
  expect(ref.current).toBe(action);
  expect(action).toHaveAttribute("type", "button");
  expect(action).toHaveClass("p-0", "min-h-11");
  fireEvent.click(action);
  expect(onClick).not.toHaveBeenCalled();
  rerender(
    <SectionActionButton ref={ref} onClick={onClick}>
      Show more
    </SectionActionButton>,
  );
  fireEvent.click(action);
  expect(onClick).toHaveBeenCalledOnce();
});
