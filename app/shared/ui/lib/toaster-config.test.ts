import { describe, expect, it } from "vitest";

import { toasterConfig } from "./toaster-config";

describe("shared toaster configuration", () => {
  it("keeps Sonner's four-second duration and opts into Crate presentation", () => {
    expect(toasterConfig.duration).toBe(4_000);
    expect(toasterConfig.className).toBe("crate-toaster");
    expect(toasterConfig.toastOptions.unstyled).toBe(true);
  });

  it("provides shared message, description, action and semantic type slots", () => {
    expect(toasterConfig.toastOptions.classNames).toMatchObject({
      toast: "crate-toast",
      title: "crate-toast-title",
      description: "crate-toast-description",
      content: "crate-toast-content",
      actionButton: "crate-toast-action",
      cancelButton: "crate-toast-action",
      closeButton: "crate-toast-close",
      success: "crate-toast-success",
      info: "crate-toast-info",
      warning: "crate-toast-warning",
      error: "crate-toast-error",
      loading: "crate-toast-loading",
    });
  });

  it("leaves semantic icons absent unless the caller supplies one", () => {
    expect(toasterConfig.icons).toEqual({
      success: null,
      info: null,
      warning: null,
      error: null,
      loading: null,
    });
  });

  it("leaves colour mode, placement and native safe-area offsets to each app", () => {
    for (const property of [
      "richColors",
      "theme",
      "position",
      "mobileOffset",
    ]) {
      expect(toasterConfig).not.toHaveProperty(property);
    }
    expect(toasterConfig.toastOptions).not.toHaveProperty("richColors");
  });
});
