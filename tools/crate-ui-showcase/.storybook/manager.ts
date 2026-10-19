import { addons } from "storybook/manager-api";
import { crateTheme } from "./theme";
addons.setConfig({
  theme: crateTheme,
  enableShortcuts: true,
});
