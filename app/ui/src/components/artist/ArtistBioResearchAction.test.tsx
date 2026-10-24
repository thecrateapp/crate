import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ArtistBioResearchAction } from "./ArtistBioResearchAction";
const model = vi.hoisted(() => ({ available: false }));
vi.mock("@/hooks/use-llm", () => ({ useActionLLMStatus: () => model }));
it("shows the common AI action only with a configured model and preserves its callback", async () => {
  const onClick = vi.fn();
  const { rerender, container } = render(
    <ArtistBioResearchAction onClick={onClick} />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  model.available = true;
  rerender(<ArtistBioResearchAction onClick={onClick} />);
  const action = screen.getByRole("button", { name: "Research with AI" });
  expect(action).toHaveAttribute("data-size", "icon-lg");
  expect(action.textContent).toBe("");
  expect(action.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector("[title]")).toBeNull();
  await userEvent.click(action);
  expect(onClick).toHaveBeenCalledOnce();
  rerender(<ArtistBioResearchAction onClick={onClick} disabled />);
  expect(action).toBeDisabled();
});
