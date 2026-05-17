import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/radio", () => ({
  sendRadioFeedback: vi.fn(() => Promise.resolve()),
}));

import { sendRadioFeedback } from "@/lib/radio";
import { RadioFeedback } from "@/components/player/RadioFeedback";

const mockSendRadioFeedback = vi.mocked(sendRadioFeedback);

describe("RadioFeedback", () => {
  beforeEach(() => {
    mockSendRadioFeedback.mockClear();
  });

  it("skips to the next track immediately on dislike", async () => {
    const onDislike = vi.fn();

    render(
      <RadioFeedback sessionId="sess-1" trackId={42} onDislike={onDislike} />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Less like this"));

    expect(mockSendRadioFeedback).toHaveBeenCalledWith("sess-1", 42, "dislike");
    expect(onDislike).toHaveBeenCalledTimes(1);
  });
});
