import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpcomingShowsReview } from "../reviews/UpcomingShowsReview";
const meta = {
  id: "listen-upcoming-shows",
  title: "Listen/Upcoming and shows",
  component: UpcomingShowsReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Actual Listen-local ShowsPageView, event row/artwork/date views, show ticket and release view. Shared forms own uppercase labels and real 8px gaps. Show/release rows retain the 88px portrait role. Conventional actions use ActionGroup with accent-foreground-only hover. Releases and compact shows share an unboxed days/hours countdown; published releases show only a grey uppercase Released caption because the shared date stamp already carries the date. Existing controllers retain menus, attendance and playback; expanded tickets missing percentages lazily read the existing artist resource through the app cache. Zero is data; unavailable percentages remain absent. No API, audio or preference mutations in this fixture. Artist, Radar and genre entry points use these same views. Maps, Radio and Paths are outside this cut.",
      },
    },
  },
} satisfies Meta<typeof UpcomingShowsReview>;
export default meta;
export const Complete: StoryObj<typeof meta> = {};
