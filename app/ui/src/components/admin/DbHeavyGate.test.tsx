import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DbHeavyGate } from "./DbHeavyGate";

describe("DbHeavyGate", () => {
  it.each([
    {
      gate: { active: 0, pending: 0, blocking: false },
      status: "Clear",
      message: "No DB-heavy serialization pressure right now.",
      tone: "on",
    },
    {
      gate: { active: 0, pending: 2, blocking: false },
      status: "Queued",
      message:
        "2 DB-heavy tasks queued. They will run one at a time once a DB-heavy slot is free.",
      tone: "warn",
    },
    {
      gate: { active: 1, pending: 1, blocking: true },
      status: "Blocking",
      message:
        "DB-heavy work is serialized right now: 1 running, 1 waiting. Free Dramatiq slots will stay idle until the gate clears.",
      tone: "warn",
    },
  ])("reports $status gate state", ({ gate, status, message, tone }) => {
    render(<DbHeavyGate gate={gate} />);

    expect(screen.getByRole("group", { name: "DB-heavy gate" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "DB-heavy gate" })).toHaveClass(
      "text-accent-action-hi",
    );
    expect(screen.getByRole("status")).toHaveTextContent(status);
    expect(screen.getByRole("status").firstElementChild).toHaveAttribute(
      "data-tone",
      tone,
    );
    expect(screen.getByText(message)).toHaveClass("text-sm", "leading-relaxed");
  });
});
