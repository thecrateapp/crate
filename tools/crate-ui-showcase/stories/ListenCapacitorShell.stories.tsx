import type { Meta, StoryObj } from "@storybook/react-vite";
import { NativeMobileReview } from "../reviews/NativeMobileReview";
const meta = {
  id: "listen-capacitor-shell",
  title: "Listen/Platform/Capacitor shell",
  component: NativeMobileReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual MobileShellView, TopBarView, MobileNavigationView and PlayerBarFrame, with local routes and a reserved player area. Review below 768px. Safe-area values (44px top/34px bottom) and keyboard scroll clearance (300px) simulate the environment without changing component styles. The controls restore host CSS variables on unmount. This is browser geometry coverage: the fixture does not open a WebView keyboard, play audio, or certify physical iOS/Android behavior. Native bootstrap tests separately cover back-button interception, history/exit priority, keyboard notifications, focused-field scrolling and viewport updates.",
      },
    },
  },
} satisfies Meta<typeof NativeMobileReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
