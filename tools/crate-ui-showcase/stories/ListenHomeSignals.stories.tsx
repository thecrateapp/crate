import type { Meta, StoryObj } from "@storybook/react-vite";
import { HomeSignalsReview } from "../reviews/HomeSignalsReview";
const meta = {
  id: "listen-home-signals",
  title: "Listen/Home signals",
  component: HomeSignalsReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Radar and Crate DNA compose the actual Card, MonoLabel, StatNumber, HairlineRow, date/countdown and action components. Artwork and audio authority remain in app adapters. A single event creates no empty next-up panel; missing summary is not a fabricated zero. Replay conversion preserves supplied per-track quality and analysis. Track rows retain the approved Caspian order: quality, BPM/key, duration, like, contextual menu. Missing values retain their fixed slots; responsive visibility follows the actual row container. The sidebar uses actual MonoLabel with foreground-only accent hover/focus, including Collection children, retaining its 44px targets and pinned-open Collection behavior. This shared review scene also runs standalone on 5186; fixture actions do not call APIs or persist preferences.",
      },
    },
  },
} satisfies Meta<typeof HomeSignalsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
