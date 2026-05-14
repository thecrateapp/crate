export const Browser = {
  open: async ({ url }: { url: string }) => {
    try {
      const opener = await import("@tauri-apps/plugin-opener");
      await opener.openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
  close: async () => {},
};
