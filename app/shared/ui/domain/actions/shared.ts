import type { CrateIcon } from "@crate/ui/icons";
import type { ContextMenuEntry } from "./types";

export interface MenuActionConfig {
  key: string;
  label: string;
  icon?: CrateIcon;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export function action(config: MenuActionConfig): ContextMenuEntry {
  return { type: "action", ...config };
}

export function divider(key: string): ContextMenuEntry {
  return { type: "divider", key };
}

export function label(key: string, text: string): ContextMenuEntry {
  return { type: "label", key, label: text };
}

export function actionIf(
  condition: boolean,
  config: MenuActionConfig,
): ContextMenuEntry | null {
  return condition ? action(config) : null;
}
