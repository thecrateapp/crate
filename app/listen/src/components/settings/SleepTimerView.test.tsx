import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SleepTimerView } from "./SleepTimerView";
it("keeps end-of-track cancellation available without a fabricated countdown", () => {
  const cancel = vi.fn();
  render(
    <SleepTimerView
      label="Sleep timer"
      value="end_of_track"
      options={[{ value: "end_of_track", label: "End of track" }]}
      onChange={vi.fn()}
      active
      cancelLabel="Cancel"
      onCancel={cancel}
    />,
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledOnce();
});
