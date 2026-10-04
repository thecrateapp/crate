import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { HeroActionBar, PageHero } from "./index";

let isDesktop = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => true,
}));

beforeEach(() => {
  isDesktop = true;
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("PageHero", () => {
  it("labels the hero section with its h1 title", () => {
    render(<PageHero title="In Rainbows" />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "In Rainbows",
    });
    expect(
      screen.getByRole("region", { name: "In Rainbows" }),
    ).toContainElement(heading);
  });

  it("renders eyebrow, subtitle, description, artwork and meta without separators by default", () => {
    render(
      <PageHero
        title="Album"
        eyebrow={<span>Pre-release</span>}
        subtitle={<span>Radiohead</span>}
        description="Tenth anniversary edition"
        artwork={<img alt="cover" src="/cover.jpg" />}
        meta={["2007", null, "10 tracks"]}
      />,
    );

    expect(screen.getByText("Pre-release")).toBeInTheDocument();
    expect(screen.getByText("Radiohead")).toBeInTheDocument();
    expect(screen.getByText("Tenth anniversary edition")).toBeInTheDocument();
    expect(screen.getByTestId("page-hero-artwork")).toContainElement(
      screen.getByAltText("cover"),
    );
    const meta = screen.getByTestId("page-hero-meta");
    expect(meta).toHaveTextContent("200710 tracks");
  });

  it("uses slash separators for editorial heroes and hides artwork", () => {
    render(
      <PageHero
        variant="editorial"
        title="Post-punk"
        artwork={<span>art</span>}
        meta={["12 artists", "40 albums"]}
      />,
    );

    expect(screen.getByTestId("page-hero-meta")).toHaveTextContent(
      "12 artists/40 albums",
    );
    expect(screen.queryByTestId("page-hero-artwork")).not.toBeInTheDocument();
  });

  it("renders the background via render prop with the treatment classes", () => {
    const renderBackground = vi.fn((className: string) => (
      <img alt="" data-testid="bg" className={className} src="/bg.jpg" />
    ));
    render(
      <PageHero
        title="Crate"
        background={{ render: renderBackground, treatment: "blur" }}
      />,
    );

    expect(screen.getByTestId("page-hero-background")).toHaveAttribute(
      "data-treatment",
      "blur",
    );
    expect(screen.getByTestId("bg")).toHaveClass("blur-2xl");
  });

  it("renders actions below the hero, and inside the card for card heroes", () => {
    const { rerender } = render(
      <PageHero title="Album" actions={<button type="button">Play</button>} />,
    );
    expect(
      within(screen.getByRole("region", { name: "Album" })).queryByRole(
        "button",
      ),
    ).not.toBeInTheDocument();

    rerender(
      <PageHero
        variant="card"
        title="Profile"
        actions={<button type="button">Follow</button>}
      />,
    );
    expect(
      within(screen.getByRole("region", { name: "Profile" })).getByRole(
        "button",
        {
          name: "Follow",
        },
      ),
    ).toBeInTheDocument();
  });
});

describe("HeroActionBar", () => {
  it("renders primary and secondary actions and calls their handlers", async () => {
    const onPlay = vi.fn();
    const onRadio = vi.fn();
    render(
      <HeroActionBar
        primaryActions={[
          { key: "play", label: "Play", onClick: onPlay },
          { key: "shuffle", label: "Shuffle", tone: "neutral", disabled: true },
        ]}
        secondaryActions={[
          { key: "radio", label: "Radio", onClick: onRadio, active: true },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeDisabled();

    const radio = screen.getByRole("button", { name: "Radio" });
    expect(radio).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(radio);
    expect(onRadio).toHaveBeenCalledTimes(1);
  });

  it("marks loading primary actions busy", () => {
    render(
      <HeroActionBar
        primaryActions={[{ key: "play", label: "Play", loading: true }]}
      />,
    );

    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("exposes labelled action groups only when labels are provided", () => {
    const { rerender } = render(
      <HeroActionBar
        primaryActions={[{ key: "play", label: "Play" }]}
        secondaryActions={[{ key: "radio", label: "Radio" }]}
      />,
    );
    expect(screen.queryByRole("group")).not.toBeInTheDocument();

    rerender(
      <HeroActionBar
        primaryActions={[{ key: "play", label: "Play" }]}
        secondaryActions={[{ key: "radio", label: "Radio" }]}
        primaryLabel="Primary actions"
        secondaryLabel="Secondary actions"
      />,
    );
    expect(
      within(screen.getByRole("group", { name: "Primary actions" })).getByRole(
        "button",
        { name: "Play" },
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("group", { name: "Secondary actions" }),
      ).getByRole("button", { name: "Radio" }),
    ).toBeInTheDocument();
  });

  it("renders a labelled inline more button on desktop that opens the menu", async () => {
    const onShare = vi.fn();
    render(
      <HeroActionBar
        moreLabel="Más"
        menu={{
          actions: [{ key: "share", label: "Share", onSelect: onShare }],
        }}
      />,
    );

    const trigger = screen.getByTestId("hero-menu-trigger");
    expect(trigger).toHaveAccessibleName("Más");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: /Share/ }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("portals a single fixed more trigger to the body on mobile", () => {
    isDesktop = false;
    const { container } = render(
      <HeroActionBar
        menu={{
          actions: [{ key: "share", label: "Share", onSelect: vi.fn() }],
        }}
      />,
    );

    const triggers = screen.getAllByRole("button", { name: "More" });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toHaveAttribute(
      "data-testid",
      "hero-mobile-menu-trigger",
    );
    expect(container).not.toContainElement(triggers[0]);
  });

  it("omits the menu trigger when the menu has no actionable entries", () => {
    render(
      <HeroActionBar menu={{ actions: [{ type: "divider", key: "d" }] }} />,
    );
    expect(
      screen.queryByRole("button", { name: "More" }),
    ).not.toBeInTheDocument();
  });
});
