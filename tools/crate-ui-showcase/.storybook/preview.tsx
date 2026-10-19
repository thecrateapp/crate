import type { Preview } from "@storybook/react-vite";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { crateTheme } from "./theme";
import "../showcase.css";
applyCrateIdentity();
installFocusRingMotion();
const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    backgrounds: { disable: true },
    docs: {
      theme: crateTheme,
      lang: "en",
    },
    a11y: { test: "error" },
    options: {
      storySort: {
        order: [
          "System",
          ["Introduction", "Inventory", "Foundations", "Maintenance"],
          "Components",
          [
            "Forms",
            "Feedback",
            "Data Display",
            "Navigation",
            "Actions",
            "Overlays",
            "Media",
            "Layout",
            "Compatibility",
          ],
        ],
      },
    },
  },
};
export default preview;
