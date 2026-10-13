const BASE = "https://github.com/thecrateapp/crate/releases/latest/download/";

export interface Download {
  platform: "macOS" | "Windows" | "Linux" | "Android";
  label: string;
  file: string;
  url: string;
}

const entries: Omit<Download, "url">[] = [
  {
    platform: "macOS",
    label: "Apple Silicon",
    file: "Crate-macos-arm64.app.zip",
  },
  { platform: "macOS", label: "Intel", file: "Crate-macos-intel.app.zip" },
  { platform: "Windows", label: "Installer (.exe)", file: "crate-windows.exe" },
  { platform: "Windows", label: "MSI", file: "crate-windows.msi" },
  { platform: "Linux", label: "AppImage", file: "crate-linux.AppImage" },
  { platform: "Linux", label: ".deb", file: "crate-linux.deb" },
  { platform: "Linux", label: ".rpm", file: "crate-linux.rpm" },
  { platform: "Android", label: "APK", file: "crate.apk" },
];

export const downloads: Download[] = entries.map((entry) => ({
  ...entry,
  url: BASE + entry.file,
}));
