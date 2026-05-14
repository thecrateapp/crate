export enum Style {
  Dark = "dark",
  Light = "light",
}

export const StatusBar = {
  setStyle: async (_options: { style: Style }) => {},
  setOverlaysWebView: async (_options: { overlay: boolean }) => {},
  setBackgroundColor: async (_options: { color: string }) => {},
};
