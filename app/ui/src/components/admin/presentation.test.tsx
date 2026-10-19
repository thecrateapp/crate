import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CopyButton } from "./CopyButton";
import { RelativeTime } from "./RelativeTime";
import { StatusBadge } from "./StatusBadge";
import { StructuredValue } from "./StructuredValue";
import { TechnicalDetails } from "./TechnicalDetails";

describe("RelativeTime", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");

  it("renders a past moment relative to now with a non-empty absolute title", () => {
    render(<RelativeTime value="2026-10-19T10:00:00Z" now={now} />);
    const time = screen.getByText("2 hours ago");
    expect(time.tagName).toBe("TIME");
    expect(time.getAttribute("title")).toBeTruthy();
  });

  it("renders a future moment relative to now", () => {
    render(<RelativeTime value="2026-10-19T12:12:00Z" now={now} />);
    expect(screen.getByText("in 12 minutes")).toBeInTheDocument();
  });

  it("renders a dash for a missing value", () => {
    render(<RelativeTime value={null} now={now} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders its children tagged with the tone", () => {
    render(<StatusBadge tone="warning">Needs approval</StatusBadge>);
    const badge = screen.getByText("Needs approval");
    expect(badge).toHaveAttribute("data-tone", "warning");
  });
});

describe("CopyButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows an error toast when the clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(<CopyButton value="abc" label="Plan" />);
    await user.click(screen.getByRole("button", { name: "Copy Plan" }));

    expect(toast.error).toHaveBeenCalledWith(
      "Could not copy. Select the text instead.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows an error toast when the clipboard write is rejected", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CopyButton value="abc" label="Plan" />);
    await user.click(screen.getByRole("button", { name: "Copy Plan" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not copy. Select the text instead.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a success toast when the clipboard write succeeds", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CopyButton value="abc" label="Plan" />);
    await user.click(screen.getByRole("button", { name: "Copy Plan" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copied"));
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("TechnicalDetails", () => {
  it("stays collapsed until toggled, shows values and copies one on request", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <TechnicalDetails
        items={[
          { label: "Plan", value: "abc" },
          { label: "Job", value: null },
        ]}
      />,
    );

    expect(screen.queryByText("abc")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Technical details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    const copyPlan = screen.getByRole("button", { name: "Copy Plan" });

    await user.click(copyPlan);

    expect(writeText).toHaveBeenCalledWith("abc");
  });
});

describe("StructuredValue", () => {
  it("renders nested structured content without raw JSON", () => {
    const { container } = render(
      <StructuredValue
        value={{
          artist_name: "Echo",
          lineup: ["A", "B"],
          tags: [{ name: "x" }],
          doors_time: null,
          public: true,
        }}
      />,
    );

    expect(screen.getByText("Artist name")).toBeInTheDocument();
    expect(screen.getByText("Echo")).toBeInTheDocument();
    expect(screen.getByText("A, B")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("x")).toBeInTheDocument();
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(container.textContent).not.toContain("[object Object]");
    expect(container.textContent).not.toContain("{");
  });
});
