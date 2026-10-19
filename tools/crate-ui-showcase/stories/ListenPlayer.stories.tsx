import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  PlayerTransportStory,
  PlayerPanelsStory,
} from "../reviews/PlayerReview";
const meta = {
  id: "listen-player",
  title: "Listen/Player",
  component: PlayerTransportStory,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "1AZ. These are actual Listen player pieces composed with @crate/ui; app-local playback, authentication and output authority stay in Listen. The 5186 mockup and approved changes remain the reference. Seek/head share one moving edge; compact fine-pointer dock uses a 24px seek row, full/coarse seek uses 44px. No synthetic audio data.",
      },
    },
  },
} satisfies Meta<typeof PlayerTransportStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Transport: Story = {};
export const PanelsQueueLyricsAndResume: Story = {
  render: () => <PlayerPanelsStory />,
};
