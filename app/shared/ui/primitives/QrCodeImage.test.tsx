import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QrCodeImage } from "./QrCodeImage";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fake"),
  },
}));

describe("QrCodeImage", () => {
  it("renders placeholder initially", () => {
    const { container } = render(<QrCodeImage value="test" />);
    expect(container.querySelector("div")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders image after QR generation", async () => {
    render(<QrCodeImage value="test" />);
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
    });
  });

  it("passes size to image", async () => {
    render(<QrCodeImage value="test" size={200} />);
    const img = await screen.findByRole("img", { name: /QR code/i });
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "200");
  });
});
