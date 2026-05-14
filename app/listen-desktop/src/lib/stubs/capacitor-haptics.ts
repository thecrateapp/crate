export enum ImpactStyle {
  Light = "light",
  Medium = "medium",
}

export enum NotificationType {
  Success = "success",
  Warning = "warning",
  Error = "error",
}

export const Haptics = {
  impact: async (_options?: { style?: ImpactStyle }) => {},
  notification: async (_options?: { type?: NotificationType }) => {},
  selectionStart: async () => {},
  selectionChanged: async () => {},
  selectionEnd: async () => {},
};
