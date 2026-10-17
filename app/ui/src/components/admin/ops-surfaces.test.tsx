import { render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import { describe, expect, it } from "vitest";
import { OpsStatTile } from "./ops-surfaces";

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
          icon={Activity}
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
