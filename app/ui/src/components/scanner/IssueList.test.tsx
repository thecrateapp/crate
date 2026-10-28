import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { IssueList } from "./IssueList";
it("keeps severity and repair advice readable with a coloured severity level", () => {
  const { container } = render(
    <IssueList
      issues={[
        {
          type: "connection",
          severity: "critical",
          confidence: 90,
          description: "Service unavailable",
          suggestion: "Retry connection",
          paths: [],
          details: {},
        },
      ]}
    />,
  );
  expect(screen.getByText("critical")).toBeVisible();
  expect(screen.getByText("Service unavailable")).toBeVisible();
  expect(screen.getByText("Retry connection")).toBeVisible();
  expect(container.querySelector('[data-slot="severity"]')).toHaveAttribute(
    "data-tone",
    "critical",
  );
});
it("retains the empty state", () => {
  render(<IssueList issues={[]} />);
  expect(screen.getByText("No issues found")).toBeVisible();
});
