import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { ServersSettingsView } from "./ServersSettingsView";
describe("ServersSettingsView", () => {
  it("does not switch the current server, switches a different server by id and delegates removal/add", async () => {
    const user = userEvent.setup(),
      change = vi.fn(),
      remove = vi.fn(),
      add = vi.fn();
    renderWithListenProviders(
      <ServersSettingsView
        servers={[
          { id: "a", label: "Home", url: "https://home.example.test" },
          { id: "b", label: "Studio", url: "https://studio.example.test" },
        ]}
        currentId="a"
        onSwitch={change}
        onRemove={remove}
        onAdd={add}
      />,
      { locale: "en" },
    );
    expect(screen.getByRole("button", { name: "Home" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Studio" }));
    expect(change).toHaveBeenCalledWith("b");
    await user.click(screen.getByRole("button", { name: "Remove Home" }));
    expect(remove).toHaveBeenCalledWith("a");
    await user.click(
      screen.getByRole("button", { name: "Add another server" }),
    );
    expect(add).toHaveBeenCalledOnce();
  });
});
