import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { PlanApprovalNote } from "./PlanApprovalNote";

const planId = "d105bd45-92c0-4f99-b12a-bb1cc8910fa1";

it.each([
  [
    "change",
    "This change needs approval. Approve it in Agent approvals, then save it here.",
  ],
  [
    "merge",
    "A merge always needs approval. Approve it in Agent approvals, then come back and merge.",
  ],
] as const)(
  "links a %s to Agent approvals for an editor who can approve",
  (subject, text) => {
    renderWithAdminProviders(
      <PlanApprovalNote planId={planId} subject={subject} />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(text);
    const link = screen.getByRole("link", { name: "Open in Agent approvals" });
    expect(link).toHaveAttribute("href", `/agents/approvals/${planId}`);
    expect(link).toHaveAttribute("target", "_blank");
  },
);

it.each([
  [
    "change",
    "This change needs approval. Someone who can approve changes must approve it in Agent approvals. Then come back and save.",
  ],
  [
    "merge",
    "A merge always needs approval. Someone who can approve changes must approve it in Agent approvals. Then come back and merge.",
  ],
] as const)(
  "tells an editor who can't approve a %s who has to, without a link",
  (subject, text) => {
    renderWithAdminProviders(
      <PlanApprovalNote planId={planId} subject={subject} />,
      {
        auth: {
          hasCapability: (capability: string) =>
            capability !== "agents.plans.review",
        },
      },
    );
    expect(screen.getByRole("note")).toHaveTextContent(text);
    expect(screen.queryByRole("link")).toBeNull();
  },
);
