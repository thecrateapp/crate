export const Browser = {
  open: async ({ url }: { url: string }) => {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
  },
  close: async () => {},
};
