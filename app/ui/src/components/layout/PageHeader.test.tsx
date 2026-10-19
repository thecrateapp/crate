import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router";
import {
  PageHeaderAction,
  PageHeaderActions,
  PageHeaderLayout,
} from "./PageHeader";
afterEach(cleanup);
describe("Admin page header composition", () => {
  it("preserves the existing asChild router-link contract", async () => {
    function Route() {
      return <output>{useLocation().pathname}</output>;
    }
    render(
      <MemoryRouter>
        <PageHeaderActions>
          <PageHeaderAction asChild label="Open album">
            <Link to="/albums/42">
              <svg aria-hidden="true" />
            </Link>
          </PageHeaderAction>
        </PageHeaderActions>
        <Route />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Open album" });
    expect(link).toHaveAttribute("href", "/albums/42");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("/albums/42");
  });
  it("names compact actions, keeps native button semantics, keyboard tooltip and callback", async () => {
    const click = vi.fn();
    render(
      <PageHeaderActions>
        <PageHeaderAction label="Refresh metrics" onClick={click}>
          <svg aria-hidden="true" />
        </PageHeaderAction>
      </PageHeaderActions>,
    );
    const button = screen.getByRole("button", { name: "Refresh metrics" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-size", "icon-lg");
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button.textContent).toBe("");
    const user = userEvent.setup();
    await user.tab();
    expect(button).toHaveFocus();
    const tip = await screen.findByRole("tooltip", { name: "Refresh metrics" });
    expect(tip).toBeVisible();
    expect(button).toHaveAttribute("aria-describedby", tip.id);
    await user.keyboard("{Escape}{Enter}");
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("keeps an object-specific accessible name with an action-only tooltip", async () => {
    render(
      <PageHeaderActions>
        <PageHeaderAction label="Edit Costa de noche" tooltip="Edit">
          <svg aria-hidden="true" />
        </PageHeaderAction>
      </PageHeaderActions>,
    );
    const button = screen.getByRole("button", { name: "Edit Costa de noche" });
    expect(button).toHaveAttribute("title", "Edit");
    await userEvent.tab();
    expect(
      await screen.findByRole("tooltip", { name: /^Edit$/ }),
    ).toBeVisible();
  });
  it("makes a disabled action name discoverable by keyboard without allowing execution", async () => {
    const click = vi.fn();
    render(
      <PageHeaderActions>
        <PageHeaderAction label="Sync collection" disabled onClick={click}>
          <svg aria-hidden="true" />
        </PageHeaderAction>
      </PageHeaderActions>,
    );
    const button = screen.getByRole("button", { name: "Sync collection" });
    expect(button).toBeDisabled();
    const user = userEvent.setup();
    await user.tab();
    expect(
      screen.getByRole("group", { name: "Sync collection" }),
    ).toHaveFocus();
    expect(
      await screen.findByRole("tooltip", { name: "Sync collection" }),
    ).toBeVisible();
    await user.keyboard("{Enter} ");
    expect(click).not.toHaveBeenCalled();
  });
  it("keeps the native button node while availability changes", () => {
    const action = (disabled: boolean) => (
      <PageHeaderActions>
        <PageHeaderAction label="Refresh metrics" disabled={disabled}>
          <svg aria-hidden="true" />
        </PageHeaderAction>
      </PageHeaderActions>
    );
    const { rerender } = render(action(false));
    const button = screen.getByRole("button", { name: "Refresh metrics" });
    rerender(action(true));
    expect(screen.getByRole("button", { name: "Refresh metrics" })).toBe(
      button,
    );
    expect(button).toBeDisabled();
    rerender(action(false));
    expect(screen.getByRole("button", { name: "Refresh metrics" })).toBe(
      button,
    );
    expect(button).toBeEnabled();
  });
  it("forwards busy, disabled and pressed state and updates a dynamic action name", async () => {
    const click = vi.fn();
    const { rerender } = render(
      <PageHeaderActions>
        <PageHeaderAction
          label="Pause live"
          onClick={click}
          disabled
          aria-busy="true"
          aria-pressed="true"
        >
          <svg aria-hidden="true" />
        </PageHeaderAction>
      </PageHeaderActions>,
    );
    const button = screen.getByRole("button", { name: "Pause live" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    rerender(
      <PageHeaderActions>
        <PageHeaderAction label="Resume live" onClick={click}>
          <svg aria-hidden="true" />
        </PageHeaderAction>
      </PageHeaderActions>,
    );
    expect(screen.getByRole("button", { name: "Resume live" })).toBeEnabled();
  });
  it("preserves identity/artwork and omits an unavailable action group", () => {
    render(
      <PageHeaderLayout
        as="header"
        artwork={<img alt="Playlist artwork" />}
        actions={<PageHeaderActions>{null}</PageHeaderActions>}
      >
        <h1>Playlist</h1>
        <p>Metadata</p>
      </PageHeaderLayout>,
    );
    expect(screen.getByRole("heading", { name: "Playlist" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Playlist artwork" })).toBeVisible();
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByText("Metadata")).toBeVisible();
  });
});
