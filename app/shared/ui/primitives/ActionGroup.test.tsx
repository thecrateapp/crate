import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionButton, ActionGroup, ActionLink } from "./ActionGroup";

describe("ActionGroup", () => {
  it("preserves a router-compatible child while loading and blocks its activation", () => {
    const click = vi.fn();
    render(
      <ActionGroup>
        <ActionButton asChild loading label="Open playlist">
          <a href="#destination" onClick={click}>
            <svg />
          </a>
        </ActionButton>
      </ActionGroup>,
    );
    const link = screen.getByRole("link", { name: "Open playlist" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(link)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
  it("keeps caller descriptions alongside the tooltip on buttons and links", async () => {
    render(
      <>
        <p id="hint">Requires a saved playlist.</p>
        <ActionGroup>
          <ActionButton label="Save" aria-describedby="hint">
            <svg />
          </ActionButton>
          <ActionLink label="Preview" href="#preview" aria-describedby="hint">
            <svg />
          </ActionLink>
        </ActionGroup>
      </>,
    );
    const user = userEvent.setup();
    for (const name of ["Save", "Preview"]) {
      await user.tab();
      const tip = await screen.findByRole("tooltip", { name });
      const control = screen.getByRole(name === "Save" ? "button" : "link", {
        name,
      });
      expect(control.getAttribute("aria-describedby")?.split(" ")).toEqual(
        expect.arrayContaining(["hint", tip.id]),
      );
      await user.keyboard("{Escape}");
    }
  });
  it("omits an empty group and names a nonempty group without toolbar keyboard semantics", () => {
    const { rerender } = render(<ActionGroup>{null}</ActionGroup>);
    expect(screen.queryByRole("group")).toBeNull();
    rerender(
      <ActionGroup label="Playlist actions">
        <ActionButton label="Edit">
          <svg />
        </ActionButton>
      </ActionGroup>,
    );
    expect(
      screen.getByRole("group", { name: "Playlist actions" }),
    ).toBeVisible();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
  it("uses the approved action shape with short tooltip and contextual name", async () => {
    const click = vi.fn();
    render(
      <ActionGroup>
        <ActionButton
          label="Edit Costa de noche"
          tooltip="Edit"
          onClick={click}
        >
          <svg />
        </ActionButton>
      </ActionGroup>,
    );
    const button = screen.getByRole("button", { name: "Edit Costa de noche" });
    expect(button).toHaveAttribute("data-size", "icon-lg");
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).not.toHaveAttribute("title");
    expect(button.closest("[title]")).toBeNull();
    const user = userEvent.setup();
    await user.tab();
    const tip = await screen.findByRole("tooltip", { name: "Edit" });
    expect(button).toHaveAttribute("aria-describedby", tip.id);
    await user.keyboard("{Escape}{Enter} ");
    expect(click).toHaveBeenCalledTimes(2);
  });
  it("keeps the same native node and discovers disabled/loading actions without executing", async () => {
    const click = vi.fn();
    const view = (loading: boolean) => (
      <ActionGroup>
        <ActionButton label="Save" loading={loading} onClick={click}>
          <svg />
        </ActionButton>
      </ActionGroup>
    );
    const { rerender } = render(view(false));
    const button = screen.getByRole("button", { name: "Save" });
    rerender(view(true));
    expect(screen.getByRole("button", { name: "Save" })).toBe(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.tab();
    expect(screen.getByRole("group", { name: "Save" })).toHaveFocus();
    expect(await screen.findByRole("tooltip", { name: "Save" })).toBeVisible();
    await userEvent.keyboard("{Enter} ");
    expect(click).not.toHaveBeenCalled();
    rerender(view(false));
    expect(button).toBeEnabled();
  });
  it("preserves native links, refs and blocks disabled navigation", () => {
    const ref = { current: null as HTMLAnchorElement | null };
    const click = vi.fn();
    const { rerender } = render(
      <ActionGroup>
        <ActionLink
          ref={ref}
          href="#playlist"
          label="Open playlist"
          onClick={click}
        >
          <svg />
        </ActionLink>
      </ActionGroup>,
    );
    const link = screen.getByRole("link", { name: "Open playlist" });
    expect(ref.current).toBe(link);
    expect(link).toHaveAttribute("href", "#playlist");
    fireEvent.click(link);
    expect(click).toHaveBeenCalledTimes(1);
    rerender(
      <ActionGroup>
        <ActionLink
          ref={ref}
          href="#playlist"
          disabled
          label="Open playlist"
          onClick={click}
        >
          <svg />
        </ActionLink>
      </ActionGroup>,
    );
    expect(ref.current).toBe(link);
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(fireEvent.click(link)).toBe(false);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
