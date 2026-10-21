/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App";

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
});

describe("docs app", () => {
  it("publishes the exact acquisition and schedule operator flow", async () => {
    window.history.pushState(null, "", "/operations/crate-mcp-acquisition");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Reviewed MCP acquisition and schedule boundaries",
        level: 1,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Operator flow" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Schedule audit" })).toBeTruthy();
  });

  it("publishes AI configuration with native controls and operational limits", async () => {
    window.history.pushState(null, "", "/operations/ai-agents");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "AI agents configuration",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Credential storage and rotation" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Limits and metering" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "MCP integrations" })
        .getAttribute("href"),
    ).toBe("/architecture/agents-and-mcp");
  });

  it("publishes the MCP architecture guide with operational reading paths", async () => {
    window.history.pushState(null, "", "/architecture/agents-and-mcp");
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Agents and MCP", level: 1 }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "connection and operations" })
        .getAttribute("href"),
    ).toBe("/operations/crate-mcp");
    expect(
      screen
        .getByRole("link", { name: "contract and acceptance" })
        .getAttribute("href"),
    ).toBe("/operations/crate-mcp-distribution");
  });

  it("publishes the MCP distribution guide and links back to connection guidance", async () => {
    window.history.pushState(null, "", "/operations/crate-mcp-distribution");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Crate MCP distribution and acceptance",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("link", {
          name: "connection guide",
        }) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/operations/crate-mcp");
    expect(
      (
        screen.getByRole("link", {
          name: "distributable JSON contract",
        }) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toMatch(/^\//);
  });

  it("renders the home page", () => {
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /start with the system overview/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /source on github/i }),
    ).toBeTruthy();
  });

  it("groups canonical documents by their published section", () => {
    window.history.pushState(null, "", "/federation");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /federation documentation/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/database index audit/i)).toBeNull();
  });

  it("renders a federation deep link and resolves its Markdown links", async () => {
    window.history.pushState(null, "", "/federation/federation-overview");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /federation overview/i }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("link", {
          name: /federation production acceptance/i,
        }) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/federation/federation-production-acceptance");
  });

  it.each([
    {
      route: "/operations/smart-mix",
      heading: "Smart Mix: funcionamiento y operación",
      linkName: "plan de continuación",
      linkedRoute: "/developer/smart-mix-continuation",
    },
    {
      route: "/architecture/smart-mix",
      heading:
        "Smart Mix, crossfade Android nativo y VirtualDJ: diseño unificado",
      linkName: "plan de implementación",
      linkedRoute: "/developer/smart-mix-continuation",
    },
    {
      route: "/developer/smart-mix-continuation",
      heading: "Smart Mix, Android nativo y VirtualDJ: plan de continuación",
      linkName: "diseño unificado",
      linkedRoute: "/architecture/smart-mix",
    },
  ])(
    "renders $route and resolves its reciprocal Markdown link",
    async ({ route, heading, linkName, linkedRoute }) => {
      window.history.pushState(null, "", route);
      render(<App />);

      expect(
        await screen.findByRole("heading", { level: 1, name: heading }),
      ).toBeTruthy();
      expect(
        (
          screen.getByRole("link", { name: linkName }) as HTMLAnchorElement
        ).getAttribute("href"),
      ).toBe(linkedRoute);
    },
  );

  it("does not publish historical technical audit routes", () => {
    window.history.pushState(
      null,
      "",
      "/technical/2026-04-22-database-index-audit",
    );
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
  });

  it("redirects to home for unknown doc routes", () => {
    window.history.pushState(null, "", "/nonexistent/nope");
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
  });
});
