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

export const VDJ_PLUGIN_VERSION = "1.0.0";

const VDJ_PLUGIN_RELEASE = `https://github.com/thecrateapp/crate/releases/download/crate-vdj-v${VDJ_PLUGIN_VERSION}/`;

export interface PluginDownload {
  platform: "macOS" | "Windows";
  label: string;
  file: string;
  url: string;
  tested: boolean;
}

const pluginEntries: Omit<PluginDownload, "url">[] = [
  {
    platform: "macOS",
    label: "Apple silicon",
    file: `Crate-VirtualDJ-macos-arm64-${VDJ_PLUGIN_VERSION}.zip`,
    tested: true,
  },
  {
    platform: "macOS",
    label: "Intel",
    file: `Crate-VirtualDJ-macos-x86_64-${VDJ_PLUGIN_VERSION}.zip`,
    tested: false,
  },
  {
    platform: "Windows",
    label: "x64",
    file: `Crate-VirtualDJ-windows-x64-${VDJ_PLUGIN_VERSION}.zip`,
    tested: false,
  },
];

export const vdjPluginDownloads: PluginDownload[] = pluginEntries.map(
  (entry) => ({ ...entry, url: VDJ_PLUGIN_RELEASE + entry.file }),
);
