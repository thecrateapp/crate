import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { RelativeTime } from "./RelativeTime";

it("reveals the absolute timestamp with the shared keyboard tooltip", async () => {
  const user = userEvent.setup();
  const value = "2026-10-23T10:00:00Z";
  const { container } = render(
    <RelativeTime value={value} now={Date.parse(value) + 60_000} />,
  );
  expect(container.querySelector("[title]")).toBeNull();
  expect(container.querySelector("time")).toHaveAttribute("datetime", value);
  await user.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    new Date(value).toLocaleString(),
  );
});

it("does not invent a timestamp when none can be parsed", () => {
  const { container } = render(<RelativeTime value="invalid" />);
  expect(container).toHaveTextContent("—");
  expect(container.querySelector("time")).toBeNull();
});
