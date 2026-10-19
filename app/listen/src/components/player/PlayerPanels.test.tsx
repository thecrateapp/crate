import { it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { PlayerPanels } from "./PlayerPanels";
it("uses text tabs with associated panels and changes the visible content", () => {
  function Harness() {
    const [value, setValue] = useState("player");
    return (
      <PlayerPanels
        value={value}
        onValueChange={setValue}
        label="Player panels"
        items={[
          { value: "player", label: "Now playing", content: <p>Artwork</p> },
          { value: "queue", label: "Queue", content: <p>Next tracks</p> },
        ]}
      />
    );
  }
  render(<Harness />);
  const first = screen.getByRole("tab", { name: "Now playing" });
  expect(screen.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    first.id,
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Queue" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Next tracks");
  expect(screen.queryByText("Artwork")).not.toBeInTheDocument();
});
