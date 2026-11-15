// The Linux desktop profile decides the window chrome before the app renders.
// On a floating desktop (GNOME, KDE) Crate draws its own titlebar and rounded
// frame. On a tiling compositor (Hyprland, niri, Sway, i3, river) the
// compositor already draws borders, gaps and rounding and owns the geometry,
// so Crate drops the titlebar and squares its frame.

export type LinuxDesktopProfile = {
  compositor: string;
  tiling: boolean;
};

type Invoke = <T>(command: string) => Promise<T>;

export const LINUX_WM_ATTRIBUTE = "crateLinuxWm";
export const LINUX_COMPOSITOR_ATTRIBUTE = "crateLinuxCompositor";

export async function loadLinuxDesktopProfile(
  invoke: Invoke | undefined,
): Promise<LinuxDesktopProfile | null> {
  if (!invoke) return null;
  try {
    const value = await invoke<unknown>("linux_desktop_profile");
    return parseLinuxDesktopProfile(value);
  } catch {
    // An older native shell has no profile command: keep the floating chrome.
    return null;
  }
}

export function parseLinuxDesktopProfile(
  value: unknown,
): LinuxDesktopProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.tiling !== "boolean") return null;
  const compositor =
    typeof record.compositor === "string" &&
    /^[a-z0-9]{1,16}$/.test(record.compositor)
      ? record.compositor
      : "other";
  return { compositor, tiling: record.tiling };
}

export function applyLinuxDesktopProfile(
  profile: LinuxDesktopProfile | null,
  root: { dataset: Record<string, string | undefined> },
): { showTitlebar: boolean } {
  if (!profile) return { showTitlebar: true };
  root.dataset[LINUX_COMPOSITOR_ATTRIBUTE] = profile.compositor;
  if (profile.tiling) {
    root.dataset[LINUX_WM_ATTRIBUTE] = "tiling";
    return { showTitlebar: false };
  }
  root.dataset[LINUX_WM_ATTRIBUTE] = "floating";
  return { showTitlebar: true };
}
