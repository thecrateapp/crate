/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: fine"),
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

describe("docs app", () => {
  it("publishes operator candidate authority, provisioning and rollback", async () => {
    window.history.pushState(null, "", "/operations/hermes-operator-release");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Crate Operator candidate and rollout",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Root-managed provisioning for one future rollout",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Version transition, health and rollback",
      }),
    ).toBeTruthy();
  });

  it("publishes the Crate Agent and Crate Operator Telegram guide", async () => {
    window.history.pushState(null, "", "/operations/crate-agent");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Crate Agent and Crate Operator over Telegram",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Create the Telegram bot" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Approvals in Telegram" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Troubleshooting" }),
    ).toBeTruthy();
  });

  it("publishes the 2.7 to 3.0 upgrade guide", async () => {
    window.history.pushState(null, "", "/operations/upgrade-v2-to-v3");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Upgrade from 2.7 to 3.0",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Upgrade a home install" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Move the agent pilots" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Roll back" })).toBeTruthy();
  });

  it("publishes independent operator delivery and human callback boundaries", async () => {
    window.history.pushState(null, "", "/operations/independent-operator");
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Independent deterministic operator",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Native human decision integration boundary",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "External watchdog" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "MCP observations" })
        .getAttribute("href"),
    ).toBe("/architecture/agents-and-mcp");
  });

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
    expect(
      screen.getByRole("heading", { name: "Schedule audit" }),
    ).toBeTruthy();
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
      heading: "Smart Mix: how it works and how to operate it",
      linkName: "continuation plan",
      linkedRoute: "/developer/smart-mix-continuation",
    },
    {
      route: "/architecture/smart-mix",
      heading:
        "Smart Mix, native Android crossfade and VirtualDJ: unified design",
      linkName: "implementation plan",
      linkedRoute: "/developer/smart-mix-continuation",
    },
    {
      route: "/developer/smart-mix-continuation",
      heading: "Smart Mix, native Android and VirtualDJ: continuation plan",
      linkName: "unified design",
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

  it("links the site navigation back to cratemusic.app with Docs current", () => {
    render(<App />);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary)
        .getByRole("link", { name: "Listen" })
        .getAttribute("href"),
    ).toBe("https://cratemusic.app/listen");
    expect(
      within(primary)
        .getByRole("link", { name: "Docs" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("matches the website navigation, with the manifesto first and Install highlighted", () => {
    render(<App />);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    const labels = within(primary)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "Manifesto",
      "Listen",
      "Admin",
      "Architecture",
      "Developers",
      "Install",
      "Docs",
      "GitHub",
    ]);
    const install = within(primary).getByRole("link", { name: "Install" });
    expect(install.getAttribute("href")).toBe("https://cratemusic.app/install");
    expect(install.className).toContain("is-accent");
  });

  it("shows the website's record shop backdrop behind the docs", () => {
    const { container } = render(<App />);

    const backdrop = container.querySelector(".backdrop");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.querySelector("img")?.getAttribute("src")).toBe(
      "/backdrop/shop-1920.jpg",
    );
  });

  it("scrambles the mono navigation labels on hover like the website", () => {
    render(<App />);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    const listen = within(primary).getByRole("link", { name: "Listen" });
    const label = listen.querySelector<HTMLElement>("[data-hover-scramble]");
    expect(label?.textContent).toBe("Listen");

    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    fireEvent.mouseOver(listen, { relatedTarget: document.body });
    expect(frames).toHaveLength(1);
    for (let now = 16; frames.length; now += 16) frames.shift()!(now);

    expect(label?.textContent).toBe("Listen");
  });

  it("marks the current document in the sidebar", async () => {
    window.history.pushState(null, "", "/federation/federation-overview");
    render(<App />);

    const index = screen.getByRole("navigation", { name: "Documentation" });
    expect(
      within(index)
        .getByRole("link", { name: "Federation overview" })
        .getAttribute("aria-current"),
    ).toBe("page");
    await screen.findByRole("heading", {
      name: /federation overview/i,
      level: 1,
    });
  });

  it("filters the documentation index from the search box", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Search documentation"), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.getByText(/no documents match/i)).toBeTruthy();
  });

  it("opens the mobile menu as a dialog and closes it with Escape", () => {
    render(<App />);

    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    expect(document.documentElement.classList.contains("menu-open")).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(document.documentElement.classList.contains("menu-open")).toBe(
      false,
    );
  });

  it("scrolls the sidebar to the current document when it is out of view", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("aria-current") === "page" ? 1200 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    window.history.pushState(null, "", "/federation/federation-overview");
    const { container } = render(<App />);

    expect(container.querySelector<HTMLElement>(".sidebar")?.scrollTop).toBe(
      1000,
    );
  });

  it("scrolls to the top when navigating to another document", () => {
    const scrollTo = vi.fn();
    vi.spyOn(window, "scrollTo").mockImplementation(scrollTo);
    window.history.pushState(null, "", "/start/quickstart");
    render(<App />);
    expect(scrollTo).not.toHaveBeenCalled();

    const index = screen.getByRole("navigation", { name: "Documentation" });
    fireEvent.click(
      within(index).getByRole("link", { name: "Development setup" }),
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("scrolls a deep link to its anchor once the document has loaded", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    window.history.pushState(
      null,
      "",
      "/federation/federation-overview#architecture",
    );
    render(<App />);

    await waitFor(() => expect(scrolled).toEqual(["architecture"]));
  });
});
