import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { PlaylistTrackRequirements } from "./PlaylistTrackRequirements";

function ControlledRequirements() {
  const [value, setValue] = useState(false);
  return <PlaylistTrackRequirements value={value} onChange={setValue} />;
}

describe("PlaylistTrackRequirements", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("waits for confirmed server support before offering the requirement", async () => {
    let finish!: (capabilities: unknown) => void;
    apiMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ControlledRequirements />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    await act(async () => finish({ smart_mix: { available: true } }));

    expect(
      screen.getByRole("switch", { name: "Full Smart Mix profile only" }),
    ).not.toBeChecked();
    expect(apiMock).toHaveBeenCalledWith(
      "/api/capabilities",
      "GET",
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([{ smart_mix: { available: false } }, {}, { smart_mix: {} }])(
    "hides the option for an unsupported server (%j)",
    async (data) => {
      apiMock.mockResolvedValue(data);
      const onChange = vi.fn();
      const { container } = render(
        <PlaylistTrackRequirements value onChange={onChange} />,
      );
      await act(async () => {});

      expect(container).toBeEmptyDOMElement();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("hides failed capability requests without clearing a saved requirement", async () => {
    apiMock.mockRejectedValue(new Error("Offline"));
    const onChange = vi.fn();
    const { container } = render(
      <PlaylistTrackRequirements value onChange={onChange} />,
    );
    await act(async () => {});

    expect(container).toBeEmptyDOMElement();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the shared labelled switch, explains scope and supports keyboard changes", async () => {
    apiMock.mockResolvedValue({ smart_mix: { available: true } });
    render(<ControlledRequirements />);
    const control = await screen.findByRole("switch", {
      name: "Full Smart Mix profile only",
    });

    expect(control).toHaveAttribute("data-slot", "switch");
    expect(control.closest('[data-slot="form-field"]')).toHaveAttribute(
      "data-layout",
      "inline",
    );
    expect(control).toHaveAccessibleDescription(
      "Automatically selected tracks must have a current Full Smart Mix profile. Manually added and locked tracks are preserved.",
    );
    const caption = screen.getByText("Full Smart Mix profile only");
    expect(caption.closest("label")).toHaveAttribute("for", control.id);
    control.focus();
    await userEvent.keyboard(" ");
    expect(control).toBeChecked();
    await userEvent.click(caption);
    expect(control).not.toBeChecked();
  });

  it("keeps a saved checked state and disables changes while saving", async () => {
    apiMock.mockResolvedValue({ smart_mix: { available: true } });
    const onChange = vi.fn();
    render(<PlaylistTrackRequirements value onChange={onChange} disabled />);
    const control = await screen.findByRole("switch");

    expect(control).toBeChecked();
    expect(control).toBeDisabled();
    await userEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
