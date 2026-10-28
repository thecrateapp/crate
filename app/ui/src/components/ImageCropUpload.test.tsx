import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ImageCropUpload } from "./ImageCropUpload";

vi.mock("react-easy-crop", () => ({ default: () => <div>Crop preview</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it("uses a named shared icon action without a native tooltip", () => {
  render(
    <ImageCropUpload
      endpoint="/api/test-cover"
      aspect={1}
      label="Edit cover"
    />,
  );
  const trigger = screen.getByRole("button", { name: "Edit cover" });
  expect(trigger).toHaveAttribute("data-size", "icon-lg");
  expect(trigger).not.toHaveAttribute("title");
  expect(trigger.textContent).toBe("");
  expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});

it("opens an accessible crop dialog with labelled zoom and closes on Escape", async () => {
  const user = userEvent.setup();
  render(
    <ImageCropUpload
      endpoint="/api/test-cover"
      aspect={1}
      label="Edit cover"
    />,
  );
  await user.upload(
    screen.getByLabelText("Edit cover", { selector: "input" }),
    new File(["image"], "cover.png", { type: "image/png" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Crop image" }),
  ).toBeInTheDocument();
  const zoom = screen.getByRole("slider", { name: "Zoom" });
  expect(zoom).toHaveValue("1");
  expect(zoom.closest(".crate-form-field")).toHaveClass("px-5");
  expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("rejects non-image files before opening the crop dialog", async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<ImageCropUpload endpoint="/api/test-cover" aspect={1} />);
  await user.upload(
    screen.getByLabelText("Upload image", { selector: "input" }),
    new File(["text"], "notes.txt", { type: "text/plain" }),
  );
  expect(toast.error).toHaveBeenCalledWith("Please select an image file");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
