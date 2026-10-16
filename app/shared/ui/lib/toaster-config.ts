import type { ToasterProps } from "sonner";

export const toasterConfig = {
  duration: 4_000,
  className: "crate-toaster",
  toastOptions: {
    unstyled: true,
    classNames: {
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
    },
  },
  icons: {
    success: null,
    info: null,
    warning: null,
    error: null,
    loading: null,
  },
} satisfies ToasterProps;
