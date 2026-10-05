import { supportsHaptics } from "@/lib/platform";

type HapticFeedback =
  | "light"
  | "medium"
  | "selection"
  | "success"
  | "warning"
  | "error";

export function triggerHaptic(feedback: HapticFeedback = "light"): void {
  if (!supportsHaptics) return;

  const run = async () => {
    const { Haptics, ImpactStyle, NotificationType } = await import(
      "@capacitor/haptics"
    );

    switch (feedback) {
      case "selection":
        await Haptics.selectionStart();
        await Haptics.selectionChanged();
        await Haptics.selectionEnd();
        return;
      case "medium":
        await Haptics.impact({ style: ImpactStyle.Medium });
        return;
      case "success":
        await Haptics.notification({ type: NotificationType.Success });
        return;
      case "warning":
        await Haptics.notification({ type: NotificationType.Warning });
        return;
      case "error":
        await Haptics.notification({ type: NotificationType.Error });
        return;
      default:
        await Haptics.impact({ style: ImpactStyle.Light });
    }
  };

  void run().catch(() => {});
}
